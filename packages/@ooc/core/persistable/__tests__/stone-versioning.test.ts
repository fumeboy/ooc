import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  classifyWorktreeBranch,
  commitWorktree,
  openMetaprogWorktree,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  supervisorCreateObject,
  tryMergeSelf,
  pruneStaleWorktrees,
  __testing,
} from "../stone-versioning";
import { __resetSerialQueueForTests } from "../serial-queue";
import { gitHead, gitRevParse } from "../stone-git";
import { readPrIssue } from "../pr-issue";

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
  // 直接在 stones/main/objects/ 下创建（不再依赖 ensureStoneRepo 迁移）
  for (const id of ["agent_of_x", "agent_of_y", "supervisor", ...extraAgents]) {
    await mkdir(join(baseDir, "stones", "main", "objects", id), { recursive: true });
    await writeFile(join(baseDir, "stones", "main", "objects", id, "self.md"), `${id} v1\n`);
  }
  // bootstrap git repo in stones/main/
  await initMainRepo(baseDir);
  return baseDir;
}

/**
 * 建一个带嵌套 child 的 world：parent 物理含 children/<child>/self.md。
 * 直接在 stones/main/objects/ 下创建，形成
 * objects/parent/children/child/self.md 的嵌套物理布局（与 nestedObjectPath 对齐）。
 */
async function newNestedWorld(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-stone-versioning-nested-"));
  tempRoots.push(baseDir);
  for (const id of ["parent", "supervisor"]) {
    await mkdir(join(baseDir, "stones", "main", "objects", id), { recursive: true });
    await writeFile(join(baseDir, "stones", "main", "objects", id, "self.md"), `${id} v1\n`);
  }
  // parent 下嵌套 child（物理 children/ marker）
  await mkdir(join(baseDir, "stones", "main", "objects", "parent", "children", "child"), { recursive: true });
  await writeFile(join(baseDir, "stones", "main", "objects", "parent", "children", "child", "self.md"), "child v1\n");
  await initMainRepo(baseDir);
  return baseDir;
}

/** 初始化 stones/main/ 为 git repo，做一次 bootstrap commit。 */
async function initMainRepo(baseDir: string): Promise<void> {
  const mainDir = join(baseDir, "stones", "main");
  Bun.spawnSync(["git", "init", "-b", "main"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=bootstrap",
      "-c",
      "user.email=bootstrap@ooc.local",
      "commit",
      "-m",
      "chore(bootstrap): import existing stones/",
      "--allow-empty",
    ],
    { cwd: mainDir, stdout: "pipe", stderr: "pipe" },
  );
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
    const content = await readFile(join(r.worktree.path, "objects", "agent_of_x", "self.md"), "utf8");
    expect(content).toBe("agent_of_x v1\n");
  });

  test("supervisor 也能开 worktree（R12 例外撤销后对称化）", async () => {
    const baseDir = await newWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "supervisor", token: "svc1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.worktree.branch).toBe("metaprog/supervisor/svc1");
    }
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

    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "v2\n");
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
      expect(cls.paths).toEqual(["objects/agent_of_x/self.md"]);
    }
  });

  test("cross-scope when commit touches another Object's stone", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "cross" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;

    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "v2\n");
    await writeFile(join(open.worktree.path, "objects", "agent_of_y", "self.md"), "edited by x\n");
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
      expect(cls.paths.sort()).toEqual(["objects/agent_of_x/self.md", "objects/agent_of_y/self.md"]);
    }
  });

  test("supervisor 走标准 path-based 判定（R12 例外撤销）：改自己 stones → self-scope", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "supervisor", token: "sv2" });
    if (!open.ok) throw new Error("open failed");
    // 改 supervisor 自己自治区
    await writeFile(join(open.worktree.path, "objects", "supervisor", "self.md"), "supervisor v2\n");
    const commit = await commitWorktree({
      worktree: open.worktree,
      intent: "supervisor self",
      authorObjectId: "supervisor",
    });
    expect(commit.ok).toBe(true);
    const cls = await classifyWorktreeBranch(open.worktree, "supervisor");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("self-scope");
      expect(cls.paths).toEqual(["objects/supervisor/self.md"]);
    }
  });

  test("supervisor 改他人 stones → cross-scope（PR-Issue 由 supervisor 自审）", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "supervisor", token: "sv3" });
    if (!open.ok) throw new Error("open failed");
    // 改 agent_of_x stone（不在 objects/supervisor/ 下 → cross-scope）
    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "agent_of_x edited by supervisor\n");
    const commit = await commitWorktree({
      worktree: open.worktree,
      intent: "supervisor cross",
      authorObjectId: "supervisor",
    });
    expect(commit.ok).toBe(true);
    const cls = await classifyWorktreeBranch(open.worktree, "supervisor");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("cross-scope");
      expect(cls.paths).toEqual(["objects/agent_of_x/self.md"]);
    }
  });
});

