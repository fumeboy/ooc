import { describe, it, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import { makeThread } from "../../__tests__/make-thread";
import { type ContextWindow, isCreatorWindowId } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { ThreadPersistenceRef } from "../../persistable/common";

const SELF = "alice";
const persistenceOf = (threadId = "t_root"): ThreadPersistenceRef => ({
  baseDir: "/tmp/__test__",
  sessionId: "s_test",
  objectId: SELF,
  threadId,
});

/**
 * agency 方法（talk/plan/todo/end）已从 root 迁到 `_builtin/agent` 类。
 * 经 exec 调 agency 时把 window_id 指向一个 class 解析得到 `_builtin/agent` 的窗。
 * Wave 4 裁决：form 收集机制废弃——args 由本次 exec 直传，method 在目标窗上立即执行。
 */
const AGENT_WIN = {
  id: "agent",
  class: "_builtin/agent",
  title: "agent",
  status: "open",
  createdAt: Date.now(),
  data: {},
  // class="_builtin/agent" 是继承类、非 ContextWindow union discriminant → 经 unknown 转。
} as unknown as ContextWindow;

/**
 * tools.test — 3 原语在 Wave 4 对象模型下的行为验证。
 *
 * 覆盖（仍存在的行为）：
 * - tool 集合定义（exec / close / wait）
 * - exec 直传 args 在目标窗上立即执行（agency plan → 造 plan 对象；form 机制已废）
 * - close 释放任意 window（含 creator——旧 onClose 拒绝 hook 已随承重墙退役）
 * - close 缺 reason 拒绝
 * - wait 切到 waiting + 写 inboxSnapshotAtWait + waitingOn
 * - compress 经 exec(method="compress") 路由 + scope 行为
 */
describe("executable tools (object model)", () => {
  it("export 3 OOC 原语（compress 降为 exec 调用的方法）", () => {
    expect(OOC_TOOLS).toHaveLength(3);
    const toolNames = OOC_TOOLS.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["exec", "close", "wait"]));
    expect(toolNames).not.toContain("compress"); // compress 不再是顶层 tool
  });

  it("buildAvailableTools 返回固定三件套", () => {
    const tools = buildAvailableTools(makeThread());
    expect(tools).toBe(OOC_TOOLS);
    expect(tools).toHaveLength(3);
  });

  it("exec(method=plan) 直传 args 立即执行：造 plan 对象、plan 文本落入 description", async () => {
    const thread = makeThread({ persistence: persistenceOf(), extraWindows: [AGENT_WIN] });
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "立刻设定计划",
        window_id: "agent",
        method: "plan",
        args: { plan: "先 reshape，再迁移测试" },
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.method).toBe("plan");
    expect(parsed.executed).toBe(true);

    // form 机制已废：不再产生 method_exec 窗，而是直接造一个 plan 对象（class 归一为 plan）。
    expect((thread.contextWindows as ContextWindow[]).some((w) => w.class === "method_exec")).toBe(false);
    const planWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "_builtin/agent/plan");
    expect(planWindow).toBeDefined();
    // args.plan 落入 plan 对象 Data.description。
    expect((planWindow!.data as { description?: string }).description).toBe("先 reshape，再迁移测试");
  });

  it("exec 失败：method 未注册在目标窗上时返回结构化 ok:false（fail-loud，不静默）", async () => {
    // self 窗 class=alice、无 _builtin/agent 父 → 没有 agency 方法；plan 未注册。
    const thread = makeThread({ persistence: persistenceOf() });
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "plan", method: "plan", args: { plan: "x" } },
    });
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("exec");
    expect(parsed.error).toContain("plan");
    expect(parsed.error).toContain("未注册");
  });

  it("close 释放任意 window（含 creator——旧 onClose 拒绝 hook 已退役）", async () => {
    const thread = makeThread({ persistence: persistenceOf() });
    const creator = (thread.contextWindows as ContextWindow[]).find(
      (w) => w.class === THREAD_CLASS_ID && isCreatorWindowId(w.id),
    );
    expect(creator).toBeDefined();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { window_id: creator!.id, reason: "不需要了" },
    });
    expect((thread.contextWindows as ContextWindow[]).find((w) => w.id === creator!.id)).toBeUndefined();
    expect(JSON.parse(output).ok).toBe(true);
  });

  it("close 缺 reason 时拒绝", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { window_id: "f_x" },
    });
    expect(JSON.parse(output)).toEqual({
      ok: false,
      tool: "close",
      error: "close 缺少 reason 参数。",
    });
  });

  it("close 不存在的 window → 结构化错误", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { window_id: "does_not_exist", reason: "x" },
    });
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("close");
    expect(parsed.error).toContain("不存在");
  });

  it("wait 把线程切到 waiting 并记录 inboxSnapshotAtWait + waitingOn", async () => {
    const thread = makeThread({ inbox: [] });
    const creator = (thread.contextWindows as ContextWindow[]).find(
      (w) => w.class === THREAD_CLASS_ID && isCreatorWindowId(w.id),
    );
    expect(creator).toBeDefined();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { on: creator!.id, reason: "等待 creator 回信" },
    });
    expect(thread.status).toBe("waiting");
    expect(thread.inboxSnapshotAtWait).toBe(0);
    expect(thread.waitingOn).toBe(creator!.id);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.on).toBe(creator!.id);
  });

  // compress 经 exec(method="compress") 调用（不再是顶层 tool）；exec.ts 拦截后转 handleCompressTool，
  // 故输出 JSON 仍带 tool:"compress"。以下验证 exec→compress 路由 + scope=windows/events/auto 行为。
  const execCompress = (thread: ReturnType<typeof makeThread>, compressArgs: Record<string, unknown>) =>
    dispatchToolCall(thread, {
      id: "call_exec_compress",
      name: "exec",
      arguments: { method: "compress", title: "compress", args: compressArgs },
    });

  it("exec(compress, scope=windows) 缺 target_ids 时返回结构化错误", async () => {
    const output = await execCompress(makeThread(), { scope: "windows" });
    expect(JSON.parse(output)).toEqual({
      ok: false,
      tool: "compress",
      error: "compress(scope=windows) 缺少 target_ids 参数(string[])。",
    });
  });

  it("exec(compress, scope=auto) 抛 not-implemented（留给 emergency_guard）", async () => {
    const parsed = JSON.parse(await execCompress(makeThread(), { scope: "auto" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("compress");
    expect(parsed.error).toContain("not implemented yet");
  });

  it("exec(compress, scope=events) 缺 summary → 结构化错误", async () => {
    const parsed = JSON.parse(await execCompress(makeThread(), { scope: "events" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("compress");
    expect(parsed.error).toContain("summary");
  });
});
