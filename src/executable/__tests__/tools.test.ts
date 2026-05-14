import { describe, it, expect } from "bun:test";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import { makeThread } from "../../__tests__/make-thread";

/**
 * tools.test — 5 原语在 ContextWindow 模型下的行为验证。
 *
 * 覆盖：
 * - tool 集合定义
 * - open 创建 command_exec window 并预填 args
 * - C 规则（args 完整 + 无新 knowledge → 自动 submit）
 * - refine 累积 args
 * - submit 成功自动移除；失败保留
 * - close 释放任意 window
 * - wait 切到 waiting + 写 inboxSnapshotAtWait
 */
describe("executable tools (ContextWindow model)", () => {
  it("export 5 OOC tools (excluding compress)", () => {
    expect(OOC_TOOLS).toHaveLength(5);
    const toolNames = OOC_TOOLS.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["open", "refine", "submit", "close", "wait"]));
    expect(toolNames).not.toContain("compress");
  });

  it("buildAvailableTools 返回固定五件套", () => {
    const tools = buildAvailableTools(makeThread());
    expect(tools).toBe(OOC_TOOLS);
    expect(tools).toHaveLength(5);
  });

  it("open(command=plan) 创建 command_exec form 并预填 args（plan 缺 plan 文本时不会被 C 规则自动 submit）", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        title: "制定计划",
        command: "plan",
        description: "拆解迁移工作",
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("open");
    expect(parsed.auto_submitted).toBe(false);

    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.command).toBe("plan");
  });

  it("C 规则触发自动 submit：plan 给齐 plan 字段一次到位执行", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        title: "立刻设定计划",
        command: "plan",
        args: { plan: "先 reshape，再迁移测试" },
      },
    });
    // form 应该已自动消失，plan 已落到 thread.plan
    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(0);
    expect(thread.plan).toBe("先 reshape，再迁移测试");
  });

  it("refine 累积 args 并刷新 commandPaths（do 加 wait 触发 do.wait path）", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { title: "派生子线程", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "refine",
      arguments: { title: "补 wait", form_id: formId, form_args: { wait: true } },
    });

    const form = thread.contextWindows.find((w) => w.id === formId);
    expect(form && form.type === "command_exec" && form.accumulatedArgs).toEqual({ wait: true });
    expect(form && form.type === "command_exec" && form.commandPaths).toContain("do.wait");
    expect(JSON.parse(output).ok).toBe(true);
  });

  it("submit 成功后 form 自动移除", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { title: "派生", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "refine",
      arguments: { title: "补 msg", form_id: formId, form_args: { msg: "处理日志" } },
    });
    const output = await dispatchToolCall(thread, {
      id: "call_3",
      name: "submit",
      arguments: { title: "执行 fork", form_id: formId },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.auto_removed).toBe(true);
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
  });

  it("submit 失败时 form 保留，等显式 close", async () => {
    const thread = makeThread();
    // do 缺 msg 直接 submit 会失败
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { title: "派生", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "submit",
      arguments: { title: "执行", form_id: formId },
    });
    const form = thread.contextWindows.find((w) => w.id === formId);
    expect(form?.type).toBe("command_exec");
    expect(form && form.type === "command_exec" && form.status).toBe("executed");
    expect(form && form.type === "command_exec" && form.result).toContain("[do] 缺少 msg");
  });

  it("close 释放任意 window", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { title: "派生", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { window_id: formId, reason: "不需要了" },
    });
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
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

  it("close creator do_window 时被拒绝并写 inject 事件", async () => {
    const thread = makeThread();
    const creator = thread.contextWindows.find((w) => w.type === "do" && w.isCreatorWindow);
    expect(creator).toBeDefined();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { window_id: creator!.id, reason: "尝试关闭" },
    });
    expect(JSON.parse(output).ok).toBe(false);
    expect(thread.contextWindows.find((w) => w.id === creator!.id)).toBeDefined();
    expect(thread.events.some((e) => e.kind === "inject" && e.text.includes("close 拒绝"))).toBe(true);
  });

  it("wait 把线程切到 waiting 并记录 inboxSnapshotAtWait", async () => {
    const thread = makeThread({ inbox: [] });
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { reason: "等待用户" },
    });
    expect(thread.status).toBe("waiting");
    expect(thread.inboxSnapshotAtWait).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toContain("等待 inbox 新消息");
  });

  it("未知 tool 返回错误", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_unknown",
      name: "compress" as never,
      arguments: {},
    });
    expect(JSON.parse(output)).toEqual({
      ok: false,
      tool: "compress",
      error: "[compress] tool 暂未实现。",
    });
  });
});
