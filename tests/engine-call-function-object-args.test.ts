/**
 * Engine program trait/method 对象参数测试
 *
 * 背景：Trait Namespace 重构后，llm_methods 注册的方法签名统一为
 * `(ctx, argsObj)` 对象解构风格。engine.ts 的 program trait/method 分支需要与
 * 沙箱 callMethod 保持一致的调用协议：永远把 argsObj 整体作为第二个参数传入。
 *
 * 本文件覆盖 3 个场景：
 * 1. 对象风格 llm_method（新协议 `(ctx, { message })`）能被 program trait/method 正确调用
 * 2. 空参数 `{}` 场景（如 `getReflectState`）
 * 3. needsCtx=false 时，args 对象直接作为第一个参数传入
 *
 * @ref docs/工程管理/迭代/all/20260421_bugfix_call_function对象参数.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, TraitMethod } from "../src/types/index.js";
import { eventBus } from "../src/observable/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_program_trait_method_args_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

/** 最小 Stone */
function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `我是 ${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

/** ToolCall 辅助构造 */
function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

type MockStep = string | ToolCall | ((messages: unknown[]) => MockLLMResponseFnResult);

function makeScript(steps: MockStep[]): (messages: unknown[]) => MockLLMResponseFnResult {
  let i = 0;
  return (messages: unknown[]) => {
    const step = steps[i++] ?? steps[steps.length - 1]!;
    if (typeof step === "function") return step(messages);
    if (typeof step === "string") return { content: "", thinkingContent: step };
    return { content: "", toolCalls: [step] };
  };
}

/** 构造一个带一个 llm method 的 trait（新协议：对象解构） */
function makeTraitWithObjectMethod(
  traitRelName: string,
  methodName: string,
  fn: TraitMethod["fn"],
  params: TraitMethod["params"],
  needsCtx = true,
): TraitDefinition {
  const method: TraitMethod = {
    name: methodName,
    description: `测试方法 ${methodName}`,
    params,
    fn,
    needsCtx,
  };
  return {
    namespace: "kernel",
    name: traitRelName,
    kind: "trait",
    type: "how_to_use_tool",
    description: `测试 trait ${traitRelName}`,
    readme: "",
    deps: [],
    llmMethods: { [methodName]: method },
  };
}

beforeEach(() => {
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

describe("engine program trait/method 对象参数", () => {
  test("调用新协议 (ctx, {message}) llm_method：argsObj 整体作为第二参数", async () => {
    /* 捕获 fn 实际收到的参数 */
    let capturedCtx: unknown = null;
    let capturedArgs: unknown = null;

    const trait = makeTraitWithObjectMethod(
      "demo_obj",
      "talkToSelf",
      async (ctx: unknown, argsObj: unknown) => {
        capturedCtx = ctx;
        capturedArgs = argsObj;
        return { ok: true };
      },
      [{ name: "message", type: "string", description: "消息", required: true }],
      true,
    );

    const traitId = "kernel:demo_obj";

    /* 脚本：open program(trait/method) → submit → return */
    const steps: MockStep[] = [
      /* step 1: open program，指定 trait + method */
      () => ({ content: "", toolCalls: [toolCall("open", {
        type: "command",
        command: "program",
        description: "调 talkToSelf",
        trait: traitId,
        method: "talkToSelf",
      })] }),
      /* step 2: submit 带 args 对象 */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="program"/);
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            form_id: match?.[1] ?? "f_unknown",
            args: { message: "hello from test" },
          })],
        };
      },
      /* step 3: open return */
      () => ({ content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] }),
      /* step 4: submit return */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: match?.[1] ?? "f_unknown", summary: "done" })] };
      },
    ];

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm: new MockLLMClient({ responseFn: makeScript(steps) }),
      directory: [],
      traits: [trait],
      stone: makeStone("demo"),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 50, deadlockGracePeriodMs: 0 },
    };

    const result = await runWithThreadTree("demo", "hi", "user", config);

    /* 关键断言：fn 收到的第二个参数是完整 argsObj（新协议） */
    expect(capturedArgs).toEqual({ message: "hello from test" });
    expect(capturedCtx).toBeTruthy();
    expect(result.status).toBe("done");
  });

  test("空参数方法 (ctx, _args)：args 为 {} 传入", async () => {
    let captured: unknown = null;

    const trait = makeTraitWithObjectMethod(
      "empty_args",
      "getState",
      async (_ctx: unknown, argsObj: unknown) => {
        captured = argsObj;
        return { ok: true };
      },
      [],
      true,
    );

    const traitId = "kernel:empty_args";

    const steps: MockStep[] = [
      () => ({ content: "", toolCalls: [toolCall("open", {
        type: "command",
        command: "program",
        description: "调 getState",
        trait: traitId,
        method: "getState",
      })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="program"/);
        return {
          content: "",
          toolCalls: [toolCall("submit", { form_id: match?.[1] ?? "f_unknown", args: {} })],
        };
      },
      () => ({ content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: match?.[1] ?? "f_unknown", summary: "done" })] };
      },
    ];

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm: new MockLLMClient({ responseFn: makeScript(steps) }),
      directory: [],
      traits: [trait],
      stone: makeStone("demo"),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 50, deadlockGracePeriodMs: 0 },
    };

    const result = await runWithThreadTree("demo", "hi", "user", config);
    expect(result.status).toBe("done");
    expect(captured).toEqual({});
  });

  test("needsCtx=false：args 对象作为第一个参数传入", async () => {
    let capturedFirst: unknown = null;

    const trait = makeTraitWithObjectMethod(
      "no_ctx",
      "doIt",
      async (argsObj: unknown) => {
        capturedFirst = argsObj;
        return "ok";
      },
      [{ name: "payload", type: "string", description: "p", required: false }],
      false, // needsCtx=false
    );

    const traitId = "kernel:no_ctx";

    const steps: MockStep[] = [
      () => ({ content: "", toolCalls: [toolCall("open", {
        type: "command",
        command: "program",
        description: "调 doIt",
        trait: traitId,
        method: "doIt",
      })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="program"/);
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            form_id: match?.[1] ?? "f_unknown",
            args: { payload: "data" },
          })],
        };
      },
      () => ({ content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === "user")?.content ?? "";
        const match = userMsg.match(/<form id="(f_[^"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: match?.[1] ?? "f_unknown", summary: "done" })] };
      },
    ];

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm: new MockLLMClient({ responseFn: makeScript(steps) }),
      directory: [],
      traits: [trait],
      stone: makeStone("demo"),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 50, deadlockGracePeriodMs: 0 },
    };

    const result = await runWithThreadTree("demo", "hi", "user", config);
    expect(result.status).toBe("done");
    /* needsCtx=false：argsObj 直接做第一个参数 */
    expect(capturedFirst).toEqual({ payload: "data" });
  });
});