describe("tryMergeSelf", () => {
  test("self-scope edits → fast-forward merged into main", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "ff1" });
    if (!open.ok) throw new Error("open failed");

    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "v2\n");
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
    const after = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8");
    expect(after).toBe("v2\n");
  });

  test("cross-scope edits → must-pr-issue (no merge)", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "cross" });
    if (!open.ok) throw new Error("open failed");

    await writeFile(join(open.worktree.path, "objects", "agent_of_y", "self.md"), "violated\n");
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
    const yMain = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(yMain).toBe("agent_of_y v1\n");
  });

  test("AE7: even mostly-self with one cross-scope path → whole branch must-pr-issue", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "mixed" });
    if (!open.ok) throw new Error("open failed");

    // 95% self, 5% cross
    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "self-edit\n");
    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "extra.md"), "more\n");
    await writeFile(join(open.worktree.path, "objects", "agent_of_y", "single.md"), "tiny\n");
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
    await writeFile(join(open.worktree.path, "objects", "agent_of_y", "self.md"), "x edits y\n");
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

    const issue = await readPrIssue(baseDir, pr.issueId);
    expect(issue?.title.startsWith("[PR]")).toBe(true);
    expect(issue?.prPayload?.branch).toBe(open.worktree.branch);
    expect(issue?.prPayload?.paths).toEqual(["objects/agent_of_y/self.md"]);

    const resolved = await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "merge" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.kind).toBe("merged");

    const yAfter = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(yAfter).toBe("x edits y\n");

    const issueAfter = await readPrIssue(baseDir, pr.issueId);
    expect(issueAfter?.status).toBe("closed");
  });

  test("AE3: reject archives branch and leaves main unchanged", async () => {
    const baseDir = await newWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "agent_of_x", token: "rej" });
    if (!open.ok) throw new Error("open failed");
    await writeFile(join(open.worktree.path, "objects", "agent_of_y", "self.md"), "rejected change\n");
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
    const yMain = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
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
    await writeFile(join(open.worktree.path, "objects", "agent_of_x", "self.md"), "broken-v2\n");
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
    const restored = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8");
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

