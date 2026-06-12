/**
 * reflectable 沉淀 finalizer 全链 —— new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers 端到端验证。
 *
 * 地基不变量：`session-<sid>` worktree 永不合入 main；沉淀走 feat 分支 → PR。
 * 用户拍板：不封装 edits 参数——super(foo) 开 feat 分支后用**普通 write_file** 直接编辑 feat
 * worktree 下文件（thread 携 feat 绑定，resolveStoneIdentityRef 覆盖优先路由），create_pr_and_invite_reviewers
 * 是 finalizer（commit + 开 PR + 清绑定）。
 *
 * 场景：
 *  1. super(foo) new_feat_branch → write_file ×N（落 feat worktree）→ create_pr_and_invite_reviewers（开 PR，
 *     reviewers 冒泡，main 不变）。
 *  2. cross-scope（write_file 触及别人）→ reviewers 含别人 + supervisor。
 *  3. 错误路径：非 super flow / 无绑定就 create_pr_and_invite_reviewers → fail-loud。
 *  4. interim 端到端：create_pr_and_invite_reviewers 开 PR → resolvePrIssue(merge) 合入 main。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  readPrIssue,
  readSelf,
  resolvePrIssue,
} from "@ooc/core/persistable";
import { executeCreatePrAndInviteReviewers } from "@ooc/core/reflectable/reflect-request/method.create-pr-and-invite-reviewers";
import { executeNewFeatBranch } from "@ooc/core/reflectable/reflect-request/method.new-feat-branch";
import { executeWriteFileMethod } from "@ooc/builtins/root/executable/method.write-file";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_create_pr_and_invite_reviewers_"));
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

/**
 * super(foo) 的可变 thread（持有同一 persistence 对象贯穿 new_feat_branch → write_file →
 * create_pr_and_invite_reviewers，模拟 thread 携绑定跨 method exec 存活）。
 */
function superThread(baseDir: string, objectId: string) {
  return {
    persistence: { baseDir, objectId, sessionId: "super", threadId: "tS" } as Record<string, unknown>,
    contextWindows: [] as unknown[],
    events: [] as unknown[],
  };
}

function ctxWith(thread: unknown, args: Record<string, unknown>): MethodExecutionContext {
  return { thread, args } as unknown as MethodExecutionContext;
}

