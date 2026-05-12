import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import { buildContext, type ThreadContext } from "../context";
import { clearKnowledgeLoaderCache } from "../knowledge";
import { createStoneObject, knowledgeDir } from "../../persistable";

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

    // tool_use 事件刻意不进 transcript，避免 LLM 看到自己上一轮被
    // 渲染成纯文本 [tool_use:NAME] 后模仿这种格式输出文本而非真正的 tool call。
    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain('<thread id="t_process" status="running">');
    expect(messages[0]?.content).toContain('<knowledge path="internal/executable/basic">');
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

  it("renders command knowledge paths on forms and keeps knowledge content in knowledge entries", async () => {
    const thread: ThreadContext = {
      id: "t_knowledge",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_fn",
          command: "program",
          description: "调 add",
          createdAt: 1,
          accumulatedArgs: { function: "add" },
          commandPaths: ["program", "program.function"],
          loadedKnowledgePaths: [],
          commandKnowledgePaths: ["internal/executable/program/basic", "internal/executable/program/input"],
          status: "open"
        },
        {
          formId: "f_no_knowledge",
          command: "program",
          description: "shell",
          createdAt: 2,
          accumulatedArgs: { language: "shell", code: "ls" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ]
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";

    expect(xml).toContain("<knowledge_entries>");
    expect(xml).toContain('<knowledge path="internal/executable/program/basic">');
    expect(xml).toContain("program 用于执行一段代码");

    function sliceForm(id: string): string {
      const start = xml.indexOf(`<form id="${id}"`);
      const end = xml.indexOf("</form>", start) + "</form>".length;
      return xml.slice(start, end);
    }
    expect(sliceForm("f_fn")).toContain("<command_knowledge_paths>");
    expect(sliceForm("f_fn")).toContain("<path>internal/executable/program/basic</path>");
    expect(sliceForm("f_fn")).not.toContain("program 用于执行一段代码");
    expect(sliceForm("f_no_knowledge")).toContain("<command_knowledge_paths>");
  });

  it("renders command knowledge paths on forms and knowledge entries in knowledge area", async () => {
    const thread = {
      id: "t_protocol",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_program_open",
          command: "program",
          description: "写 server 文件",
          createdAt: 1,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          commandKnowledgePaths: ["internal/executable/program/base"],
          status: "open"
        },
        {
          formId: "f_program_done",
          command: "program",
          description: "调 add",
          createdAt: 2,
          accumulatedArgs: { function: "add", args: { a: 1, b: 2 } },
          commandPaths: ["program", "program.function"],
          loadedKnowledgePaths: [],
          commandKnowledgePaths: ["internal/executable/program/base", "internal/executable/program/function"],
          status: "executed",
          result: "# function: add\n[returnValue]\n3\n[exit 0]"
        }
      ]
    } as unknown as ThreadContext;

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";

    expect(xml).not.toContain("<next_action>");
    expect(xml).not.toContain("<protocol_hint>");
    expect(xml).toContain("<command_knowledge_paths>");
    expect(xml).toContain("<path>internal/executable/program/basic</path>");
    expect(xml).toContain('<knowledge path="internal/executable/basic">');
  });

  it("always injects executable basic knowledge into system context", async () => {
    const messages = await buildContext({ id: "t1", status: "running", events: [] });
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain("open / refine / submit / close / wait");
  });

  it("deduplicates identical knowledge entries across multiple forms", async () => {
    const thread: ThreadContext = {
      id: "t_dedupe",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_1",
          command: "program",
          description: "shell one",
          createdAt: 1,
          accumulatedArgs: { language: "shell", code: "pwd" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        },
        {
          formId: "f_2",
          command: "program",
          description: "shell two",
          createdAt: 2,
          accumulatedArgs: { language: "shell", code: "ls" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ]
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";

    expect(xml.match(/<path>internal\/executable\/program\/basic<\/path>/g)?.length).toBe(2);
    expect(xml.match(/<knowledge path="internal\/executable\/program\/basic">/g)?.length).toBe(1);
  });

  it("renders indented xml with comments for active forms and knowledge entries", async () => {
    const messages = await buildContext({
      id: "t_comment",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_1",
          command: "program",
          description: "shell",
          createdAt: 1,
          accumulatedArgs: { language: "shell", code: "ls" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ]
    });

    const xml = messages[0]?.content ?? "";
    expect(xml).toContain("<!-- active forms:");
    expect(xml).toContain("<!-- executable knowledge entries:");
    expect(xml).toContain("\n  <thread ");
    expect(xml).toContain("\n    <active_forms>");
  });
});

describe("buildContext active_knowledge rendering", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    clearKnowledgeLoaderCache();
  });

  it("renders summary entry when only show_description_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const root = knowledgeDir(stoneRef);
    await writeFile(
      join(root, "summary-only.md"),
      `---\ndescription: 仅描述\nactivates_on:\n  show_description_when: [program]\n---\nbody summary-only`
    );

    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f1",
          command: "program",
          description: "",
          createdAt: 1,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" }
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('<knowledge path="summary-only" presentation="summary">');
    expect(xml).toContain("<description>仅描述</description>");
    expect(xml).not.toContain("body summary-only");
  });

  it("renders full entry with body when show_content_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const root = knowledgeDir(stoneRef);
    await writeFile(
      join(root, "full-doc.md"),
      `---\ndescription: 全文\nactivates_on:\n  show_content_when: [program.shell]\n---\n这是 full-doc 正文`
    );

    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f1",
          command: "program",
          description: "",
          createdAt: 1,
          accumulatedArgs: {},
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        }
      ],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" }
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('<knowledge path="full-doc" presentation="full">');
    expect(xml).toContain("这是 full-doc 正文");
  });

  it("omits <active_knowledge> when no activation hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" }
    };
    const messages = await buildContext(thread);
    expect(messages[0]?.content).not.toContain("<active_knowledge>");
  });
});
