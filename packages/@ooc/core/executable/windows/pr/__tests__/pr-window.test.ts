/**
 * pr_window —— reviewer 评审窗口 + P4 渲染/method + P6 回修 + resume 集成测试。
 *
 * reflectable 沉淀 P4（窗口）+ P6（回修，spec 2026-06-11 §3）。覆盖：
 * - PR window 渲染：intent / diff / paths / reviewers / approvals / verdict
 * - window method：approve（聚合 ready-to-merge + prAutoMerge 合入）/ reject（一票否决 + P6 回投）
 * - deliverPrWindowToReviewers：每个 reviewer 的 super-session thread 出现 pr_window
 * - P6：reject → 回修 message 落 super(foo) inbox + status 翻 running
 * - resume：reject 后 new_feat_branch(同 intent) 幂等重绑 feat 分支再 submit
 */
import { mkdir, mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  readPrIssue,
  readThread,
  createFeatBranchWorktree,
  commitAndOpenPr,
  approvePrIssue,
} from "@ooc/core/persistable";
import { serializeXml, xmlElement } from "@ooc/core/_shared/types/xml";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import {
  deliverPrWindowToReviewers,
  routePrRepairMessage,
  prWindowId,
  prReviewThreadId,
} from "../delivery";
import { applyPrApproval } from "../approval-flow";
import type { PrWindow } from "../types";
// 触发 pr window 注册（readable + methods）。
import "../index";
import { builtinRegistry } from "@ooc/core/executable/windows/index";

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
        ooc: { objectId: id, kind: "object", type: "agent" },
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

describe("pr_window 渲染（P4）", () => {
  test("readable 渲染 intent / paths / reviewers / verdict / diff", async () => {
    const baseDir = await newWorld(["foo"]);
    const { issueId } = await openPr(baseDir, "foo", "Tighten foo self", [
      { rel: "objects/foo/self.md", content: "foo v2 sedimented\n" },
    ]);

    const def = builtinRegistry.getObjectDefinition("pr" as never);
    expect(def.readable).toBeDefined();

    const window: PrWindow = {
      id: prWindowId(issueId),
      class: "pr",
      parentWindowId: "root",
      title: "Tighten foo self",
      status: "open",
      createdAt: Date.now(),
      issueId,
      reviewerObjectId: "supervisor",
      authorObjectId: "foo",
    };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    thread.contextWindows = [window];
    const nodes = await def.readable!({ window, thread } as never);
    const xml = serializeXml(xmlElement("pr_window", {}, nodes));

    expect(xml).toContain("Tighten foo self"); // intent
    expect(xml).toContain("objects/foo/self.md"); // paths
    expect(xml).toContain("supervisor"); // reviewer
    expect(xml).toContain("<verdict>pending</verdict>");
    expect(xml).toContain("foo v2 sedimented"); // diff content
  });

  test("readable：record 缺失 → error 占位不崩", async () => {
    const baseDir = await newWorld(["foo"]);
    const def = builtinRegistry.getObjectDefinition("pr" as never);
    const window: PrWindow = {
      id: prWindowId(999),
      class: "pr",
      parentWindowId: "root",
      title: "ghost",
      status: "open",
      createdAt: Date.now(),
      issueId: 999,
      reviewerObjectId: "supervisor",
      authorObjectId: "foo",
    };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const nodes = await def.readable!({ window, thread } as never);
    const xml = serializeXml(xmlElement("pr_window", {}, nodes));
    expect(xml).toContain("不存在");
  });
});

describe("pr_window method（P4）", () => {
  test("approve：唯一 reviewer approve → ready-to-merge + prAutoMerge 合入 main", async () => {
    const baseDir = await newWorld(["foo"], { prAutoMerge: true });
    const { issueId } = await openPr(baseDir, "foo", "land foo v2", [
      { rel: "objects/foo/self.md", content: "foo v2 merged\n" },
    ]);

    const def = builtinRegistry.getObjectDefinition("pr" as never);
    const approve = def.methods.approve;
    expect(approve).toBeDefined();

    const window: PrWindow = {
      id: prWindowId(issueId), class: "pr", parentWindowId: "root", title: "land foo v2",
      status: "open", createdAt: Date.now(), issueId, reviewerObjectId: "supervisor", authorObjectId: "foo",
    };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const out = await approve.exec({ thread, self: window, args: {} } as never);
    const parsed = JSON.parse(out as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.verdict).toBe("ready-to-merge");
    expect(parsed.merged).toBe(true);

    // main 已合入
    expect(await readFile(join(baseDir, "stones", "main", "objects", "foo", "self.md"), "utf8")).toBe("foo v2 merged\n");
    expect((await readPrIssue(baseDir, issueId))?.status).toBe("closed");
  });

  test("reject：一票否决 + P6 回修 message 投回 super(foo)", async () => {
    const baseDir = await newWorld(["foo"]);
    // 先建 super(foo) thread（PR 由它发起；authorThreadId 指向它）
    const superFooThreadId = "t_superfoo";
    const superFoo = reviewerThread(baseDir, "foo", superFooThreadId);
    await import("@ooc/core/persistable").then((m) => m.writeThread(superFoo));

    const { issueId } = await openPr(
      baseDir, "foo", "share into supervisor land",
      [{ rel: "objects/foo/self.md", content: "foo v2\n" }, { rel: "objects/supervisor/readable.md", content: "touched\n" }],
      superFooThreadId,
    );

    const def = builtinRegistry.getObjectDefinition("pr" as never);
    const window: PrWindow = {
      id: prWindowId(issueId), class: "pr", parentWindowId: "root", title: "x",
      status: "open", createdAt: Date.now(), issueId, reviewerObjectId: "supervisor",
      authorObjectId: "foo", authorThreadId: superFooThreadId,
    };
    const thread = reviewerThread(baseDir, "supervisor", "t1");
    const out = await def.methods.reject.exec({ thread, self: window, args: {} } as never);
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

    // reflectable #4 回归（2026-06-11）：回修 message 必须给 LLM 可照抄的 method 动作序列
    // （带真实 intent），并明确禁止 curl/program 自查空转。
    expect(repairMsg!.content).toContain("new_feat_branch");
    expect(repairMsg!.content).toContain('share into supervisor land'); // 真实 intent，照抄即可
    expect(repairMsg!.content).toContain("evolve_self");
    expect(repairMsg!.content).toMatch(/curl|program/); // 明示「不要 curl/program 自查」
  });
});

