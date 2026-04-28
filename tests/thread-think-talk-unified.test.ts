/**
 * do / talk 指令统一（fork vs continue）四模式单元测试
 *
 * 验证目标：
 * 1. executable/tools/open.ts 的 command enum 含 "do"，不含 "create_sub_thread" / "continue_sub_thread"
 * 2. engine 处理 `do(context="fork")` — 在当前线程下 fork 新子线程
 * 3. engine 处理 `do(context="continue", threadId)` — 向指定线程 inbox 投递消息
 * 4. engine 拒绝 `do(context="continue")` 无 threadId 的非法调用
 * 5. talk 统一 schema 的 continue 路径（向对方 threadId 投递）
 * 6. talk(context="fork", threadId) 在对方线程下 fork 新子线程
 *
 * @ref docs/工程管理/迭代/all/20260422_refactor_think_talk_unify.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/llm/client.js";
import type { StoneData } from "../src/shared/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import { OPEN_TOOL, SUBMIT_TOOL } from "../src/executable/tools/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_think_talk_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
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

beforeEach(() => {
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========== 1. schema 契约 ========== */

describe("tool schema — do / talk 统一参数", () => {
  test("open tool 的 command enum 含 do，不含 create_sub_thread / continue_sub_thread", () => {
    const commandEnum = (OPEN_TOOL.function.parameters as { properties: { command: { enum: string[] } } })
      .properties.command.enum;
    expect(commandEnum).toContain("do");
    expect(commandEnum).toContain("talk");
    expect(commandEnum).not.toContain("create_sub_thread");
    expect(commandEnum).not.toContain("continue_sub_thread");
  });

  test("submit tool 不再含 msg / threadId / context 字段（已改用 refine()）", () => {
    const props = (SUBMIT_TOOL.function.parameters as { properties: Record<string, unknown> })
      .properties;
    /* 这些参数现在通过 refine() 传递，不出现在 submit schema */
    expect(props.msg).toBeUndefined();
    expect(props.threadId).toBeUndefined();
    expect(props.context).toBeUndefined();
  });

  test("submit tool 不再含 continue_thread 字段", () => {
    const props = (SUBMIT_TOOL.function.parameters as { properties: Record<string, unknown> }).properties;
    expect(props.continue_thread).toBeUndefined();
  });
});

/* ========== 2. do(fork) —— fork 自己的 thread ========== */

describe("do(context=fork) — 在当前线程下派生子线程", () => {
  test("无 threadId 时默认 fork 当前线程", async () => {
    let phase = 0;
    let parentFormId = "";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const isChild = /creator mode="sub_thread"/.test(userContent);
        if (isChild) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="return"/);
          if (m?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "子返回", form_id: m[1], summary: "done" })] };
          return { content: "", toolCalls: [toolCall("open", { title: "子 open return", type: "command", command: "return", description: "done" })] };
        }
        if (phase === 0) { phase = 1; return { content: "", toolCalls: [toolCall("open", { title: "父 open do", type: "command", command: "do", description: "fork" })] }; }
        if (phase === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="do"/);
          parentFormId = m?.[1] ?? "f_err";
          phase = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "分析任务", form_id: parentFormId, context: "fork", msg: "请分析 X" })] };
        }
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "父返回", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "父 open return", type: "command", command: "return", description: "done" })] };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("obj"),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 40, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("obj", "hi", "user", config);
    expect(result.status).toBe("done");

    /* 验证：新建了 1 个子线程，title="分析任务"，parentId=rootId */
    const threadsJson = JSON.parse(await Bun.file(join(FLOWS_DIR, result.sessionId, "objects", "obj", "threads.json")).text());
    const rootId = threadsJson.rootId as string;
    const children = Object.values(threadsJson.nodes as Record<string, { title: string; parentId?: string }>)
      .filter((n) => n.parentId === rootId);
    expect(children.length).toBe(1);
    expect(children[0]!.title).toBe("分析任务");
  });
});

/* ========== 3. do(continue) —— continue 自己的 thread ========== */

describe("do(context=continue, threadId) — 向指定线程 inbox 投递", () => {
  test("必须指定 threadId，否则 engine 拒绝", async () => {
    let step = 0;
    let formId = "";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 0) { step = 1; return { content: "", toolCalls: [toolCall("open", { title: "open do", type: "command", command: "do", description: "continue 无 threadId" })] }; }
        if (step === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="do"/);
          formId = m?.[1] ?? "f_err";
          step = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "尝试 continue", form_id: formId, context: "continue", msg: "补充信息" })] };
        }
        /* 继续 return 结束 */
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "return", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "open return", type: "command", command: "return", description: "done" })] };
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("obj"),
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 30, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("obj", "hi", "user", config);
    expect(result.status).toBe("done");

    /* 验证：没有新子线程（只有 root），且 root thread.json.events 含错误注入 */
    const threadsJson = JSON.parse(await Bun.file(join(FLOWS_DIR, result.sessionId, "objects", "obj", "threads.json")).text());
    const rootId = threadsJson.rootId as string;
    const nodeCount = Object.keys(threadsJson.nodes).length;
    expect(nodeCount).toBe(1);
    const rootThread = JSON.parse(await Bun.file(join(FLOWS_DIR, result.sessionId, "objects", "obj", "threads", rootId, "thread.json")).text());
    const injects = ((rootThread.events) as Array<{ type: string; content: string }>).filter((a) => a.type === "inject" && a.content.includes("threadId 参数"));
    expect(injects.length).toBeGreaterThan(0);
  });
});

/* ========== 4. talk(fork, 无 threadId) — 兼容当前 talk 默认行为 ========== */

