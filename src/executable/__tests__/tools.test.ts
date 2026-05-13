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

  it("should describe the form protocol explicitly in open/refine/submit tools", () => {
    const open = OOC_TOOLS.find((tool) => tool.name === "open");
    const refine = OOC_TOOLS.find((tool) => tool.name === "refine");
    const submit = OOC_TOOLS.find((tool) => tool.name === "submit");

    expect(open?.description).toContain("业务参数必须放在 args");
    expect(refine?.description).toContain("args 对象");
    expect(submit?.description).toContain("不接受新的业务参数");
  });

  it("通过 open 创建 command form 并预填 args", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
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
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "open",
      message: expect.stringContaining("Form")
    });
    expect(thread.events).toEqual([]);
  });

  it("通过 open knowledge 激活并固定 knowledge，且不创建 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
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
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "open",
      message: expect.stringContaining("Knowledge path/computable/file_ops 已进入 Context")
    });
    expect(thread.events).toEqual([]);
  });

  it("通过 open file 注入文件窗口，且不创建 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
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
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "open",
      message: "File src/foo.ts 已进入 Context。"
    });
    expect(thread.events).toEqual([]);
  });

  it("open file 缺少 args.path 时返回错误且不写入 undefined window", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: {
        type: "file",
        title: "读取缺少路径的文件",
        description: "路径只写在 description 中是不合法的"
      }
    });

    expect(JSON.parse(output)).toEqual({
      ok: false,
      tool: "open",
      error: 'open(type="file") 缺少 args.path 参数。'
    });
    expect(thread.windows).toBeUndefined();
    expect(thread.events).toEqual([]);
  });

  it("open schema 使用 OpenAI 兼容的简单 object schema，并描述 file/knowledge 的 args.path 约束", () => {
    const open = OOC_TOOLS.find((tool) => tool.name === "open");
    const schema = open?.inputSchema as {
      allOf?: unknown;
      properties?: {
        args?: {
          properties?: {
            lines?: { items?: unknown };
            columns?: { items?: unknown };
          };
        };
      };
    };
    const serialized = JSON.stringify(schema);

    expect(schema.allOf).toBeUndefined();
    expect(serialized).not.toContain('"if"');
    expect(serialized).not.toContain('"then"');
    expect(schema.properties?.args?.properties?.lines?.items).toEqual({ type: "number" });
    expect(schema.properties?.args?.properties?.columns?.items).toEqual({ type: "number" });
    expect(serialized).toContain("文件或 knowledge 路径");
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
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "refine",
      arguments: { form_id: formId, args: { context: "continue", threadId: "remote-1" } }
    });

    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
      context: "continue",
      threadId: "remote-1"
    });
    expect(thread.activeForms?.[0]?.commandPaths).toContain("talk.continue");
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "refine",
      message: expect.stringContaining(`Form ${formId} 已累积参数`)
    });
    expect(thread.events).toEqual([]);
  });

  it("未知 tool 通过 function_call_output 返回错误而不是写入 inject 事件", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
      id: "call_unknown",
      name: "compress" as never,
      arguments: {}
    });

    expect(JSON.parse(output)).toEqual({ ok: false, tool: "compress", error: "[compress] tool 暂未实现。" });
    expect(thread.events).toEqual([]);
  });

  it("通过 submit 把 form 切到 executed 并保留在 activeForms", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "plan", description: "制定计划" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "submit",
      arguments: { form_id: formId }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.status).toBe("executed");
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "submit",
      message: '[form executed] form "制定计划" 已执行完成。'
    });
    expect(thread.events).toEqual([]);
  });

  it("通过 close 取消 form 并移出 activeForms", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "program", description: "写代码" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { form_id: formId, reason: "不需要写代码了" }
    });

    expect(thread.activeForms).toEqual([]);
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "close",
      message: "[close] Form " + formId + " 已关闭。原因：不需要写代码了"
    });
    expect(thread.events).toEqual([]);
  });

  it("close 缺少 reason 时不关闭 form", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "open",
      arguments: { type: "command", command: "program", description: "写代码" }
    });

    const formId = thread.activeForms?.[0]?.formId ?? "";
    const output = await dispatchToolCall(thread, {
      id: "call_2",
      name: "close",
      arguments: { form_id: formId }
    });

    expect(thread.activeForms).toHaveLength(1);
    expect(JSON.parse(output)).toEqual({ ok: false, tool: "close", error: "close 缺少 reason 参数。" });
    expect(thread.events).toEqual([]);
  });

  it("close 缺少 form_id 时给出错误，不再支持 knowledge close 分支", async () => {
    const thread = {
      id: "test",
      status: "running",
      events: [],
      pinnedKnowledge: ["api/openai"]
    } as ThreadContext;

    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "close",
      arguments: { type: "knowledge", path: "ghost", reason: "试试" }
    });

    expect(thread.pinnedKnowledge).toEqual(["api/openai"]);
    expect(JSON.parse(output)).toEqual({ ok: false, tool: "close", error: "close 缺少 form_id 参数。" });
    expect(thread.events).toEqual([]);
  });

  it("通过 wait 把线程切换为 waiting", async () => {
    const thread = { id: "test", status: "running", events: [] } as ThreadContext;

    const output = await dispatchToolCall(thread, {
      id: "call_1",
      name: "wait",
      arguments: { reason: "等待用户输入" }
    });

    expect(thread.status).toBe("waiting");
    expect(thread.waitingType).toBe("explicit_wait");
    expect(JSON.parse(output)).toEqual({
      ok: true,
      tool: "wait",
      message: "[wait] 线程进入等待状态: 等待用户输入"
    });
    expect(thread.events).toEqual([]);
  });
});
