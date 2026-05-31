import { describe, it, expect } from "bun:test";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import { makeThread } from "../../__tests__/make-thread";
import { generateWindowId, ROOT_WINDOW_ID, type DoWindow } from "../windows/_shared/types";

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

  it("exec(method=plan_set) 创建 command_exec form 并预填 args（plan_set 缺 content 时不会被立即提交）", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "制定计划",
        method: "plan_set",
        description: "拆解迁移工作",
      },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("exec");
    expect(parsed.executed).toBe(false);

    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.command).toBe("plan_set");
  });

  it("args 给齐时 exec 立即执行：plan_set 给齐 content 一次到位执行（B 类塌缩：写 plan.md，不再造 plan_window）", async () => {
    const thread = makeThread();
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: {
        title: "立刻设定计划",
        method: "plan_set",
        args: { content: "- [ ] 先 reshape\n- [ ] 再迁移测试" },
      },
    });
    // form 给齐 content 立即执行后被移除
    const forms = thread.contextWindows.filter((w) => w.type === "command_exec");
    expect(forms).toHaveLength(0);
    // OOC-4 L5b: plan 塌缩为 plan.md（owner flow）；不再创建任何 ContextWindow
    expect(
      thread.contextWindows.find((w) => (w as { type: string }).type === "plan"),
    ).toBeUndefined();
    // 内存 thread 无 persistence → nil-persistence note；工具调用本身成功
    expect(JSON.parse(output).ok).toBe(true);
  });

  it("CommandExecWindow.refine 累积 args 并刷新 commandPaths（do 加 wait 触发 do.wait path）", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生子线程", method: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
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
      arguments: { title: "派生", method: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: {
        title: "补 msg",
        window_id: formId,
        method: "refine",
        args: { msg: "处理日志" },
      },
    });
    const output = await dispatchToolCall(thread, {
      id: "call_3",
      name: "exec",
      arguments: { title: "执行 fork", window_id: formId, method: "submit" },
    });

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
  });

  it("CommandExecWindow.submit 失败时 form 保留 status=failed, 可 refine 复活 (Round 13)", async () => {
    const thread = makeThread();
    // do 缺 msg 直接 submit 会失败
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", method: "do", description: "fork" },
    });
    const formId = thread.contextWindows.find((w) => w.type === "command_exec")?.id ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: { title: "执行", window_id: formId, method: "submit" },
    });
    const form = thread.contextWindows.find((w) => w.id === formId);
    expect(form?.type).toBe("command_exec");
    expect(form && form.type === "command_exec" && form.status).toBe("failed");
    expect(form && form.type === "command_exec" && form.result).toContain("[do] 缺少 msg");
  });

  it("close 释放任意 window", async () => {
    const thread = makeThread();
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", method: "do", description: "fork" },
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
    // OOC-4 L6b：等子线程改按子线程 id（childThreadId）；挂一个 running 子线程对话作合法来源。
    const thread = makeThread({ inbox: [] });
    const childId = "t_child_wait";
    const childDo: DoWindow = {
      id: generateWindowId("do"),
      type: "do",
      parentWindowId: ROOT_WINDOW_ID,
      title: "子线程任务",
      status: "running",
      createdAt: Date.now(),
      targetThreadId: childId,
    };
    thread.contextWindows = [...thread.contextWindows, childDo];
    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { on: childId, reason: "等待子线程回报" },
    });
    expect(thread.status).toBe("waiting");
    expect(thread.inboxSnapshotAtWait).toBe(0);
    expect(thread.waitingOn).toBe(childId);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.on).toBe(childId);
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
