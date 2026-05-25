import { describe, it, expect } from "bun:test";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import { makeThread } from "../../__tests__/make-thread";

/**
 * tools.test — 3 原语在 ContextWindow 模型下的行为验证（plan exec-refactor）。
 *
 * 覆盖：
 * - tool 集合定义（exec / close / wait）
 * - exec 在 args 不齐全时创建 command_exec form
 * - args 给齐 + 不引入新 path/knowledge → 立即执行（auto-execute）
 * - exec(form_id, "refine", args=...) 通过 CommandExecWindow.refine 命令累加 args
 * - exec(form_id, "submit") 通过 CommandExecWindow.submit 命令触发执行
 * - close 释放任意 window
 * - wait 切到 waiting + 写 inboxSnapshotAtWait
 */
describe("executable tools (ContextWindow model)", () => {
  it("export 4 OOC tools (P0b: compress 已加入)", () => {
    expect(OOC_TOOLS).toHaveLength(4);
    const toolNames = OOC_TOOLS.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["exec", "close", "wait", "compress"]));
  });

  it("buildAvailableTools 返回固定四件套", () => {
    const tools = buildAvailableTools(makeThread());
    expect(tools).toBe(OOC_TOOLS);
    expect(tools).toHaveLength(4);
  });

  it("exec(command=plan) 创建 command_exec form 并预填 args（plan 缺 plan 文本时不会被立即提交）", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "制定计划",
        command: "plan",
        description: "拆解迁移工作",
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("exec");
    expect(parsed.executed).toBe(false);

    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.command).toBe("plan");
  });

  it("args 给齐时 exec 立即执行：plan 给齐 plan 字段一次到位执行", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "立刻设定计划",
        command: "plan",
        args: { plan: "先 reshape，再迁移测试" },
      },
    });
    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(0);
    expect(thread.plan).toBe("先 reshape，再迁移测试");
  });

  it("CommandExecWindow.refine 累积 args 并刷新 commandPaths（do 加 wait 触发 do.wait path）", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生子线程", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: {
        title: "补 wait",
        window_id: formId,
        command: "refine",
        args: { wait: true },
      },
    });

    const form = thread.contextWindows.find((w) => w.id === formId);
    expect(form && form.type === "command_exec" && form.accumulatedArgs).toEqual({ wait: true });
    expect(form && form.type === "command_exec" && form.commandPaths).toContain("do.wait");
    expect(JSON.parse(output).ok).toBe(true);
  });

  it("CommandExecWindow.submit 成功后 form 自动移除", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: {
        title: "补 msg",
        window_id: formId,
        command: "refine",
        args: { msg: "处理日志" },
      },
    });
    const output = await dispatchToolCall(thread, {
      id: "call_3",
      name: "exec",
      arguments: { title: "执行 fork", window_id: formId, command: "submit" },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
  });

  it("CommandExecWindow.submit 失败时 form 保留，等显式 close", async () => {
    const thread = makeThread();
    // do 缺 msg 直接 submit 会失败
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", command: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: { title: "执行", window_id: formId, command: "submit" },
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
      name: "exec",
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

  it("wait 把线程切到 waiting 并记录 inboxSnapshotAtWait + waitingOn", async () => {
    const thread = makeThread({ inbox: [] });
    const creatorDo = thread.contextWindows.find(
      (w) => w.type === "do" && w.isCreatorWindow,
    );
    expect(creatorDo).toBeDefined();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { on: creatorDo!.id, reason: "等待 creator 回信" },
    });
    expect(thread.status).toBe("waiting");
    expect(thread.inboxSnapshotAtWait).toBe(0);
    expect(thread.waitingOn).toBe(creatorDo!.id);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.on).toBe(creatorDo!.id);
  });

  it("compress(scope=windows) 缺 target_ids 时返回结构化错误", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_compress_empty",
      name: "compress",
      arguments: { scope: "windows" },
    });
    expect(JSON.parse(output)).toEqual({
      ok: false,
      tool: "compress",
      error: "compress(scope=windows) 缺少 target_ids 参数(string[])。",
    });
  });

  it("compress(scope=auto) 抛 not-implemented (留给 P0e emergency_guard)", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_compress_auto",
      name: "compress",
      arguments: { scope: "auto" },
    });
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("compress");
    expect(parsed.error).toContain("not implemented yet");
  });

  it("compress(scope=events) 缺 summary → 结构化错误 (P0f)", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_compress_events_no_summary",
      name: "compress",
      arguments: { scope: "events" },
    });
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("compress");
    expect(parsed.error).toContain("summary");
  });
});
