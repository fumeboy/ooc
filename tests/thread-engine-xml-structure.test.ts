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

import { runWithThreadTree, contextToMessages, type EngineConfig, type ActiveFormView } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/client.js";
import { eventBus } from "../src/server/events.js";
import type { StoneData, DirectoryEntry, TraitDefinition } from "../src/types/index.js";
import type { ThreadContext } from "../src/thread/context-builder.js";

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
      const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user");
      const re = /<form id="(f_[^"]+)" command="([^"]+)"/g;
      let formId = "f_unknown";
      let m: RegExpExecArray | null;
      while ((m = re.exec(userMsg?.content ?? "")) !== null) {
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
 * 读取 session 下第一轮 loop 的 input.txt（Root 线程）
 *
 * engine 在 <flowsDir>/<sessionId>/objects/<objectName>/threads/<threadId>/ 下写出：
 *   - llm.input.txt（最后一轮覆盖）
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
      } else if (e.isFile() && e.name.endsWith(".input.txt")) {
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

  test("顶层 <system>/<user> 容器存在且按层级缩进；叶子 content 原样不缩进", async () => {
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
    expect(input).toMatch(/^--- system ---\n<system>/m);
    expect(input).toContain("</system>");
    expect(input).toMatch(/\n--- user ---\n<user>/);
    expect(input).toContain("</user>");

    /* ---- identity 在 <system> 之下（2 空格缩进） ---- */
    expect(input).toMatch(/\n  <identity name="alice">\n/);
    expect(input).toMatch(/\n  <\/identity>\n/);

    /* ---- directory 容器嵌套 <object>（4 空格缩进） ---- */
    expect(input).toMatch(/\n  <directory>\n/);
    expect(input).toMatch(/\n    <object name="bob">/);

    /* ---- status 为 <user> 直接子节点（2 空格缩进） ---- */
    expect(input).toMatch(/\n  <status>/);

    /* ---- Markdown 内容原样（表格 / 代码块不被前导空格污染） ---- */
    expect(input).toMatch(/^\| col1 \| col2 \|/m);
    expect(input).toMatch(/^\|------\|------\|/m);
    expect(input).toContain("```ts");
    expect(input).toMatch(/^function foo\(\) \{ return 1; \}/m);
  });

  test("inbox 作为 <user> 子节点，message 进一步嵌套", async () => {
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
   * Phase 3 — llm_input_viewer：<active-forms> 应作为 <user> 子节点渲染，而不是
   * engine 在 user message 字符串末尾追加的兄弟节点。
   */
  test("activeForms 作为 <user> 子节点序列化", () => {
    const ctx: ThreadContext = {
      name: "alice",
      whoAmI: "我是 alice",
      parentExpectation: "",
      plan: "",
      process: "",
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
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg).toBeDefined();
    const body = userMsg!.content;

    /* 必须是 <user> 内部，不再出现在 </user> 之后 */
    const userCloseIdx = body.lastIndexOf("</user>");
    const activeFormsIdx = body.indexOf("<active-forms>");
    expect(activeFormsIdx).toBeGreaterThan(-1);
    expect(userCloseIdx).toBeGreaterThan(activeFormsIdx);

    /* 缩进 2 格（作为 <user> 子节点） */
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
      process: "",
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
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg!.content).not.toContain("<active-forms>");
  });
});
