import { describe, expect, it } from "bun:test";
import { buildContext, type ThreadContext } from "../context";

describe("buildContext", () => {
  it("renders inbox and outbox into the system xml context", async () => {
    const thread: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: [],
      creatorThreadId: "t_root",
      plan: "先处理 inbox",
      activeForms: [
        {
          formId: "f_1",
          command: "todo",
          description: "登记待办",
          createdAt: 1,
          accumulatedArgs: {
            content: "补充 buildContext 测试"
          },
          commandPaths: ["todo"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ],
      inbox: [
        {
          id: "msg_in_1",
          fromThreadId: "t_child",
          toThreadId: "t_parent",
          content: "来自子线程的消息",
          createdAt: 1,
          source: "do"
        }
      ],
      outbox: [
        {
          id: "msg_out_1",
          fromThreadId: "t_parent",
          toThreadId: "t_child",
          content: "发给子线程的消息",
          createdAt: 2,
          source: "do"
        }
      ]
    };

    const messages = await buildContext(thread);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("<context>");
    expect(messages[0]?.content).toContain('<thread id="t_parent" status="running">');
    expect(messages[0]?.content).toContain("<creator_thread_id>t_root</creator_thread_id>");
    expect(messages[0]?.content).toContain("<plan>先处理 inbox</plan>");
    expect(messages[0]?.content).toContain("<inbox>");
    expect(messages[0]?.content).toContain("来自子线程的消息");
    expect(messages[0]?.content).toContain("<outbox>");
    expect(messages[0]?.content).toContain("发给子线程的消息");
    expect(messages[0]?.content).toContain("<active_forms>");
    expect(messages[0]?.content).not.toContain("<todos>");
  });

  it("renders active todo forms but does not render a standalone todos window", async () => {
    const thread = {
      id: "t_todo_form",
      status: "running",
      events: [],
      todos: [
        {
          content: "不应作为独立窗口渲染",
          onCommandPath: ["do.fork"],
          createdAt: 1
        }
      ],
      activeForms: [
        {
          formId: "f_todo",
          command: "todo",
          description: "处理初始消息",
          createdAt: 1,
          accumulatedArgs: {
            content: "处理用户的初始请求",
            on_command_path: ["do.fork"]
          },
          commandPaths: ["todo", "todo.on_command_path"],
          loadedKnowledgePaths: []
        }
      ]
    } as unknown as ThreadContext;

    const messages = await buildContext(thread);

    expect(messages[0]?.content).toContain("<active_forms>");
    expect(messages[0]?.content).toContain('<form id="f_todo" status="open">');
    expect(messages[0]?.content).toContain("<command>todo</command>");
    expect(messages[0]?.content).toContain("处理用户的初始请求");
    expect(messages[0]?.content).not.toContain("<todos>");
  });

  it("appends process events as ordinary llm messages after the system xml", async () => {
    const thread: ThreadContext = {
      id: "t_process",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "已经完成第一步"
        },
        {
          category: "llm_interaction",
          kind: "thinking",
          text: "需要先检查上下文"
        },
        {
          category: "llm_interaction",
          kind: "tool_use",
          toolName: "open",
          arguments: {
            type: "command",
            command: "todo"
          }
        },
        {
          category: "context_change",
          kind: "inject",
          text: "用户补充了新的要求"
        }
      ]
    };

    const messages = await buildContext(thread);

    expect(messages).toHaveLength(5);
    expect(messages[0]).toEqual({
      role: "system",
      content: '<context><thread id="t_process" status="running"></thread></context>'
    });
    expect(messages[0]?.content).not.toContain("已经完成第一步");
    expect(messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: "已经完成第一步"
      },
      {
        role: "assistant",
        content: "[thinking]\n需要先检查上下文"
      },
      {
        role: "assistant",
        content: '[tool_use:open]\n{"type":"command","command":"todo"}'
      },
      {
        role: "user",
        content: "[context_change:inject]\n用户补充了新的要求"
      }
    ]);
  });

  it("renders form status attribute and shows result only when executed", async () => {
    const thread: ThreadContext = {
      id: "t_status",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_open",
          command: "program",
          description: "shell",
          createdAt: 1,
          accumulatedArgs: { language: "shell", code: "ls" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        },
        {
          formId: "f_executing",
          command: "program",
          description: "shell",
          createdAt: 2,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          status: "executing"
        },
        {
          formId: "f_executed",
          command: "program",
          description: "shell",
          createdAt: 3,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          status: "executed",
          result: "$ ls\n[stdout]\nfoo\n[exit 0]"
        }
      ]
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";

    expect(xml).toContain('<form id="f_open" status="open">');
    expect(xml).toContain('<form id="f_executing" status="executing">');
    expect(xml).toContain('<form id="f_executed" status="executed">');

    // 切片 + 字符串包含断言：避免跨 form 边界的贪婪匹配
    function sliceForm(id: string): string {
      const start = xml.indexOf(`<form id="${id}"`);
      const end = xml.indexOf("</form>", start) + "</form>".length;
      return xml.slice(start, end);
    }
    expect(sliceForm("f_executed")).toContain("<result>$ ls\n[stdout]\nfoo\n[exit 0]</result>");
    expect(sliceForm("f_open")).not.toContain("<result>");
    expect(sliceForm("f_executing")).not.toContain("<result>");
  });
});
