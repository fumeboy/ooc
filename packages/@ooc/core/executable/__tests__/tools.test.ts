import { describe, it, expect } from "bun:test";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import { makeThread } from "../../__tests__/make-thread";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
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
 * 经 exec 调 agency 时须把 window_id 指向一个 class 解析得到 `_builtin/agent` 的窗。
 * talk 统一两形态：target=别的对象 ⇒ peer 会话；target=自己 ⇒ fork 子线程。
 */
const AGENT_WIN = {
  id: "agent",
  class: "_builtin/agent",
  parentWindowId: "root",
  title: "agent",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
  // class="_builtin/agent" 是继承类、非 ContextWindow union discriminant → 经 unknown 转。
} as unknown as ContextWindow;

/**
 * tools.test — 3 原语在 ContextWindow 模型下的行为验证。
 *
 * 覆盖：
 * - tool 集合定义（exec / close / wait）
 * - exec 在 args 不齐全时创建 method_exec form
 * - args 给齐 + 不引入新 path/knowledge → 立即执行（auto-execute）
 * - exec(form_id, "refine", args=...) 通过 MethodExecWindow.refine 命令累加 args
 * - exec(form_id, "submit") 通过 MethodExecWindow.submit 命令触发执行
 * - close 释放任意 window
 * - wait 切到 waiting + 写 inboxSnapshotAtWait
 */
describe("executable tools (ContextWindow model)", () => {
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

  it("exec(method=plan) 创建 method_exec form 并预填 args（plan 缺 plan 文本时不会被立即提交）", async () => {
    const thread = makeThread({ extraWindows: [AGENT_WIN] });
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "制定计划",
        window_id: "agent",
        method: "plan",
        description: "拆解迁移工作",
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("exec");
    expect(parsed.executed).toBe(false);

    const forms = (thread.contextWindows as ContextWindow[]).filter((w) => w.class === "method_exec");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.method).toBe("plan");
  });

  it("args 给齐时 exec 立即执行：plan 给齐 plan 字段一次到位执行", async () => {
    const thread = makeThread({ extraWindows: [AGENT_WIN] });
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "立刻设定计划",
        window_id: "agent",
        method: "plan",
        args: { plan: "先 reshape，再迁移测试" },
      },
    });
    const forms = (thread.contextWindows as ContextWindow[]).filter((w) => w.class === "method_exec");
    expect(forms).toHaveLength(0);
    // plan 升格为 plan_window；不再写 thread.plan 字段
    const planWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "plan");
    expect(planWindow?.class).toBe("plan");
    expect(planWindow && planWindow.class === "plan" && planWindow.description).toBe(
      "先 reshape，再迁移测试",
    );
  });

  it("MethodExecWindow.refine 累积 args 并刷新 intentPaths（talk fork 加 wait 触发 talk.wait path）", async () => {
    const thread = makeThread({ persistence: persistenceOf(), extraWindows: [AGENT_WIN] });
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生子线程", window_id: "agent", method: "talk", description: "fork", args: { target: SELF } },
    });
    const formId = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "method_exec")?.id ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: {
        title: "补 wait",
        window_id: formId,
        method: "refine",
        args: { wait: true },
      },
    });

    const form = (thread.contextWindows as ContextWindow[]).find((w) => w.id === formId);
    expect(form && form.class === "method_exec" && form.accumulatedArgs).toEqual({ target: SELF, wait: true });
    expect(form && form.class === "method_exec" && form.intentPaths).toContain("talk.wait");
    expect(JSON.parse(output).ok).toBe(true);
  });

  it("MethodExecWindow.submit 成功后 form 自动移除", async () => {
    const thread = makeThread({ persistence: persistenceOf() });
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", method: "talk", description: "fork", args: { target: SELF, msg: "处理日志" } },
    });
    // With quick_exec_submit, talk fork auto-submits when target+msg are provided.
    // The form should be removed after successful execution.
    const formAfter = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "method_exec");
    expect(formAfter).toBeUndefined();
  });

  it("MethodExecWindow.submit 失败时 form 保留 status=failed, 可 refine 复活", async () => {
    const thread = makeThread({ persistence: persistenceOf(), extraWindows: [AGENT_WIN] });
    // talk fork 缺 msg 直接 submit 会失败
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", window_id: "agent", method: "talk", description: "fork", args: { target: SELF } },
    });
    const formId = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "method_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: { title: "执行", window_id: formId, method: "submit" },
    });
    const form = (thread.contextWindows as ContextWindow[]).find((w) => w.id === formId);
    expect(form?.class).toBe("method_exec");
    expect(form && form.class === "method_exec" && form.status).toBe("failed");
    expect(form && form.class === "method_exec" && form.result).toContain("缺少 msg");
  });

  it("close 释放任意 window", async () => {
    const thread = makeThread({ persistence: persistenceOf(), extraWindows: [AGENT_WIN] });
    // 只给 target 不给 msg → 留在 method_exec form（不 auto-submit），供下面 close 释放
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", window_id: "agent", method: "talk", description: "fork", args: { target: SELF } },
    });
    const formId = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "method_exec")?.id ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { window_id: formId, reason: "不需要了" },
    });
    expect((thread.contextWindows as ContextWindow[]).find((w) => w.id === formId)).toBeUndefined();
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

  it("close creator talk_window 时被拒绝并写 inject 事件", async () => {
    const thread = makeThread();
    const creator = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "talk" && w.isCreatorWindow);
    expect(creator).toBeDefined();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { window_id: creator!.id, reason: "尝试关闭" },
    });
    expect(JSON.parse(output).ok).toBe(false);
    expect((thread.contextWindows as ContextWindow[]).find((w) => w.id === creator!.id)).toBeDefined();
    expect(thread.events.some((e) => e.kind === "inject" && e.text.includes("close 拒绝"))).toBe(true);
  });

  it("wait 把线程切到 waiting 并记录 inboxSnapshotAtWait + waitingOn", async () => {
    const thread = makeThread({ inbox: [] });
    const creator = (thread.contextWindows as ContextWindow[]).find(
      (w) => w.class === "talk" && w.isCreatorWindow,
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