describe("deliverPrWindowToReviewers（P4 投递）", () => {
  test("每个 reviewer 的 super-session thread 出现 pr_window + inbox 事件", async () => {
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
      expect(win?.class).toBe("pr");
      expect((win as PrWindow).issueId).toBe(issueId);
      expect((win as PrWindow).reviewerObjectId).toBe(reviewer);
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
    const prWins = (t!.contextWindows ?? []).filter((w) => w.class === "pr");
    expect(prWins.length).toBe(1);
  });
});

describe("routePrRepairMessage（P6）", () => {
  test("author thread 缺失 → NO_AUTHOR_THREAD（fail-loud，不静默吞）", async () => {
    const baseDir = await newWorld(["foo"]);
    const r = await routePrRepairMessage({ baseDir, authorObjectId: "foo", authorThreadId: "nope", reason: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_AUTHOR_THREAD");
  });
});

describe("P6 resume 回修循环（new_feat_branch 重绑 + re-submit）", () => {
  test("request_changes → 同 intent 幂等重绑 feat 分支（旧编辑仍在）→ 再 evolve_self 重开 PR", async () => {
    const { executeNewFeatBranch } = await import("@ooc/builtins/root/executable/method.new-feat-branch");
    const { executeEvolveSelf } = await import("@ooc/builtins/root/executable/method.evolve-self");
    const baseDir = await newWorld(["foo", "bob"]);

    // super(foo) thread（沉淀发起者）
    const superFoo = reviewerThread(baseDir, "foo", "t_superfoo");
    await import("@ooc/core/persistable").then((m) => m.writeThread(superFoo));

    // ① new_feat_branch(intent) 绑定
    const open1 = await executeNewFeatBranch({ thread: superFoo, args: { intent: "share into bob" } } as never);
    expect(JSON.parse(open1 as string).ok).toBe(true);
    const branch = superFoo.persistence!.stonesBranch!;
    expect(branch).toBe("feat/share-into-bob");

    // ② 直接编辑 feat worktree（触及 bob → reviewer 含 bob）
    await editInFeatWorktree(baseDir, branch, "objects/foo/self.md", "foo v2\n");
    await editInFeatWorktree(baseDir, branch, "objects/bob/readable.md", "bob touched by foo\n");

    // ③ evolve_self → 开 PR（reviewers 含 bob + supervisor），清绑定
    const fin1 = JSON.parse((await executeEvolveSelf({ thread: superFoo, args: {} } as never)) as string);
    expect(fin1.ok).toBe(true);
    const issueId = fin1.issueId as number;
    expect((fin1.reviewers as string[]).sort()).toEqual(["bob", "supervisor"]);
    expect(superFoo.persistence!.stonesBranch).toBeUndefined(); // 绑定已清

    // bob request_changes → P6 回投 super(foo)
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
    const open2 = await executeNewFeatBranch({ thread: superFoo, args: { intent: "share into bob" } } as never);
    expect(JSON.parse(open2 as string).ok).toBe(true);
    const reboundBranch = String(superFoo.persistence!.stonesBranch);
    expect(reboundBranch).toBe(String(branch)); // 幂等重绑同分支
    // 旧编辑仍在 worktree
    expect(await readFile(join(baseDir, "stones", branch, "objects", "foo", "self.md"), "utf8")).toBe("foo v2\n");

    // re-edit + re-submit
    await editInFeatWorktree(baseDir, branch, "objects/foo/self.md", "foo v3 revised\n");
    const fin2 = JSON.parse((await executeEvolveSelf({ thread: superFoo, args: {} } as never)) as string);
    expect(fin2.ok).toBe(true);
    expect(fin2.issueId).toBeGreaterThan(issueId); // 重开新 PR
  });
});
