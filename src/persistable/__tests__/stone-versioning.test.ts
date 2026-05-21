import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo } from "../stone-bootstrap";
import { __resetSerialQueueForTests } from "../serial-queue";
import {
  classifyWorktreeBranch,
  commitWorktree,
  openMetaprogWorktree,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  tryMergeSelf,
  pruneStaleWorktrees,
  __testing,
} from "../stone-versioning";
import { gitHead, gitRevParse } from "../stone-git";
import { readIssue } from "../issue";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

/** 建一个干净 world：bootstrap repo + 两个 agent，每个 agent 一个 self.md。 */
async function newWorld(extraAgents: string[] = []): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-stone-versioning-"));
  tempRoots.push(baseDir);
  // 预置扁平布局，让 ensureStoneRepo 自己迁移
  for (const id of ["agent_of_x", "agent_of_y", "supervisor", ...extraAgents]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

describe("openMetaprogWorktree", () => {
  test("creates a worktree at stones/{branch}/ branched from main HEAD", async () => {
    const baseDir = await newWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "t1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.worktree.branch).toBe("metaprog/agent_of_x/t1");
    expect(r.worktree.path).toBe(__testing.worktreePath(baseDir, "metaprog/agent_of_x/t1"));
    // 工作树有 agent_of_x/self.md（其它 Object 也在）
    const content = await readFile(join(r.worktree.path, "agent_of_x", "self.md"), "utf8");
    expect(content).toBe("agent_of_x v1\n");
  });

  test("rejects supervisor (R12 exception)", async () => {
    const baseDir = await newWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "supervisor" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("rejects invalid objectId", async () => {
    const baseDir = await newWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "../etc" });
    expect(r.ok).toBe(false);
  });
});

describe("commitWorktree + classifyWorktreeBranch", () => {
  test("self-scope when only stones/{authorId}/ paths changed", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "self" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;

    await writeFile(join(open.worktree.path, "agent_of_x", "self.md"), "v2\n");
    const c = await commitWorktree({
      worktree: open.worktree,
      intent: "update self",
      authorObjectId: "agent_of_x",
    });
    expect(c.ok).toBe(true);

    const cls = await classifyWorktreeBranch(open.worktree, "agent_of_x");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("self-scope");
      expect(cls.paths).toEqual(["agent_of_x/self.md"]);
    }
  });

  test("cross-scope when commit touches another Object's stone", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "cross" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;

    await writeFile(join(open.worktree.path, "agent_of_x", "self.md"), "v2\n");
    await writeFile(join(open.worktree.path, "agent_of_y", "self.md"), "edited by x\n");
    const c = await commitWorktree({
      worktree: open.worktree,
      intent: "cross",
      authorObjectId: "agent_of_x",
    });
    expect(c.ok).toBe(true);

    const cls = await classifyWorktreeBranch(open.worktree, "agent_of_x");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("cross-scope");
      expect(cls.paths.sort()).toEqual(["agent_of_x/self.md", "agent_of_y/self.md"]);
    }
  });

  test("supervisor always returns self-scope (R12)", async () => {
    const baseDir = await newWorld();
    // 构造一个假的 worktree ref（不会被使用）；classifyWorktreeBranch 应短路
    const fakeRef = {
      baseDir,
      objectId: "supervisor",
      branch: "main",
      path: join(baseDir, "stones", "main"),
      baseCommit: "x",
    };
    const cls = await classifyWorktreeBranch(fakeRef, "supervisor");
    expect(cls.ok).toBe(true);
    if (cls.ok) expect(cls.scope).toBe("self-scope");
  });
});

describe("tryMergeSelf", () => {
  test("self-scope edits → fast-forward merged into main", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "ff1" });
    if (!open.ok) throw new Error("open failed");

    await writeFile(join(open.worktree.path, "agent_of_x", "self.md"), "v2\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "ff",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);

    const before = gitHead(__testing.repoDir(baseDir));
    expect(before.ok).toBe(true);

    const r = await tryMergeSelf(open.worktree, "agent_of_x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("merged");
    }

    // main 上 agent_of_x/self.md 内容为 v2
    const after = await readFile(join(baseDir, "stones", "main", "agent_of_x", "self.md"), "utf8");
    expect(after).toBe("v2\n");
  });

  test("cross-scope edits → must-pr-issue (no merge)", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "cross" });
    if (!open.ok) throw new Error("open failed");

    await writeFile(join(open.worktree.path, "agent_of_y", "self.md"), "violated\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "x",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);

    const r = await tryMergeSelf(open.worktree, "agent_of_x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("must-pr-issue");
    }

    // main 上 agent_of_y/self.md 仍是 v1
    const yMain = await readFile(join(baseDir, "stones", "main", "agent_of_y", "self.md"), "utf8");
    expect(yMain).toBe("agent_of_y v1\n");
  });

  test("AE7: even mostly-self with one cross-scope path → whole branch must-pr-issue", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "mixed" });
    if (!open.ok) throw new Error("open failed");

    // 95% self, 5% cross
    await writeFile(join(open.worktree.path, "agent_of_x", "self.md"), "self-edit\n");
    await writeFile(join(open.worktree.path, "agent_of_x", "extra.md"), "more\n");
    await writeFile(join(open.worktree.path, "agent_of_y", "single.md"), "tiny\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "mixed",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);

    const r = await tryMergeSelf(open.worktree, "agent_of_x");
    if (r.ok) expect(r.kind).toBe("must-pr-issue");
  });
});