describe("talk(context=fork) — 对方新根线程（默认）", () => {
  test("不带 threadId 时，调用 onTalk，不带 forkUnderThreadId / continueThreadId", async () => {
    let step = 0;
    let formId = "";
    const onTalkCalls: Array<{ target: string; msg: string; fork?: string; cont?: string }> = [];
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 0) { step = 1; return { content: "", toolCalls: [toolCall("open", { title: "open talk", type: "command", command: "talk", description: "给 bob 打招呼" })] }; }
        if (step === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="talk"/);
          formId = m?.[1] ?? "f_err";
          step = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "打招呼", form_id: formId, target: "bob", msg: "hi", context: "fork" })] };
        }
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "return", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "open return", type: "command", command: "return", description: "done" })] };
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("alice"),
      onTalk: async (target, message, _from, _fromThreadId, _sess, continueThreadId, _mid, forkUnderThreadId) => {
        onTalkCalls.push({ target, msg: message, fork: forkUnderThreadId, cont: continueThreadId });
        return { reply: null, remoteThreadId: "th_bob_root" };
      },
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 30, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("alice", "你好", "user", config);
    expect(result.status).toBe("done");
    expect(onTalkCalls.length).toBeGreaterThan(0);
    const call = onTalkCalls[0]!;
    expect(call.target).toBe("bob");
    expect(call.msg).toBe("hi");
    expect(call.fork).toBeUndefined();
    expect(call.cont).toBeUndefined();
  });
});

/* ========== 5. talk(fork, threadId) — 对方线程下 fork 子线程 ========== */

describe("talk(context=fork, threadId=X) — 对方线程下 fork 新子线程（新能力）", () => {
  test("onTalk 收到 forkUnderThreadId 参数", async () => {
    let step = 0;
    let formId = "";
    const onTalkCalls: Array<{ target: string; msg: string; fork?: string; cont?: string }> = [];
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 0) { step = 1; return { content: "", toolCalls: [toolCall("open", { title: "open talk", type: "command", command: "talk", description: "派生到对方线程下" })] }; }
        if (step === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="talk"/);
          formId = m?.[1] ?? "f_err";
          step = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "派生", form_id: formId, target: "bob", msg: "please analyze", context: "fork", threadId: "th_bob_work" })] };
        }
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "return", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "open return", type: "command", command: "return", description: "done" })] };
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("alice"),
      onTalk: async (target, message, _from, _ft, _s, continueThreadId, _mid, forkUnderThreadId) => {
        onTalkCalls.push({ target, msg: message, fork: forkUnderThreadId, cont: continueThreadId });
        return { reply: null, remoteThreadId: "th_bob_subN" };
      },
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 30, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("alice", "hi", "user", config);
    expect(result.status).toBe("done");
    const call = onTalkCalls[0]!;
    expect(call.fork).toBe("th_bob_work");
    expect(call.cont).toBeUndefined();
  });
});

/* ========== 6. talk(continue, threadId) — 向对方已有线程投递 ========== */

describe("talk(context=continue, threadId=X) — 向对方已有线程投递（新能力）", () => {
  test("onTalk 收到 continueThreadId 参数", async () => {
    let step = 0;
    let formId = "";
    const onTalkCalls: Array<{ target: string; msg: string; fork?: string; cont?: string }> = [];
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 0) { step = 1; return { content: "", toolCalls: [toolCall("open", { title: "open talk", type: "command", command: "talk", description: "继续对方线程" })] }; }
        if (step === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="talk"/);
          formId = m?.[1] ?? "f_err";
          step = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "追问", form_id: formId, target: "bob", msg: "one more detail", context: "continue", threadId: "th_bob_work" })] };
        }
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "return", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "open return", type: "command", command: "return", description: "done" })] };
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("alice"),
      onTalk: async (target, message, _f, _ft, _s, continueThreadId, _mid, forkUnderThreadId) => {
        onTalkCalls.push({ target, msg: message, fork: forkUnderThreadId, cont: continueThreadId });
        return { reply: null, remoteThreadId: "th_bob_work" };
      },
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 30, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("alice", "hi", "user", config);
    expect(result.status).toBe("done");
    const call = onTalkCalls[0]!;
    expect(call.cont).toBe("th_bob_work");
    expect(call.fork).toBeUndefined();
  });

  test("无 threadId 的 continue 被 engine 拒绝（不调 onTalk）", async () => {
    let step = 0;
    let formId = "";
    const onTalkCalls: unknown[] = [];
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 0) { step = 1; return { content: "", toolCalls: [toolCall("open", { title: "open talk", type: "command", command: "talk", description: "continue 无 threadId" })] }; }
        if (step === 1) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="talk"/);
          formId = m?.[1] ?? "f_err";
          step = 2;
          return { content: "", toolCalls: [toolCall("submit", { title: "非法 continue", form_id: formId, target: "bob", msg: "X", context: "continue" })] };
        }
        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) return { content: "", toolCalls: [toolCall("submit", { title: "return", form_id: rm[1], summary: "done" })] };
        return { content: "", toolCalls: [toolCall("open", { title: "open return", type: "command", command: "return", description: "done" })] };
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR, flowsDir: FLOWS_DIR, llm, directory: [], traits: [], stone: makeStone("alice"),
      onTalk: async (..._args) => { onTalkCalls.push(_args); return { reply: null, remoteThreadId: "x" }; },
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 30, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("alice", "hi", "user", config);
    expect(result.status).toBe("done");
    /* engine 应阻止该调用，onTalk 不应被调用 */
    expect(onTalkCalls.length).toBe(0);
  });
});
