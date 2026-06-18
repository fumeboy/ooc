/**
 * createFeatBranchWorktree + commitAndOpenPr —— feat-branch 直接编辑 + 建 PR 集成测试。
 *
 * 用户拍板：不封装 edits 参数——沉淀拆两步——开 feat 分支 worktree（不写文件）
 * → super(foo) 用普通写文件直接编辑该 worktree 下文件 → commitAndOpenPr finalize（commit +
 * 冒泡 reviewer + 开 PR）。本测试用 node:fs writeFile 模拟「直接编辑 feat worktree」。
 *
 * 验证地基不变量：沉淀从 main 派生 feat 分支（落 stones/<branch>/）、commit（署名 author）、
 * 开 PR（record.branch=feat 分支、reviewers 正确）；**不碰 session 分支**。interim 端到端：
 * commitAndOpenPr → resolvePrIssue(merge) 仍能合入 main。
 */
import { mkdir, readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests, readPrIssue } from "@ooc/core/persistable";
import { createFeatBranchWorktree } from "../stone-feat-branch";
import { commitAndOpenPr } from "@ooc/builtins/agent/pr/open";
import { resolvePrIssue } from "@ooc/builtins/agent/pr/resolve";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_feat_branch_"));
  tempRoots.push(baseDir);
  for (const id of [...agents, "supervisor"]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    await writeFile(
      join(baseDir, "stones", id, "package.json"),
      JSON.stringify({
        name: `@ooc-obj/${id.replace(/\//g, "-")}`,
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

function mainSelf(baseDir: string, id: string): string {
  return join(baseDir, "stones", "main", "objects", id, "self.md");
}

/** 模拟 super(foo) 在 feat worktree 下直接编辑某文件（普通写文件）。 */
async function editInFeatWorktree(
  baseDir: string,
  branch: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = join(baseDir, "stones", branch, ...rel.split("/"));
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf8");
}

describe("feat-branch 沉淀（开分支 → 直接编辑 → finalize）", () => {
  test("self-scope：feat 分支落 stones/<branch>/、PR.branch=feat、reviewers={supervisor}、main 不变", async () => {
    const baseDir = await newWorld(["foo"]);

    // 1) 开 feat 分支（不写文件）
    const open = await createFeatBranchWorktree({ baseDir, intent: "Tighten foo self identity" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.branch).toBe("feat/tighten-foo-self-identity");
    expect((await stat(join(baseDir, "stones", open.branch))).isDirectory()).toBe(true);
    expect(open.branch.startsWith("session-")).toBe(false);

    // 2) super(foo) 直接编辑 feat worktree 下文件
    await editInFeatWorktree(baseDir, open.branch, "objects/foo/self.md", "foo v2 (sedimented)\n");

    // 3) finalize：commit + 开 PR
    const r = await commitAndOpenPr({
      baseDir,
      branch: open.branch,
      authorObjectId: "foo",
      intent: "Tighten foo self identity",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.reviewers).toEqual(["supervisor"]);
    expect(r.paths).toEqual(["objects/foo/self.md"]);

    const issue = await readPrIssue(baseDir, r.issueId);
    expect(issue?.title.startsWith("[PR]")).toBe(true);
    expect(issue?.prPayload?.branch).toBe(r.branch);
    expect(issue?.reviewers).toEqual(["supervisor"]);
    expect(issue?.createdByObjectId).toBe("foo");

    // main 不变（沉淀未合入，等 PR resolve）
    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v1\n");
  });

  test("cross-scope：编辑触及别人 bob → reviewers 含 bob + supervisor", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const open = await createFeatBranchWorktree({ baseDir, intent: "share knowledge into bob" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    await editInFeatWorktree(baseDir, open.branch, "objects/foo/self.md", "foo v2\n");
    await editInFeatWorktree(baseDir, open.branch, "objects/bob/readable.md", "bob touched by foo\n");

    const r = await commitAndOpenPr({
      baseDir,
      branch: open.branch,
      authorObjectId: "foo",
      intent: "share knowledge into bob",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewers.sort()).toEqual(["bob", "supervisor"]);
    const issue = await readPrIssue(baseDir, r.issueId);
    expect(issue?.reviewers?.sort()).toEqual(["bob", "supervisor"]);
  });

  test("interim 端到端：finalize → resolvePrIssue(merge) 合入 main", async () => {
    const baseDir = await newWorld(["foo"]);
    const open = await createFeatBranchWorktree({ baseDir, intent: "land foo v2" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    await editInFeatWorktree(baseDir, open.branch, "objects/foo/self.md", "foo v2 merged\n");

    const r = await commitAndOpenPr({
      baseDir,
      branch: open.branch,
      authorObjectId: "foo",
      intent: "land foo v2",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const resolved = await resolvePrIssue({ baseDir, issueId: r.issueId, decision: "merge" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.kind).toBe("merged");

    expect(await readFile(mainSelf(baseDir, "foo"), "utf8")).toBe("foo v2 merged\n");
    const issueAfter = await readPrIssue(baseDir, r.issueId);
    expect(issueAfter?.status).toBe("closed");
  });

  test("fail-loud：finalize 时工作树无改动（还没编辑）→ NO_CHANGES", async () => {
    const baseDir = await newWorld(["foo"]);
    const open = await createFeatBranchWorktree({ baseDir, intent: "noop" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    // 不编辑直接 finalize
    const r = await commitAndOpenPr({
      baseDir,
      branch: open.branch,
      authorObjectId: "foo",
      intent: "noop",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_CHANGES");
  });

  test("fail-loud：createFeatBranchWorktree 缺 intent → INVALID_INPUT", async () => {
    const baseDir = await newWorld(["foo"]);
    const r = await createFeatBranchWorktree({ baseDir, intent: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("fail-loud：commitAndOpenPr 缺 branch → INVALID_INPUT", async () => {
    const baseDir = await newWorld(["foo"]);
    const r = await commitAndOpenPr({
      baseDir,
      branch: "",
      authorObjectId: "foo",
      intent: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });
});