describe("requestPrIssueReview + resolvePrIssue", () => {
  test("creates PR-Issue, merge resolution lands changes on main", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "pr1" });
    if (!open.ok) throw new Error("open failed");
    await writeFile(join(open.worktree.path, "agent_of_y", "self.md"), "x edits y\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "pr",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);

    const pr = await requestPrIssueReview({
      worktree: open.worktree,
      intent: "x wants to update y",
      authorObjectId: "agent_of_x",
    });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;

    const issue = await readIssue(baseDir, "super", pr.issueId);
    expect(issue?.title.startsWith("[PR]")).toBe(true);
    expect(issue?.prPayload?.branch).toBe(open.worktree.branch);
    expect(issue?.prPayload?.paths).toEqual(["agent_of_y/self.md"]);

    const resolved = await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "merge" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.kind).toBe("merged");

    const yAfter = await readFile(join(baseDir, "stones", "main", "agent_of_y", "self.md"), "utf8");
    expect(yAfter).toBe("x edits y\n");

    const issueAfter = await readIssue(baseDir, "super", pr.issueId);
    expect(issueAfter?.status).toBe("closed");
  });

  test("AE3: reject archives branch and leaves main unchanged", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "rej" });
    if (!open.ok) throw new Error("open failed");
    await writeFile(join(open.worktree.path, "agent_of_y", "self.md"), "rejected change\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "rej",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);

    const pr = await requestPrIssueReview({
      worktree: open.worktree,
      intent: "rej",
      authorObjectId: "agent_of_x",
    });
    if (!pr.ok) throw new Error("pr failed");

    const r = await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "reject" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("rejected");

    // main 上 agent_of_y 仍是 v1
    const yMain = await readFile(join(baseDir, "stones", "main", "agent_of_y", "self.md"), "utf8");
    expect(yMain).toBe("agent_of_y v1\n");

    // archived ref 存在
    const archived = gitRevParse(__testing.repoDir(baseDir), `refs/ooc/rejected/${open.worktree.branch}`);
    expect(archived.ok).toBe(true);
  });
});

describe("rollback", () => {
  test("AE4: Supervisor-signed rollback restores objectId/ subtree", async () => {
    const baseDir = await newWorld();
    // 让 agent_of_x merge 一个新版本 v2 进 main
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "v2" });
    if (!open.ok) throw new Error();
    await writeFile(join(open.worktree.path, "agent_of_x", "self.md"), "broken-v2\n");
    expect(
      (
        await commitWorktree({
          worktree: open.worktree,
          intent: "broken",
          authorObjectId: "agent_of_x",
        })
      ).ok,
    ).toBe(true);
    expect((await tryMergeSelf(open.worktree, "agent_of_x")).ok).toBe(true);

    // 取上一个 commit（bootstrap）作为目标
    const repo = __testing.repoDir(baseDir);
    const log = Bun.spawnSync(["git", "log", "--pretty=format:%H", "--reverse"], {
      cwd: repo,
      stdout: "pipe",
    });
    const commits = new TextDecoder().decode(log.stdout).trim().split("\n");
    const target = commits[0]; // bootstrap commit

    const r = await rollback({ baseDir, objectId: "agent_of_x", targetCommit: target });
    expect(r.ok).toBe(true);

    // self.md 回到 v1
    const restored = await readFile(join(baseDir, "stones", "main", "agent_of_x", "self.md"), "utf8");
    expect(restored).toBe("agent_of_x v1\n");

    // 最新 commit 的 author 是 supervisor
    const author = Bun.spawnSync(["git", "log", "-1", "--pretty=format:%an"], {
      cwd: repo,
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(author.stdout)).toBe("supervisor");
  });
});

describe("pruneStaleWorktrees", () => {
  test("runs without error on a fresh world", async () => {
    const baseDir = await newWorld();
    const r = await pruneStaleWorktrees(baseDir);
    expect(r.ok).toBe(true);
  });
});
