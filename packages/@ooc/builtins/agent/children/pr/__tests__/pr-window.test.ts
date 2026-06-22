/**
 * pr —— reviewer 评审窗口 + 渲染/method + 回修 + resume 集成测试。
 *
 * reflectable 沉淀（窗口 + 回修）。覆盖：
 * - pr 渲染：intent / diff / paths / reviewers / approvals / verdict
 * - object method：approve（聚合 ready-to-merge + prAutoMerge 合入）/ reject（一票否决 + 回投）
 * - deliverPrWindowToReviewers：每个 reviewer 的 super-session thread 出现 pr 实例
 * - reject → 回修 message 落 super(foo) inbox + status 翻 running
 * - resume：reject 后 new_feat_branch(同 intent) 幂等重绑 feat 分支再 create_pr_and_invite_reviewers
 *
 * Wave 4 对象模型：pr 是注册 class `_builtin/agent/pr`（归一 id `agent/pr`）；
 * 窗实例是 `OocObjectRef<PrData>`（元信息 + 业务字段落 inst.data）。readable 经
 * `Class.readable.readable(ctx, self=Data, win)` 返回 `{class, content}`；object method 经
 * `Class.executable.methods` 的三参 `exec(ctx, self=Data, args)`。沉淀两 method
 * （new_feat_branch / create_pr_and_invite_reviewers）归位到 thread class（reflect_request 投影窗 surface）。
 */
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  createFeatBranchWorktree,
} from "@ooc/core/persistable";
import { commitAndOpenPr } from "@ooc/builtins/agent/pr/open";
import { readPrIssue } from "../persistable/pr-issue.js";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import { serializeXml, xmlElement } from "@ooc/core/_shared/types/xml";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import {
  materializeWindow,
  getSessionObjectTable,
} from "@ooc/core/runtime/session-object-table.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import type { ReadableContext } from "@ooc/core/readable/contract.js";
import type { ExecutableContext } from "@ooc/core/executable/contract.js";
import {
  deliverPrWindowToReviewers,
  routePrRepairMessage,
  prWindowId,
  prReviewThreadId,
} from "../delivery";
import { applyPrApproval } from "../approval-flow";
import type { Data as PrData } from "../types";
// 注册 builtin class（含 pr：readable + executable + thread 沉淀 method）。
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