describe("supervisorCreateObject", () => {
  test("creates new stone with self/readme/knowledge and commits to main", async () => {
    const baseDir = await newWorld();
    const r = await supervisorCreateObject({
      baseDir,
      newObjectId: "weather",
      selfMd: "# weather — query weather\n",
      readmeMd: "# weather\n\nAsk for forecasts.\n",
      knowledge: { "usage.md": "Pass {city}.\n" },
      intent: "feat: introduce weather agent",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.commitSha).toBe("string");
    // 文件落盘 main
    const selfOnMain = await readFile(join(baseDir, "stones", "main", "objects", "weather", "self.md"), "utf8");
    expect(selfOnMain).toBe("# weather — query weather\n");
    const kn = await readFile(join(baseDir, "stones", "main", "objects", "weather", "knowledge", "usage.md"), "utf8");
    expect(kn).toBe("Pass {city}.\n");
    const meta = await readFile(join(baseDir, "stones", "main", "objects", "weather", ".stone.json"), "utf8");
    expect(JSON.parse(meta)).toMatchObject({ type: "stone", objectId: "weather" });
  });

  test("rejects when stone already exists", async () => {
    const baseDir = await newWorld();
    const first = await supervisorCreateObject({
      baseDir,
      newObjectId: "weather",
      selfMd: "v1",
      readmeMd: "v1",
    });
    expect(first.ok).toBe(true);
    const dup = await supervisorCreateObject({
      baseDir,
      newObjectId: "weather",
      selfMd: "v2",
      readmeMd: "v2",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("ALREADY_EXISTS");
  });

  test("rejects supervisor itself (bootstrap path only)", async () => {
    const baseDir = await newWorld();
    const r = await supervisorCreateObject({
      baseDir,
      newObjectId: "supervisor",
      selfMd: "x",
      readmeMd: "y",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("rejects empty selfMd / readmeMd", async () => {
    const baseDir = await newWorld();
    const r1 = await supervisorCreateObject({ baseDir, newObjectId: "x", selfMd: "", readmeMd: "y" });
    expect(r1.ok).toBe(false);
    const r2 = await supervisorCreateObject({ baseDir, newObjectId: "x", selfMd: "x", readmeMd: "  " });
    expect(r2.ok).toBe(false);
  });

  test("rejects unsafe knowledge filenames", async () => {
    const baseDir = await newWorld();
    const r = await supervisorCreateObject({
      baseDir,
      newObjectId: "weather",
      selfMd: "x",
      readmeMd: "y",
      knowledge: { "../escape.md": "bad" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });
});

describe("isValidObjectId (task#16: nested child + path-traversal defense)", () => {
  const { isValidObjectId } = __testing;

  test("accepts flat and nested objectIds", () => {
    expect(isValidObjectId("agent_of_x")).toBe(true);
    expect(isValidObjectId("parent/child")).toBe(true);
    expect(isValidObjectId("a/b/c")).toBe(true);
    expect(isValidObjectId("a-1/b_2/c.3")).toBe(true);
  });

  test("rejects path-traversal & empty-segment forms", () => {
    expect(isValidObjectId("../etc")).toBe(false);
    expect(isValidObjectId("a/../b")).toBe(false);
    expect(isValidObjectId("a/..")).toBe(false);
    expect(isValidObjectId("..")).toBe(false);
    expect(isValidObjectId("a//b")).toBe(false);
    expect(isValidObjectId("/x")).toBe(false);
    expect(isValidObjectId("x/")).toBe(false);
    expect(isValidObjectId("/")).toBe(false);
    expect(isValidObjectId("a/./b")).toBe(false);
    expect(isValidObjectId(".")).toBe(false);
    expect(isValidObjectId("")).toBe(false);
  });
});

describe("selfScopePrefix (task#16: nested child uses physical children/ layout)", () => {
  const { selfScopePrefix } = __testing;

  test("flat objectId → objects/<id>/", () => {
    expect(selfScopePrefix("agent_of_x")).toBe("objects/agent_of_x/");
  });

  test("nested child → objects/parent/children/child/ (physical path, not direct splice)", () => {
    expect(selfScopePrefix("parent/child")).toBe("objects/parent/children/child/");
    expect(selfScopePrefix("a/b/c")).toBe("objects/a/children/b/children/c/");
  });
});

describe("nested child metaprog (task#16)", () => {
  test("openMetaprogWorktree accepts nested objectId; branch is multi-level", async () => {
    const baseDir = await newNestedWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "parent/child", token: "n1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worktree.branch).toBe("metaprog/parent/child/n1");
    // 工作树里能读到 child 的物理落点
    const content = await readFile(
      join(r.worktree.path, "objects", "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(content).toBe("child v1\n");
  });

  test("① child edits its own subtree → self-scope ff-merge to main", async () => {
    const baseDir = await newNestedWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "parent/child", token: "self" });
    if (!open.ok) throw new Error("open failed");

    await writeFile(
      join(open.worktree.path, "objects", "parent", "children", "child", "self.md"),
      "child v2\n",
    );
    const c = await commitWorktree({
      worktree: open.worktree,
      intent: "child self update",
      authorObjectId: "parent/child",
    });
    expect(c.ok).toBe(true);

    const cls = await classifyWorktreeBranch(open.worktree, "parent/child");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("self-scope");
      expect(cls.paths).toEqual(["objects/parent/children/child/self.md"]);
    }

    const merge = await tryMergeSelf(open.worktree, "parent/child");
    expect(merge.ok).toBe(true);
    if (merge.ok) expect(merge.kind).toBe("merged");

    const onMain = await readFile(
      join(baseDir, "stones", "main", "objects", "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onMain).toBe("child v2\n");
  });

  test("② child edits parent (objects/parent/self.md) → cross-scope PR-Issue", async () => {
    const baseDir = await newNestedWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "parent/child", token: "cross" });
    if (!open.ok) throw new Error("open failed");

    // 改 parent 自己的 self.md（objects/parent/self.md，不在 child 子树下）
    await writeFile(join(open.worktree.path, "objects", "parent", "self.md"), "parent edited by child\n");
    const c = await commitWorktree({
      worktree: open.worktree,
      intent: "child edits parent",
      authorObjectId: "parent/child",
    });
    expect(c.ok).toBe(true);

    const cls = await classifyWorktreeBranch(open.worktree, "parent/child");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("cross-scope");
      expect(cls.paths).toEqual(["objects/parent/self.md"]);
    }

    const merge = await tryMergeSelf(open.worktree, "parent/child");
    expect(merge.ok).toBe(true);
    if (merge.ok) expect(merge.kind).toBe("must-pr-issue");

    // main 上 parent/self.md 未被改
    const onMain = await readFile(join(baseDir, "stones", "main", "objects", "parent", "self.md"), "utf8");
    expect(onMain).toBe("parent v1\n");
  });

  test("③ parent edits child subtree → self-scope (parent prefix covers children/)", async () => {
    const baseDir = await newNestedWorld();
    const open = await openMetaprogWorktree({ baseDir, objectId: "parent", token: "p2c" });
    if (!open.ok) throw new Error("open failed");

    // parent 改 child 的物理落点（在 objects/parent/ 子树内）
    await writeFile(
      join(open.worktree.path, "objects", "parent", "children", "child", "self.md"),
      "child edited by parent\n",
    );
    const c = await commitWorktree({
      worktree: open.worktree,
      intent: "parent edits child",
      authorObjectId: "parent",
    });
    expect(c.ok).toBe(true);

    const cls = await classifyWorktreeBranch(open.worktree, "parent");
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.scope).toBe("self-scope");
      expect(cls.paths).toEqual(["objects/parent/children/child/self.md"]);
    }

    const merge = await tryMergeSelf(open.worktree, "parent");
    expect(merge.ok).toBe(true);
    if (merge.ok) expect(merge.kind).toBe("merged");

    const onMain = await readFile(
      join(baseDir, "stones", "main", "objects", "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onMain).toBe("child edited by parent\n");
  });

  test("rejects nested objectId with traversal segment at openMetaprogWorktree", async () => {
    const baseDir = await newNestedWorld();
    const r = await openMetaprogWorktree({ baseDir, objectId: "parent/../escape" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });
});
