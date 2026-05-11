import { describe, it, expect } from "bun:test";
import { OOC_TOOLS, buildAvailableTools } from "../tools/index";
import { dispatchToolCall } from "../tools";
import type { ThreadContext } from "../../thinkable/context";

describe("executable tools", () => {
  it("should export 5 OOC tools (excluding compress)", () => {
    expect(OOC_TOOLS).toHaveLength(5);
    
    const toolNames = OOC_TOOLS.map(t => t.name);
    expect(toolNames).toContain("open");
    expect(toolNames).toContain("refine");
    expect(toolNames).toContain("submit");
    expect(toolNames).toContain("close");
    expect(toolNames).toContain("wait");
    expect(toolNames).not.toContain("compress");
  });

  it("should return available tools via buildAvailableTools", () => {
    const mockThread = { id: "test", status: "running", events: [] } as ThreadContext;
    const tools = buildAvailableTools(mockThread);
    expect(tools).toBe(OOC_TOOLS);
    expect(tools).toHaveLength(5);
  });

  it("通过 open 创建 command form 并预填 args", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        type: "command",
        command: "talk",
        description: "回复用户",
        args: { target: "user", msg: "hello" }
      }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.command).toBe("talk");
    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({ target: "user", msg: "hello" });
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: expect.stringContaining("Form")
    });
  });

  it("通过 open knowledge 激活并固定 knowledge，且不创建 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        type: "knowledge",
        description: "查看 file_ops",
        args: { path: "path/computable/file_ops", lines: [0, 200], columns: [0, 200] }
      }
    });

    expect(thread.activeForms).toEqual([]);
    expect(thread.pinnedKnowledge).toEqual(["path/computable/file_ops"]);
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: expect.stringContaining("Knowledge path/computable/file_ops 已进入 Context")
    });
  });

  it("通过 open file 注入文件窗口，且不创建 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        type: "file",
        description: "查看目标文件",
        args: { path: "src/foo.ts", lines: [0, 200], columns: [0, 120] }
      }
    });

    expect(thread.activeForms).toEqual([]);
    expect(thread.windows?.["src/foo.ts"]).toEqual({
      type: "file",
      path: "src/foo.ts",
      description: "查看目标文件",
      lines: [0, 200],
      columns: [0, 120]
    });
  });

  it("通过 open command(todo) 创建 todo form 并预填提醒参数", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        type: "command",
        command: "todo",
        description: "登记待办",
        args: {
          content: "为 open tool 补测试",
          on_command_path: ["program.function"]
        }
      }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.command).toBe("todo");
    expect(thread.activeForms?.[0]?.description).toBe("登记待办");
    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
      content: "为 open tool 补测试",
      on_command_path: ["program.function"]
    });
    expect(thread.activeForms?.[0]?.commandPaths).toEqual(["todo", "todo.on_command_path"]);
  });

  it("通过 refine 累积 form 参数并更新 command path", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "talk", description: "继续对话" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "refine",
      arguments: { form_id: formId, args: { context: "continue", threadId: "remote-1" } }
    });

    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
      context: "continue",
      threadId: "remote-1"
    });
    expect(thread.activeForms?.[0]?.commandPaths).toContain("talk.continue");
  });

  it("通过 submit 把 form 切到 executed 并保留在 activeForms", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "plan", description: "制定计划" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "submit",
      arguments: { form_id: formId }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.status).toBe("executed");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: `[form executed] formId=${formId}`
    });
  });

  it("通过 close 取消 form 并移出 activeForms", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "program", description: "写代码" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { form_id: formId, reason: "不需要写代码了" }
    });

    expect(thread.activeForms).toEqual([]);
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "[close] Form " + formId + " 已关闭。原因：不需要写代码了"
    });
  });

  it("close 缺少 reason 时不关闭 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "program", description: "写代码" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { form_id: formId }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "[错误] close 参数不完整：必须提供 form_id 和 reason。"
    });
  });

  it("通过 wait 把线程切换为 waiting", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { reason: "等待用户输入" }
    });

    expect(thread.status).toBe("waiting");
    expect(thread.waitingType).toBe("explicit_wait");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "[wait] 线程进入等待状态: 等待用户输入"
    });
  });
});