/** pr 注册 class id（stored class；registry 查询时内部归一，故 getClass/resolveObjectMethod 也接受它）。 */
const PR_CLASS_ID = "_builtin/agent/pr";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[], opts?: { prAutoMerge?: boolean }): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_pr_window_"));
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
        ooc: { objectId: id, kind: "object" },
      }),
      "utf8",
    );
  }
  if (opts?.prAutoMerge !== undefined) {
    await writeFile(join(baseDir, ".world.json"), JSON.stringify({ prAutoMerge: opts.prAutoMerge }), "utf8");
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

async function editInFeatWorktree(baseDir: string, branch: string, rel: string, content: string): Promise<void> {
  const abs = join(baseDir, "stones", branch, ...rel.split("/"));
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf8");
}

/** 开 feat 分支 + 编辑 + finalize → 返回 issueId/reviewers（authorThreadId 模拟 super(foo) thread）。 */
async function openPr(
  baseDir: string,
  authorObjectId: string,
  intent: string,
  edits: Array<{ rel: string; content: string }>,
  authorThreadId?: string,
): Promise<{ issueId: number; reviewers: string[] }> {
  const open = await createFeatBranchWorktree({ baseDir, intent });
  if (!open.ok) throw new Error("open feat branch failed");
  for (const e of edits) await editInFeatWorktree(baseDir, open.branch, e.rel, e.content);
  const r = await commitAndOpenPr({ baseDir, branch: open.branch, authorObjectId, intent, authorThreadId });
  if (!r.ok) throw new Error(`commitAndOpenPr failed: ${r.code}`);
  return { issueId: r.issueId, reviewers: r.reviewers };
}

/** 构造一条 reviewer 的 super-session thread context（用于 render/method ctx）。 */
function reviewerThread(baseDir: string, reviewerObjectId: string, threadId: string): ThreadContext {
  return {
    id: threadId,
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { baseDir, sessionId: "super", objectId: reviewerObjectId, threadId },
  };
}

/** 构造一个 pr 窗（OocObjectRef）+ 把对象登记进 session 对象表（data 在表，窗不持 data）。 */
function prInstance(
  thread: ThreadContext,
  issueId: number,
  data: PrData,
  title: string,
): OocObjectRef {
  return materializeWindow(thread, {
    id: prWindowId(issueId),
    parentWindowId: "root",
    title,
    status: "open",
    createdAt: Date.now(),
    class: "pr",
    data,
  });
}

/** 取 pr 注册 class（readable + executable）。 */
function prClass() {
  const cls = builtinRegistry.getClass(PR_CLASS_ID);
  if (!cls) throw new Error(`pr class "${PR_CLASS_ID}" not registered`);
  return cls;
}

/** 渲染 pr 实例为 xml（经 readable 投影 + 包 pr_window 根元素）。 */
async function renderPr(baseDir: string, thread: ThreadContext, data: PrData): Promise<string> {
  const cls = prClass();
  const ctx: ReadableContext = {
    object: { id: prWindowId(data.issueId), class: "pr" },
    persistence: thread.persistence,
  };
  const proj = await cls.readable!.readable(ctx, makeReadonlySelfProxy(data), undefined);
  return serializeXml(xmlElement("pr_window", {}, proj.content as never));
}

/** 取 pr 的某个 object method（approve/reject/request_changes）。 */
function prMethod(name: string) {
  const m = builtinRegistry.resolveObjectMethod(PR_CLASS_ID, name);
  if (!m) throw new Error(`pr object method "${name}" not registered`);
  return m;
}

describe("pr 渲染", () => {
  test("readable 渲染 intent / paths / reviewers / verdict / diff", async () => {
    const baseDir = await newWorld(["foo"]);
    const { issueId } = await openPr(baseDir, "foo", "Tighten foo self", [
      { rel: "objects/foo/self.md", content: "foo v2 sedimented\n" },
    ]);

    const data: PrData = { issueId, reviewerObjectId: "supervisor", authorObjectId: "foo" };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    thread.contextWindows = [prInstance(thread, issueId, data, "Tighten foo self")];
    const xml = await renderPr(baseDir, thread, data);

    expect(xml).toContain("Tighten foo self"); // intent
    expect(xml).toContain("objects/foo/self.md"); // paths
    expect(xml).toContain("supervisor"); // reviewer
    expect(xml).toContain("<verdict>pending</verdict>");
    expect(xml).toContain("foo v2 sedimented"); // diff content
  });

  test("readable：record 缺失 → error 占位不崩", async () => {
    const baseDir = await newWorld(["foo"]);
    const data: PrData = { issueId: 999, reviewerObjectId: "supervisor", authorObjectId: "foo" };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const xml = await renderPr(baseDir, thread, data);
    expect(xml).toContain("不存在");
  });
});

describe("pr object method", () => {
  test("approve：唯一 reviewer approve → ready-to-merge + prAutoMerge 合入 main", async () => {
    const baseDir = await newWorld(["foo"], { prAutoMerge: true });
    const { issueId } = await openPr(baseDir, "foo", "land foo v2", [
      { rel: "objects/foo/self.md", content: "foo v2 merged\n" },
    ]);

    const approve = prMethod("approve");
    const data: PrData = { issueId, reviewerObjectId: "supervisor", authorObjectId: "foo" };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const ctx: ExecutableContext = {
      persistence: thread.persistence,
      object: { id: prWindowId(issueId), class: "pr" },
      args: {},
    };
    const out = await approve.exec(ctx, makeSelfProxy(data, prWindowId(issueId), undefined), {});
    const parsed = JSON.parse(out as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.verdict).toBe("ready-to-merge");
    expect(parsed.merged).toBe(true);

    // main 已合入
    expect(await readFile(join(baseDir, "stones", "main", "objects", "foo", "self.md"), "utf8")).toBe("foo v2 merged\n");
    expect((await readPrIssue(baseDir, issueId))?.status).toBe("closed");
  });

  test("reject：一票否决 + 回修 message 投回 super(foo)", async () => {
    const baseDir = await newWorld(["foo"]);
    // 先建 super(foo) thread（PR 由它发起；authorThreadId 指向它）
    const superFooThreadId = "t_superfoo";
    const superFoo = reviewerThread(baseDir, "foo", superFooThreadId);
    await writeThread(superFoo);

    const { issueId } = await openPr(
      baseDir, "foo", "share into supervisor land",
      [{ rel: "objects/foo/self.md", content: "foo v2\n" }, { rel: "objects/supervisor/readable.md", content: "touched\n" }],
      superFooThreadId,
    );

    const reject = prMethod("reject");
    const data: PrData = {
      issueId, reviewerObjectId: "supervisor", authorObjectId: "foo", authorThreadId: superFooThreadId,
    };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const ctx: ExecutableContext = {
      persistence: thread.persistence,
      object: { id: prWindowId(issueId), class: "pr" },
      args: {},
    };
    const out = await reject.exec(ctx, makeSelfProxy(data, prWindowId(issueId), undefined), {});
    const parsed = JSON.parse(out as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.verdict).toBe("rejected");
    expect(parsed.rejected).toBe(true);
    expect(parsed.repair_routed).toBe(true);

    // super(foo) thread 收到回修 message
    const reloaded = await readThread({ baseDir, sessionId: "super", objectId: "foo" }, superFooThreadId);
    const repairMsg = reloaded?.inbox?.find((m) => m.content.includes("被 reject"));
    expect(repairMsg).toBeDefined();
    expect(reloaded?.status).toBe("running");

    // 回修 message 必须给 LLM 可照抄的 method 动作序列
    // （带真实 intent），并明确禁止 curl/program 自查空转。
    expect(repairMsg!.content).toContain("new_feat_branch");
    expect(repairMsg!.content).toContain("share into supervisor land"); // 真实 intent，照抄即可
    expect(repairMsg!.content).toContain("create_pr_and_invite_reviewers");
    expect(repairMsg!.content).toMatch(/curl|program/); // 明示「不要 curl/program 自查」
  });
});

describe("deliverPrWindowToReviewers（投递）", () => {
  // SKIP（真源码 bug，待修复后解封）：delivery.ts:115 把投递的 pr 窗实例存为 inst.class="pr"，
  // 投递的 pr 窗 stored class = 注册 id PR_CLASS_ID（=_builtin/agent/pr）；裸名 "pr" 是 readable
  // 投影名。pr 走系统默认 inline 持久化（inline 进所属 thread-context），round-trip 后窗 + data 还在。
  test("每个 reviewer 的 super-session thread 出现 pr 实例 + inbox 事件", async () => {
    const baseDir = await newWorld(["foo", "bob"]);
    const { issueId, reviewers } = await openPr(baseDir, "foo", "share into bob", [
      { rel: "objects/foo/self.md", content: "foo v2\n" },
      { rel: "objects/bob/readable.md", content: "bob touched\n" },
    ]);
    expect(reviewers.sort()).toEqual(["bob", "supervisor"]);

    const res = await deliverPrWindowToReviewers({
      baseDir, issueId, reviewers, authorObjectId: "foo", authorThreadId: "tx", title: "share into bob",
    });
    expect(res.delivered.map((d) => d.reviewerObjectId).sort()).toEqual(["bob", "supervisor"]);

    for (const reviewer of reviewers) {
      const tid = prReviewThreadId(reviewer, issueId);
      const t = await readThread({ baseDir, sessionId: "super", objectId: reviewer }, tid);
      expect(t).toBeDefined();
      const win = t!.contextWindows?.find((w) => w.id === prWindowId(issueId));
      expect(win?.class).toBe(PR_CLASS_ID);
      const winData = (objectDataOf(win!, getSessionObjectTable(t!)) ?? {}) as PrData;
      expect(winData.issueId).toBe(issueId);
      expect(winData.reviewerObjectId).toBe(reviewer);
      expect(t!.events.some((e) => e.kind === "inbox_message_arrived")).toBe(true);
    }
  });

  test("重复投递同一 PR 幂等：window 不堆叠（同 id 替换）", async () => {
    const baseDir = await newWorld(["foo"]);
    const { issueId, reviewers } = await openPr(baseDir, "foo", "x", [
      { rel: "objects/foo/self.md", content: "foo v2\n" },
    ]);
    await deliverPrWindowToReviewers({ baseDir, issueId, reviewers, authorObjectId: "foo", title: "x" });
    await deliverPrWindowToReviewers({ baseDir, issueId, reviewers, authorObjectId: "foo", title: "x" });
    const tid = prReviewThreadId("supervisor", issueId);
    const t = await readThread({ baseDir, sessionId: "super", objectId: "supervisor" }, tid);
    const prWins = (t!.contextWindows ?? []).filter((w) => w.class === PR_CLASS_ID);
    expect(prWins.length).toBe(1);
  });
});

describe("routePrRepairMessage", () => {
  test("author thread 缺失 → NO_AUTHOR_THREAD（fail-loud，不静默吞）", async () => {
    const baseDir = await newWorld(["foo"]);
    const r = await routePrRepairMessage({ baseDir, authorObjectId: "foo", authorThreadId: "nope", reason: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_AUTHOR_THREAD");
  });
});

describe("resume 回修循环（new_feat_branch 重绑 + re-submit）", () => {
  test("request_changes → 同 intent 幂等重绑 feat 分支（旧编辑仍在）→ 再 create_pr_and_invite_reviewers 重开 PR", async () => {
    // 沉淀两 method 已归位到 thread class（reflect_request 投影窗 surface）。
    const { executeNewFeatBranch } = await import("@ooc/builtins/agent/thread/executable/method.new-feat-branch");
    const { executeCreatePrAndInviteReviewers } = await import("@ooc/builtins/agent/thread/executable/method.create-pr-and-invite-reviewers");
    const baseDir = await newWorld(["foo", "bob"]);

    // super(foo) thread（沉淀发起者）
    const superFoo = reviewerThread(baseDir, "foo", "t_superfoo");
    await writeThread(superFoo);

    // ① new_feat_branch(intent) 绑定（method 签名 (ctx, args)）
    const open1 = await executeNewFeatBranch({ thread: superFoo, args: {} } as never, { intent: "share into bob" });
    expect(JSON.parse(open1 as string).ok).toBe(true);
    const branch = superFoo.persistence!.stonesBranch!;
    expect(branch).toBe("feat/share-into-bob");

    // ② 直接编辑 feat worktree（触及 bob → reviewer 含 bob）
    await editInFeatWorktree(baseDir, branch, "objects/foo/self.md", "foo v2\n");
    await editInFeatWorktree(baseDir, branch, "objects/bob/readable.md", "bob touched by foo\n");

    // ③ create_pr_and_invite_reviewers → 开 PR（reviewers 含 bob + supervisor），清绑定
    const fin1 = JSON.parse((await executeCreatePrAndInviteReviewers({ thread: superFoo, args: {} } as never, {})) as string);
    expect(fin1.ok).toBe(true);
    const issueId = fin1.issueId as number;
    expect((fin1.reviewers as string[]).sort()).toEqual(["bob", "supervisor"]);
    expect(superFoo.persistence!.stonesBranch).toBeUndefined(); // 绑定已清

    // bob request_changes → 回投 super(foo)
    const rc = await applyPrApproval({ baseDir, issueId, reviewerObjectId: "bob", action: "request-changes" });
    expect(rc.ok).toBe(true);
    if (rc.ok) {
      expect(rc.verdict).toBe("changes-requested");
      expect(rc.repairRouted).toBe(true);
    }
    const afterRc = await readThread({ baseDir, sessionId: "super", objectId: "foo" }, "t_superfoo");
    expect(afterRc?.inbox?.some((m) => m.content.includes("需修改"))).toBe(true);

    // resume：同 intent 重绑（request_changes 时旧 worktree + 编辑都在）
    superFoo.persistence!.stonesBranch = undefined; // 模拟 disk 恢复后无绑定
    const open2 = await executeNewFeatBranch({ thread: superFoo, args: {} } as never, { intent: "share into bob" });
    expect(JSON.parse(open2 as string).ok).toBe(true);
    const reboundBranch = String(superFoo.persistence!.stonesBranch);
    expect(reboundBranch).toBe(String(branch)); // 幂等重绑同分支
    // 旧编辑仍在 worktree
    expect(await readFile(join(baseDir, "stones", branch, "objects", "foo", "self.md"), "utf8")).toBe("foo v2\n");

    // re-edit + re-submit
    await editInFeatWorktree(baseDir, branch, "objects/foo/self.md", "foo v3 revised\n");
    const fin2 = JSON.parse((await executeCreatePrAndInviteReviewers({ thread: superFoo, args: {} } as never, {})) as string);
    expect(fin2.ok).toBe(true);
    expect(fin2.issueId).toBeGreaterThan(issueId); // 重开新 PR
  });
});
