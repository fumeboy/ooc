import { describe, expect, it } from "bun:test";
import type { LlmClient } from "../llm/types";
import type { ThreadContext } from "../context";
import { runScheduler } from "../scheduler";

describe("scheduler", () => {
  it("wakes a waiting parent after its awaited child finishes", async () => {
    const child: ThreadContext = {
      id: "t_child",
      status: "running",
      events: [],
      parentThreadId: "t_parent",
      creatorThreadId: "t_parent",
      activeForms: [
        {
          formId: "f_initial_todo",
          command: "todo",
          description: "处理初始消息",
          createdAt: 1,
          accumulatedArgs: {
            content: "处理子线程初始消息"
          },
          commandPaths: ["todo"],
          loadedKnowledgePaths: []
        }
      ]
    };
    const parent: ThreadContext = {
      id: "t_parent",
      status: "waiting",
      events: [],
      childThreadIds: ["t_child"],
      childThreads: {
        t_child: child
      },
      waitingType: "await_children",
      awaitingChildren: ["t_child"]
    };

    let rounds = 0;
    const llmClient: LlmClient = {
      async generate() {
        rounds += 1;
        if (rounds === 1) {
          return {
            provider: "openai",
            model: "gpt-test",
            text: "先提交初始 todo",
            toolCalls: [
              {
                id: "call_submit_todo",
                name: "submit",
                arguments: {
                  form_id: "f_initial_todo"
                }
              }
            ]
          };
        }

        if (rounds === 2) {
          return {
            provider: "openai",
            model: "gpt-test",
            text: "先打开 end form",
            toolCalls: [
              {
                id: "call_open",
                name: "open",
                arguments: {
                  type: "command",
                  command: "end",
                  description: "结束当前子线程",
                  args: {
                    reason: "done",
                    summary: "child finished"
                  }
                }
              }
            ]
          };
        }

        const formId = child.activeForms?.find((form) => form.command === "end")?.formId ?? "";
        return {
          provider: "openai",
          model: "gpt-test",
          text: "提交 end form",
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

    expect(parent.childThreads?.t_child?.activeForms?.[0]?.command).toBe("todo");

    await runScheduler(parent, llmClient, { maxTicks: 5 });

    expect(parent.childThreads?.t_child?.status).toBe("done");
    expect(parent.status).toBe("running");
    expect(parent.waitingType).toBeUndefined();
    expect(parent.awaitingChildren).toEqual([]);
  });

  it("runs the oldest running thread first by lastExecutedAt", async () => {
    const childOld: ThreadContext = {
      id: "t_old",
      status: "running",
      events: [],
      lastExecutedAt: 10
    };
    const childNew: ThreadContext = {
      id: "t_new",
      status: "running",
      events: [],
      lastExecutedAt: 20
    };
    const root: ThreadContext = {
      id: "t_root",
      status: "waiting",
      events: [],
      childThreads: {
        t_new: childNew,
        t_old: childOld
      }
    };
    const executed: string[] = [];
    const llmClient: LlmClient = {
      async generate({ messages }) {
        const system = messages[0]?.content ?? "";
        if (system.includes('id="t_old"')) executed.push("t_old");
        if (system.includes('id="t_new"')) executed.push("t_new");
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

    await runScheduler(root, llmClient, { maxTicks: 1 });

    expect(executed).toEqual(["t_old"]);
  });
});