describe("reflectable 沉淀 finalizer（new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers）", () => {
  test("self-scope：开分支 → write_file 落 feat worktree → create_pr_and_invite_reviewers 开 PR，main 不变", async () => {
    const baseDir = await newWorld(["alice"]);
    const thread = superThread(baseDir, "alice");

    // 1) new_feat_branch
    const open = JSON.parse(
      (await executeNewFeatBranch(ctxWith(thread, { intent: "tighten self identity" }))) as string,
    );
    expect(open.ok).toBe(true);
    expect(open.branch).toBe("feat/tighten-self-identity");
    // 绑定已挂上 thread.persistence
    expect((thread.persistence as Record<string, unknown>).stonesBranch).toBe(open.branch);

    // 2) write_file 直接编辑（路径 stones/alice/self.md → 经 feat 绑定落 feat worktree）
    const w = await executeWriteFileMethod(
      ctxWith(thread, { path: "stones/alice/self.md", content: "alice v2 (evolved)\n" }),
    );
    expect(typeof w === "object" && w !== null && (w as { ok?: boolean }).ok === true).toBe(true);
    // 落点是 feat worktree，不是 main、不是 session
    const featSelf = join(baseDir, "stones", open.branch, "objects", "alice", "self.md");
    expect(await readFile(featSelf, "utf8")).toBe("alice v2 (evolved)\n");
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");

    // 3) create_pr_and_invite_reviewers finalize
    const r = JSON.parse((await executeCreatePrAndInviteReviewers(ctxWith(thread, {}))) as string);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("pr-issue");
    expect(typeof r.issueId).toBe("number");
    expect(r.branch).toBe(open.branch);
    expect(r.reviewers).toEqual(["supervisor"]);
    expect(r.paths).toEqual(["objects/alice/self.md"]);
    // 绑定已清除
    expect((thread.persistence as Record<string, unknown>).stonesBranch).toBeUndefined();

    // main 未变（沉淀未合入，等 PR resolve）
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
    const issue = await readPrIssue(baseDir, r.issueId);
    expect(issue?.reviewers).toEqual(["supervisor"]);
    expect(issue?.prPayload?.branch).toBe(open.branch);
  });

  test("cross-scope：write_file 触及 bob → reviewers 含 bob + supervisor", async () => {
    const baseDir = await newWorld(["alice", "bob"]);
    const thread = superThread(baseDir, "alice");
    await executeNewFeatBranch(ctxWith(thread, { intent: "share into bob" }));
    await executeWriteFileMethod(
      ctxWith(thread, { path: "stones/alice/self.md", content: "alice v2\n" }),
    );
    await executeWriteFileMethod(
      ctxWith(thread, { path: "stones/bob/readable.md", content: "bob touched by alice\n" }),
    );
    const r = JSON.parse((await executeCreatePrAndInviteReviewers(ctxWith(thread, {}))) as string);
    expect(r.ok).toBe(true);
    expect(r.reviewers.sort()).toEqual(["bob", "supervisor"]);
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
    expect(await readFile(mainSelf(baseDir, "bob"), "utf8")).toBe("bob v1\n");
  });

  test("interim 端到端：create_pr_and_invite_reviewers 开 PR → resolvePrIssue(merge) 合入 main", async () => {
    const baseDir = await newWorld(["alice"]);
    const thread = superThread(baseDir, "alice");
    await executeNewFeatBranch(ctxWith(thread, { intent: "land alice v2" }));
    await executeWriteFileMethod(
      ctxWith(thread, { path: "stones/alice/self.md", content: "alice v2 merged\n" }),
    );
    const r = JSON.parse((await executeCreatePrAndInviteReviewers(ctxWith(thread, {}))) as string);
    expect(r.ok).toBe(true);

    const resolved = await resolvePrIssue({ baseDir, issueId: r.issueId, decision: "merge" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.kind).toBe("merged");

    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v2 merged\n");
    expect(await readSelf({ baseDir, objectId: "alice" })).toBe("alice v2 merged\n");
  });

  test("fail-loud: 非 super flow new_feat_branch → error", async () => {
    const baseDir = await newWorld(["alice"]);
    const bizThread = {
      persistence: { baseDir, objectId: "alice", sessionId: "s1", threadId: "t" },
      contextWindows: [],
      events: [],
    };
    const out = await executeNewFeatBranch(ctxWith(bizThread, { intent: "x" }));
    expect(out).toContain("仅 super flow");
  });

  test("fail-loud: create_pr_and_invite_reviewers 无 feat 绑定 → 提示先 new_feat_branch，main 不变", async () => {
    const baseDir = await newWorld(["alice"]);
    const thread = superThread(baseDir, "alice");
    const out = await executeCreatePrAndInviteReviewers(ctxWith(thread, {}));
    const r = JSON.parse(out as string);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.missing)).toContain("new_feat_branch");
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
  });

  test("fail-loud: create_pr_and_invite_reviewers 绑定后未编辑就 finalize → NO_CHANGES，绑定保留", async () => {
    const baseDir = await newWorld(["alice"]);
    const thread = superThread(baseDir, "alice");
    await executeNewFeatBranch(ctxWith(thread, { intent: "noop" }));
    const out = await executeCreatePrAndInviteReviewers(ctxWith(thread, {}));
    expect(out).toContain("NO_CHANGES");
    // 绑定保留供继续编辑后重试
    expect((thread.persistence as Record<string, unknown>).stonesBranch).toBe("feat/noop");
  });
});
