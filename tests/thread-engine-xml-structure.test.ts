/**
 * 线程引擎 contextToMessages 的 XML 结构化输出验证
 *
 * 目标：
 * - 验证顶层 <system> 与 <user> 容器存在
 * - 验证嵌套层级按 2 空格缩进（仅标签行）
 * - 验证叶子节点 content 原样输出（不被前导空格污染，Markdown / 代码块安全）
 * - 验证 inbox / directory 等容器正确嵌套
 *
 * 通过 runWithThreadTree 驱动一轮执行，从 writeDebugLoop 写出的 loop_000.input.txt
 * 读回内容进行断言（这是唯一的 contextToMessages 可观测入口，无需导出内部函数）。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_llm_input_structured_view.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { contextToMessages, type ActiveFormView } from "../src/thinkable/context/messages.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/llm/client.js";
import { eventBus } from "../src/observable/server/events.js";
import type { StoneData, DirectoryEntry, TraitDefinition } from "../src/shared/types/index.js";
import type { ThreadContext } from "../src/thinkable/context/builder.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_engine_xml_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `我是 ${name}` },
    talkable: { whoAmI: `${name} 简介`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

/**
 * 通用脚本 mock：按顺序播放 steps。
 * 每个 step 是函数：(messages) => MockLLMResponseFnResult
 */
function makeScript(steps: Array<(messages: unknown[]) => MockLLMResponseFnResult>) {
  let i = 0;
  return (messages: unknown[]) => {
    const step = steps[i++] ?? steps[steps.length - 1]!;
    return step(messages);
  };
}

/** 两步 open/submit 序列：驱动 engine 走完一个 command */
function openSubmit(command: string, submitArgs: Record<string, unknown>) {
  return [
    (_messages: unknown[]) => ({
      content: "",
      toolCalls: [toolCall("open", { type: "command", command, description: `测试 ${command}` })],
    }),
    (messages: unknown[]) => {
      const allContent = (messages as Array<{ role: string; content: string }>).map(m => m.content).join("\n");
      const re = /<form id="(f_[^"]+)" command="([^"]+)"/g;
      let formId = "f_unknown";
      let m: RegExpExecArray | null;
      while ((m = re.exec(allContent)) !== null) {
        if (m[2] === command) { formId = m[1]!; break; }
      }
      return {
        content: "",
        toolCalls: [toolCall("submit", { form_id: formId, ...submitArgs })],
      };
    },
  ];
}

/**
 * 读取 session 下第一轮 debug loop 的 input.txt（Root 线程）
 *
 * engine 在 <flowsDir>/<sessionId>/objects/<objectName>/threads/<threadId>/ 下写出：
 *   - llm.input.txt（每轮 LLM 调用前覆盖）
 *   - debug/loop_NNN.input.txt（每轮归档）
 */
function readFirstLoopInput(sessionId: string, objectName: string): string {
  const objectDir = join(FLOWS_DIR, sessionId, "objects", objectName);
  const stack: string[] = [objectDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (!existsSync(cur)) continue;
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile() && /^loop_\d{3}\.input\.txt$/.test(e.name)) {
        return readFileSync(p, "utf-8");
      }
    }
  }
  throw new Error(`未找到 loop input.txt: ${objectDir}`);
}

