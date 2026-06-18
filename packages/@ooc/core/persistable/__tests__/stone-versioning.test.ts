/**
 * stone-versioning —— 退役 session→main 合入闸（tryMergeSelf/classifyWorktreeBranch/
 * requestPrIssueReview，地基不变量）后，保留的治理 + interim 合入原语测试。
 *
 * 覆盖：resolvePrIssue（feat-branch PR 的 interim 合入/驳回，来源 createFeatBranchWorktree +
 * 直接编辑 + commitAndOpenPr）、rollback（supervisor 署名回滚）、
 * isValidObjectId 防御。scope 冒泡（reviewer 集）+ feat-branch 流程见 feat-branch-pr.test。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  resolvePrIssue,
  rollback,
  __testing,
} from "@ooc/core/persistable/stone-versioning";
import {
  createFeatBranchWorktree,
  commitAndOpenPr,
  type CommitAndOpenPrResult,
} from "@ooc/core/persistable/stone-feat-branch";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import { gitRevParse } from "@ooc/core/persistable/stone-git";
import { readPrIssue } from "../pr-issue";

/**
 * 测试 helper：开 feat 分支 → 直接编辑 worktree 下文件 → finalize（commit + 开 PR）。
 * 取代退役的 openFeatBranchPr（一步吃 edits 数组）——现在沉淀拆三步，本 helper 串起来。
 */
async function sediment(opts: {
  baseDir: string;
  authorObjectId: string;
  intent: string;
  edits: { path: string; content: string }[];
}): Promise<CommitAndOpenPrResult> {
  const open = await createFeatBranchWorktree({ baseDir: opts.baseDir, intent: opts.intent });
  if (!open.ok) return open as unknown as CommitAndOpenPrResult;
  for (const e of opts.edits) {
    const abs = join(opts.baseDir, "stones", open.branch, ...e.path.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, e.content, "utf8");
  }
  return commitAndOpenPr({
    baseDir: opts.baseDir,
    branch: open.branch,
    authorObjectId: opts.authorObjectId,
    intent: opts.intent,
  });
}

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

/** 建一个干净 world：ensureStoneRepo（bare repo + main worktree 正确连通）+ agents。 */
async function newWorld(extraAgents: string[] = []): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-stone-versioning-"));
  tempRoots.push(baseDir);
  for (const id of ["agent_of_x", "agent_of_y", "supervisor", ...extraAgents]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    await writeFile(
      join(baseDir, "stones", id, "package.json"),
      JSON.stringify({
        name: `@ooc-obj/${id}`,
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: id, kind: "object", type: "agent" },
      }),
      "utf8",
    );
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

function mainObjectFile(baseDir: string, id: string, rel: string): string {
  return join(baseDir, "stones", "main", "objects", id, rel);
}

describe("resolvePrIssue (interim 合入：来源 feat-branch PR)", () => {
  test("merge resolution lands feat-branch changes on main, closes issue", async () => {
    const baseDir = await newWorld();
    const pr = await sediment({
      baseDir,
      authorObjectId: "agent_of_x",
      intent: "x updates y",
      edits: [{ path: "objects/agent_of_y/self.md", content: "x edits y\n" }],
    });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;

    const issue = await readPrIssue(baseDir, pr.issueId);
    expect(issue?.title.startsWith("[PR]")).toBe(true);
    expect(issue?.prPayload?.branch).toBe(pr.branch);
    expect(issue?.prPayload?.paths).toEqual(["objects/agent_of_y/self.md"]);
    // cross-scope: reviewer 含 agent_of_y + supervisor
    expect(issue?.reviewers?.sort()).toEqual(["agent_of_y", "supervisor"]);

    const resolved = await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "merge" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.kind).toBe("merged");

    expect(await readFile(mainObjectFile(baseDir, "agent_of_y", "self.md"), "utf8")).toBe("x edits y\n");
    expect((await readPrIssue(baseDir, pr.issueId))?.status).toBe("closed");
  });

  test("AE3: reject archives branch and leaves main unchanged", async () => {
    const baseDir = await newWorld();
    const pr = await sediment({
      baseDir,
      authorObjectId: "agent_of_x",
      intent: "rejected change",
      edits: [{ path: "objects/agent_of_y/self.md", content: "rejected change\n" }],
    });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;

    const r = await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "reject" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("rejected");

    // main 上 agent_of_y 仍是 v1
    expect(await readFile(mainObjectFile(baseDir, "agent_of_y", "self.md"), "utf8")).toBe("agent_of_y v1\n");
    // archived ref 存在
    const archived = gitRevParse(__testing.repoDir(baseDir), `refs/ooc/rejected/${pr.branch}`);
    expect(archived.ok).toBe(true);
  });
});

describe("rollback", () => {
  test("AE4: Supervisor-signed rollback restores objectId/ subtree", async () => {
    const baseDir = await newWorld();
    const repo = __testing.repoDir(baseDir);
    // 合入前的 main HEAD（agent_of_x 仍 v1）作为回滚目标——该 commit 已含 objects/agent_of_x/。
    const headBefore = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" });
    const target = new TextDecoder().decode(headBefore.stdout).trim();

    // 经 feat-branch PR + merge 把 agent_of_x 推进到 broken-v2
    const pr = await sediment({
      baseDir,
      authorObjectId: "agent_of_x",
      intent: "broken v2",
      edits: [{ path: "objects/agent_of_x/self.md", content: "broken-v2\n" }],
    });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;
    expect((await resolvePrIssue({ baseDir, issueId: pr.issueId, decision: "merge" })).ok).toBe(true);
    expect(await readFile(mainObjectFile(baseDir, "agent_of_x", "self.md"), "utf8")).toBe("broken-v2\n");

    const r = await rollback({ baseDir, objectId: "agent_of_x", targetCommit: target });
    expect(r.ok).toBe(true);
    expect(await readFile(mainObjectFile(baseDir, "agent_of_x", "self.md"), "utf8")).toBe("agent_of_x v1\n");

    // 最新 commit author = supervisor
    const author = Bun.spawnSync(["git", "log", "-1", "--pretty=format:%an"], { cwd: repo, stdout: "pipe" });
    expect(new TextDecoder().decode(author.stdout)).toBe("supervisor");
  });
});

describe("isValidObjectId (nested child + path-traversal defense)", () => {
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
