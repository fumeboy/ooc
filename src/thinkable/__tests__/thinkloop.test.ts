import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as toolsModule from "../../executable/tools.ts";
import * as observableModule from "../../observable/index.ts";
import * as contextModule from "../context.ts";
import type { LlmClient } from "../llm/types";
import { think } from "../thinkloop.ts";

// 每个用例后恢复 spy，避免跨用例污染占位模块行为。
afterEach(() => {
  mock.restore();
  observableModule.clearLatestLlmObservation();
});

describe("think", () => {
  it("执行单轮 think 并记录 text 与 tool_use 事件", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-1",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([
      { role: "system", content: "context" }
    ]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    const writeOutput = spyOn(observableModule, "writeLatestLlmOutput");
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "需要等待",
          toolCalls: [
            {
              id: "call_1",
              name: "wait",
              arguments: { reason: "need input" }
            }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(writeInput).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(thread.events).toEqual([
      {
        category: "llm_interaction",
        kind: "text",
        text: "需要等待"
      },
      {
        category: "llm_interaction",
        kind: "tool_use",
        toolName: "wait",
        arguments: { reason: "need input" }
      }
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("pause 时在 tool 执行前把线程改为 paused", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-2",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    spyOn(observableModule, "isPausing").mockReturnValue(true);
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "暂停前输出",
          toolCalls: []
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("paused");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("llm 失败时写入 inject 并把线程改为 failed", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-3",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

    const llmClient: LlmClient = {
      async generate() {
        throw new Error("llm exploded");
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("failed");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "llm exploded"
    });
  });

  it("tool 失败时写入 inject 且停止后续 tool", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-4",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    const dispatch = spyOn(toolsModule, "dispatchToolCall")
      .mockRejectedValueOnce(new Error("first tool failed"))
      .mockResolvedValueOnce();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "claude",
          model: "claude-test",
          text: "",
          toolCalls: [
            { id: "call_1", name: "open", arguments: {} },
            { id: "call_2", name: "close", arguments: {} }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "claude", model: "claude-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("running");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "first tool failed"
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("连续多轮 think 可以跑通 open refine submit 与 todo command execute", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-5",
      status: "running",
      events: []
    };

    let round = 0;
    const llmClient: LlmClient = {
      async generate() {
        round += 1;

        if (round === 1) {
          return {
            provider: "openai",
            model: "gpt-test",
            text: "先登记一个待办",
            toolCalls: [
              {
                id: "call_open",
                name: "open",
                arguments: {
                  type: "command",
                  command: "todo",
                  description: "登记 thinkloop 集成待办"
                }
              }
            ]
          };
        }

        const formId = thread.activeForms?.[0]?.formId ?? "";
        if (round === 2) {
          return {
            provider: "openai",
            model: "gpt-test",
            text: "补充待办内容",
            toolCalls: [
              {
                id: "call_refine",
                name: "refine",
                arguments: {
                  form_id: formId,
                  args: {
                    content: "补充 thinkloop 集成测试",
                    on_command_path: ["program.function"]
                  }
                }
              }
            ]
          };
        }

        return {
          provider: "openai",
          model: "gpt-test",
          text: "提交待办",
          toolCalls: [
            {
              id: "call_submit",
              name: "submit",
              arguments: {
                form_id: formId
              }
            }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);
    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.command).toBe("todo");

    await think(thread, llmClient);
    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
      content: "补充 thinkloop 集成测试",
      on_command_path: ["program.function"]
    });

    await think(thread, llmClient);
    expect(thread.activeForms).toEqual([]);
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: expect.stringContaining("[submit] Form")
    });
  });

  it("buildContext 产出的 system xml 会进入 llm 输入", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-6",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "上一轮已经检查过日志"
        },
        {
          category: "llm_interaction",
          kind: "tool_use",
          toolName: "wait",
          arguments: {
            reason: "等待用户补充"
          }
        },
        {
          category: "context_change",
          kind: "inject",
          text: "系统注入了新的上下文"
        }
      ],
      inbox: [
        {
          id: "msg_in_1",
          fromThreadId: "t_child",
          toThreadId: "thread-6",
          content: "请处理我的结果",
          createdAt: 1,
          source: "do"
        }
      ],
      outbox: [
        {
          id: "msg_out_1",
          fromThreadId: "thread-6",
          toThreadId: "t_child",
          content: "先去检查日志",
          createdAt: 2,
          source: "do"
        }
      ]
    };

    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "",
          toolCalls: []
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    const messages = writeInput.mock.calls[0]?.[1];
    expect(messages?.[0]?.role).toBe("system");
    expect(messages?.[0]?.content).toContain("<context>");
    expect(messages?.[0]?.content).toContain("<inbox>");
    expect(messages?.[0]?.content).toContain("请处理我的结果");
    expect(messages?.[0]?.content).toContain("<outbox>");
    expect(messages?.[0]?.content).toContain("先去检查日志");
    expect(messages?.[0]?.content).not.toContain("上一轮已经检查过日志");
    expect(messages?.slice(1)).toEqual([
      {
        role: "assistant",
        content: "上一轮已经检查过日志"
      },
      {
        role: "assistant",
        content: '[tool_use:wait]\n{"reason":"等待用户补充"}'
      },
      {
        role: "user",
        content: "[context_change:inject]\n系统注入了新的上下文"
      }
    ]);
  });

  it("observable 记录的 llm 输入输出可以检查 think 过程", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-7",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "上一轮输出"
        }
      ]
    };
    const llmResult = {
      provider: "openai" as const,
      model: "gpt-test",
      text: "本轮输出",
      toolCalls: [
        {
          id: "call_wait",
          name: "wait" as const,
          arguments: {
            reason: "等待检查"
          }
        }
      ]
    };

    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();
    observableModule.clearLatestLlmObservation();

    const llmClient: LlmClient = {
      async generate({ messages, tools }) {
        const actualTools = tools ?? [];
        const observation = observableModule.getLatestLlmObservation();
        expect(observation?.input).toEqual({
          threadId: "thread-7",
          messages,
          tools: actualTools
        });
        expect(observation?.output).toBeUndefined();
        return llmResult;
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    const observation = observableModule.getLatestLlmObservation();
    expect(observation?.input?.threadId).toBe("thread-7");
    expect(observation?.input?.messages).toEqual([
      {
        role: "system",
        content: '<context><thread id="thread-7" status="running"></thread></context>'
      },
      {
        role: "assistant",
        content: "上一轮输出"
      }
    ]);
    expect(observation?.input?.tools).toHaveLength(1);
    expect(observation?.output).toEqual({
      threadId: "thread-7",
      result: llmResult
    });
    expect(thread.events.at(-2)).toEqual({
      category: "llm_interaction",
      kind: "text",
      text: "本轮输出"
    });
    expect(thread.events.at(-1)).toEqual({
      category: "llm_interaction",
      kind: "tool_use",
      toolName: "wait",
      arguments: {
        reason: "等待检查"
      }
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