describe("contextToMessages XML 结构化输出", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(FLOWS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    eventBus.removeAllListeners("sse");
  });

  test("顶层 <context> system 容器存在且按层级缩进；叶子 content 原样不缩进", async () => {
    const stone = makeStone("alice");

    const directory: DirectoryEntry[] = [
      { name: "bob", whoAmI: "bob 是另一个对象", functions: [] },
    ];

    const llm = new MockLLMClient({
      responseFn: makeScript(openSubmit("return", { summary: "done" })),
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      stone,
      directory,
      traits: [],
      debugEnabled: true,
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    /* 消息内容包含 Markdown-like 结构，验证内容不被缩进污染 */
    const userMsg = [
      "# 标题",
      "",
      "| col1 | col2 |",
      "|------|------|",
      "| a    | b    |",
      "",
      "```ts",
      "function foo() { return 1; }",
      "```",
    ].join("\n");

    const res = await runWithThreadTree("alice", userMsg, "user", config);
    expect(res.status).toBe("done");

    const input = readFirstLoopInput(res.sessionId, "alice");

    /* ---- 顶层容器 ---- */
    expect(input).toMatch(/^--- system ---\n<context>/m);
    expect(input).toContain("</context>");
    expect(input).not.toMatch(/\n--- user ---\n<user>/);

    /* ---- identity 在 <context> 之下（2 空格缩进） ---- */
    expect(input).toMatch(/\n  <identity name="alice">\n/);
    expect(input).toMatch(/\n  <\/identity>\n/);

    /* ---- directory 容器嵌套 <object>（4 空格缩进） ---- */
    expect(input).toMatch(/\n  <directory>\n/);
    expect(input).toMatch(/\n    <object name="bob">/);

    /* ---- status 为 <context> 直接子节点（2 空格缩进） ---- */
    expect(input).toMatch(/\n  <status>/);

    /* ---- Markdown 内容原样（表格 / 代码块不被前导空格污染） ---- */
    expect(input).toMatch(/^\| col1 \| col2 \|/m);
    expect(input).toMatch(/^\|------\|------\|/m);
    expect(input).toContain("```ts");
    expect(input).toMatch(/^function foo\(\) \{ return 1; \}/m);
  });

  test("inbox 作为 <context> 子节点，message 进一步嵌套", async () => {
    const stone = makeStone("alice");
    const traits: TraitDefinition[] = [];
    const directory: DirectoryEntry[] = [];

    const llm = new MockLLMClient({
      responseFn: makeScript(openSubmit("return", { summary: "ack" })),
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      stone,
      directory,
      traits,
      debugEnabled: true,
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    const res = await runWithThreadTree("alice", "你好世界", "user", config);
    expect(res.status).toBe("done");

    const input = readFirstLoopInput(res.sessionId, "alice");

    /* inbox 容器存在并缩进 2 格 */
    expect(input).toMatch(/\n  <inbox[^>]*>\n/);
    expect(input).toContain("</inbox>");
    /* 内部 message 缩进 4 格 */
    expect(input).toMatch(/\n    <message [^>]*>/);
    /* 消息内容（原样） */
    expect(input).toContain("你好世界");
  });

  /**
   * Phase 3 — llm_input_viewer：<active-forms> 应作为 <context> 子节点渲染，而不是
   * engine 在 user message 字符串末尾追加的兄弟节点。
   */
  test("activeForms 作为 <context> 子节点序列化", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "",
      plan: "",
      processEvents: [],
      locals: {},
      instructions: [],
      knowledge: [],
      creator: "user",
      creationMode: "root",
      childrenSummary: "",
      ancestorSummary: "",
      siblingSummary: "",
      inbox: [],
      todos: [],
      directory: [],
      scopeChain: [],
      paths: undefined,
      status: "running",
      relations: [],
    };

    const activeForms: ActiveFormView[] = [
      { formId: "f_abc_01", command: "talk", description: "测试 talk form", trait: "contact" },
      { formId: "f_xyz_02", command: "return", description: "测试 return form" },
    ];

    const messages = contextToMessages(ctx, undefined, activeForms);
    const systemMsg = messages.find(m => m.role === "system");
    expect(systemMsg).toBeDefined();
    const body = systemMsg!.content;

    /* 必须是 <context> 内部，不再出现在 </context> 之后 */
    const contextCloseIdx = body.lastIndexOf("</context>");
    const activeFormsIdx = body.indexOf("<active-forms>");
    expect(activeFormsIdx).toBeGreaterThan(-1);
    expect(contextCloseIdx).toBeGreaterThan(activeFormsIdx);

    /* 缩进 2 格（作为 <context> 子节点） */
    expect(body).toMatch(/\n {2}<active-forms>\n/);
    expect(body).toMatch(/\n {2}<\/active-forms>\n/);

    /* 内部 <form> 缩进 4 格，保留 id/command 属性 */
    expect(body).toMatch(/\n {4}<form id="f_abc_01" command="talk" trait="contact">/);
    expect(body).toMatch(/\n {4}<form id="f_xyz_02" command="return">/);
  });

  /**
   * Phase 3 — llm_input_viewer：没有 active form 时，<active-forms> 节点不应存在。
   */
  test("没有活跃 form 时不渲染 <active-forms>", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "",
      plan: "",
      processEvents: [],
      locals: {},
      instructions: [],
      knowledge: [],
      creator: "user",
      creationMode: "root",
      childrenSummary: "",
      ancestorSummary: "",
      siblingSummary: "",
      inbox: [],
      todos: [],
      directory: [],
      scopeChain: [],
      paths: undefined,
      status: "running",
      relations: [],
    };

    const messages = contextToMessages(ctx);
    const systemMsg = messages.find(m => m.role === "system");
    expect(systemMsg!.content).not.toContain("<active-forms>");
  });

  test("主要 context 元素带 XML 注释解释语义", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "完成一次验证",
      plan: "1. 读取输入",
      processEvents: [],
      locals: { artifact: "report.md" },
      instructions: [],
      knowledge: [],
      creator: "root_1",
      creationMode: "sub_thread",
      childrenSummary: "- [done] 子任务 A",
      ancestorSummary: "- [running] 根任务",
      siblingSummary: "- [waiting] 兄弟任务",
      inbox: [],
      todos: [{ id: "todo_1", content: "复核输出", status: "pending", createdAt: 1000 }],
      directory: [],
      scopeChain: [],
      paths: { rootDir: "/tmp/ooc" },
      status: "running",
      relations: [],
    };

    const body = contextToMessages(ctx)[0]!.content;

    expect(body).toContain("<!-- 任务：用户消息或父线程对当前线程的期望 -->");
    expect(body).toContain("<!-- thread creator 是当前线程通过 return 交付 summary 的接收方；它不是你的身份来源，也不一定是用户。 -->");
    expect(body).toContain("<!-- 计划：当前线程自己的工作计划，可随着执行推进更新 -->");
    expect(body).toContain("<!-- 局部变量：当前线程保存的结构化中间结果 -->");
    expect(body).toContain("<!-- 待办：当前线程尚未完成的事项 -->");
    expect(body).toContain("<!-- 祖先线程：从根线程到父线程的状态摘要，帮助理解上游背景 -->");
    expect(body).toContain("<!-- 兄弟线程：同一父线程下其他子线程的状态摘要，避免重复工作 -->");
    expect(body).toContain("<!-- 路径：当前对象和会话可用的文件系统位置 -->");
    expect(body).toContain("<!-- 状态：当前线程在调度器中的状态 -->");
  });

  test("process events 从 context XML 中拆出为独立 messages", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "完成一次验证",
      plan: "1. 读取输入\n2. 调用工具",
      processEvents: [
        { type: "message_in", content: "用户提出需求", timestamp: 1000 },
        { type: "tool_use", name: "open", title: "打开 return 表单", args: { type: "command", command: "return" }, content: "open return", timestamp: 2000 },
        { type: "inject", content: "Form f_123 已创建；新的 knowledge 已注入", timestamp: 3000 },
      ],
      locals: {},
      instructions: [],
      knowledge: [],
      creator: "user",
      creationMode: "root",
      childrenSummary: "",
      ancestorSummary: "",
      siblingSummary: "",
      inbox: [],
      todos: [],
      directory: [],
      scopeChain: [],
      paths: undefined,
      status: "running",
      relations: [],
    };

    const messages = contextToMessages(ctx);

    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("<context>");
    expect(messages[0]!.content).toContain("<task>");
    expect(messages[0]!.content).not.toContain("<process>");
    expect(messages[0]!.content).not.toContain("用户提出需求");
    expect(messages[0]!.content).not.toContain("Form f_123 已创建");

    const eventMessages = messages.slice(1);
    expect(eventMessages).toHaveLength(3);
    expect(eventMessages[0]!.role).toBe("user");
    expect(eventMessages[0]!.content).toContain('<process_event type="message_in" category="llm_interaction"');
    expect(eventMessages[1]!.role).toBe("assistant");
    expect(eventMessages[1]!.content).toContain('<process_event type="tool_use" category="llm_interaction"');
    expect(eventMessages[1]!.content).toContain('<args>');
    expect(eventMessages[2]!.role).toBe("user");
    expect(eventMessages[2]!.content).toContain('<process_event type="inject" category="context_change"');
  });

  test("历史 thinking 不作为 process event message 回灌给模型", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "继续任务",
      plan: "",
      processEvents: [
        { type: "thinking", content: "这是一段隐藏推理链，不应该回灌给模型", timestamp: 1000 },
        { type: "text", content: "可见回复", timestamp: 2000 },
      ],
      locals: {},
      instructions: [],
      knowledge: [],
      creator: "user",
      creationMode: "root",
      childrenSummary: "",
      ancestorSummary: "",
      siblingSummary: "",
      inbox: [],
      todos: [],
      directory: [],
      scopeChain: [],
      paths: undefined,
      status: "running",
      relations: [],
    };

    const messages = contextToMessages(ctx);
    const allContent = messages.map((m) => m.content).join("\n");

    expect(allContent).not.toContain('type="thinking"');
    expect(allContent).not.toContain("隐藏推理链");
    expect(allContent).toContain('type="text"');
    expect(allContent).toContain("可见回复");
  });
});
