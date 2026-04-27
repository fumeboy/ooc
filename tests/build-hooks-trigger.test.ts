/**
 * build_hooks 触发链路集成测试 —— engine.program 路径
 *
 * 覆盖目标：
 * - 在 engine 的 program 分支中写入文件后，build hooks 能被正确触发
 * - 失败的 hook 结果会以 action:inject 形式写入线程（供下轮 context 读取）
 * - 通过沙箱基础 API 的 `writeFile(path, content)` 与 trait 的 callMethod
 *   (`computable/file_ops:writeFile`) 都应触发
 *
 * 这是对 Phase 2（P1-b）修复的回归：修复前 program 写完坏 json 没触发 hook。
 *
 * @ref docs/工程管理/迭代/all/20260422_bugfix_bruce_v3_p1.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/client.js";
import type { StoneData, TraitDefinition } from "../src/types/index.js";
import {
  __clearHooks,
  registerBuildHook,
  getBuildFeedback,
  jsonSyntaxHook,
} from "../src/world/hooks.js";
import { eventBus } from "../src/observable/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_build_hooks_trigger_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeStone(name: string, traits: string[] = []): StoneData {
  return {
    name,
    thinkable: { whoAmI: `测试对象 ${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
    data: {},
    relations: [],
    traits,
  };
}

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
  return (_messages: unknown[]) => {
    const step = steps[i++] ?? steps[steps.length - 1] ?? "";
    if (typeof step === "function") return step(_messages);
    if (typeof step === "string") return { content: "", thinkingContent: step };
    return { content: "", toolCalls: [step] };
  };
}

/** open(program) → submit(program 代码) → open(return) → submit(return) */
function scriptProgramThenReturn(code: string, summary = "完成"): MockStep[] {
  const programFormIdHolder: { id?: string } = {};
  const returnFormIdHolder: { id?: string } = {};
  return [
    /* 1. open program */
    () => ({
      content: "",
      toolCalls: [toolCall("open", { type: "command", command: "program", description: "写文件测试" })],
    }),
    /* 2. submit program（从 active-forms 里找 program 的 form_id） */
    (messages: unknown[]) => {
      const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
      const re = /<form id="(f_[^"]+)" command="program"/g;
      const match = re.exec(userMsg);
      programFormIdHolder.id = match?.[1] ?? "f_unknown";
      return {
        content: "",
        toolCalls: [toolCall("submit", { form_id: programFormIdHolder.id, code, lang: "javascript" })],
      };
    },
    /* 3. open return */
    () => ({
      content: "",
      toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })],
    }),
    /* 4. submit return */
    (messages: unknown[]) => {
      const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
      const re = /<form id="(f_[^"]+)" command="return"/g;
      const match = re.exec(userMsg);
      returnFormIdHolder.id = match?.[1] ?? "f_unknown";
      return {
        content: "",
        toolCalls: [toolCall("submit", { form_id: returnFormIdHolder.id, summary })],
      };
    },
  ];
}

function makeConfig(overrides: {
  steps: MockStep[];
  traits?: TraitDefinition[];
  stone?: StoneData;
}): EngineConfig {
  const llm = new MockLLMClient({ responseFn: makeScript(overrides.steps) });
  return {
    rootDir: TEST_DIR,
    flowsDir: FLOWS_DIR,
    llm,
    directory: [],
    traits: overrides.traits ?? [],
    stone: overrides.stone ?? makeStone("test_obj"),
    schedulerConfig: {
      maxIterationsPerThread: 20,
      maxTotalIterations: 50,
      deadlockGracePeriodMs: 0,
    },
  };
}

beforeEach(() => {
  mkdirSync(FLOWS_DIR, { recursive: true });
  __clearHooks();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  __clearHooks();
  eventBus.removeAllListeners("sse");
});

describe("build_hooks 触发链路（program 分支）", () => {
  test("沙箱 writeFile 写入坏 JSON → jsonSyntaxHook 触发 → feedback 记录失败", async () => {
    registerBuildHook(jsonSyntaxHook);

    /* 在 program 里用沙箱基础 API writeFile 写一个坏 json */
    const code = `
      writeFile('bad.json', '{ not valid json');
      print('wrote bad.json');
    `;
    const config = makeConfig({ steps: scriptProgramThenReturn(code, "完成") });
    const result = await runWithThreadTree("test_obj", "写个坏 json 看看", "user", config);

    expect(result.status).toBe("done");

    /* program 结束后，hooks 已触发：jsonSyntaxHook 认定 bad.json 非法 → feedback 里有条目 */
    /* 由于 hook feedback 按 threadId 聚合，engine 的 threadId 未暴露给测试。
     * 退而求其次：任一 feedback 列表里有对应条目 —— jsonSyntaxHook 确实被调用。
     *
     * 读所有 feedback（全局 + 任意 threadId 视角），验证 bad.json 出现失败记录。
     */
    /* 不同 threadId，使用全局视角：getBuildFeedback() 不传参 取全局；但我们的 hook 按 threadId 存了。
     * 改为：用 result.threadId（=root threadId）反查 */
    const rootThreadId = result.threadId;
    expect(rootThreadId).toBeTruthy();
    const fb = getBuildFeedback(rootThreadId);
    const badJsonFailure = fb.find((f) => f.path === "bad.json" && !f.success);
    expect(badJsonFailure).toBeDefined();
    expect(badJsonFailure!.hookName).toBe("json-syntax");
    expect(badJsonFailure!.output).toContain("JSON 解析失败");
  });

  test("沙箱 writeFile 写入合法 JSON → hook 触发但无失败条目", async () => {
    registerBuildHook(jsonSyntaxHook);

    const code = `
      writeFile('good.json', JSON.stringify({ ok: true }, null, 2));
      print('wrote good.json');
    `;
    const config = makeConfig({ steps: scriptProgramThenReturn(code) });
    const result = await runWithThreadTree("test_obj", "写个好 json", "user", config);

    expect(result.status).toBe("done");
    const fb = getBuildFeedback(result.threadId);
    const goodJsonFailure = fb.find((f) => f.path === "good.json");
    /* getBuildFeedback 过滤了 success=true，所以 good.json 不应出现在失败列表 */
    expect(goodJsonFailure).toBeUndefined();
  });

  test("program 内不写文件 → 不触发任何 hook", async () => {
    let hookCalled = 0;
    registerBuildHook({
      name: "trace",
      match: () => true,
      run: async () => {
        hookCalled++;
        return { success: true, output: "" };
      },
    });

    const code = `print('just thinking');`;
    const config = makeConfig({ steps: scriptProgramThenReturn(code) });
    const result = await runWithThreadTree("test_obj", "纯思考", "user", config);

    expect(result.status).toBe("done");
    expect(hookCalled).toBe(0);
  });

  test("callMethod computable/file_ops.writeFile 坏 json → hook 触发", async () => {
    registerBuildHook(jsonSyntaxHook);

    /* 构造一个真 file_ops trait 放进 config.traits，让 methodRegistry 能解析 callMethod */
    const fileOps = await import("../traits/computable/file_ops/index.js");
    const fileOpsTrait: TraitDefinition = {
      namespace: "kernel",
      name: "computable/file_ops",
      kind: "trait",
      type: "how_to_think",
      description: "文件操作",
      readme: "文件操作",
      deps: [],
      llmMethods: fileOps.llm_methods,
    };

    const code = `
      await callMethod('computable/file_ops', 'writeFile', { path: 'bad2.json', content: '{still bad' });
      print('done');
    `;
    const config = makeConfig({
      steps: scriptProgramThenReturn(code, "完成"),
      traits: [fileOpsTrait],
    });
    const result = await runWithThreadTree("test_obj", "trait 写坏 json", "user", config);

    expect(result.status).toBe("done");
    const fb = getBuildFeedback(result.threadId);
    const failure = fb.find((f) => f.path === "bad2.json" && !f.success);
    expect(failure).toBeDefined();
    expect(failure!.hookName).toBe("json-syntax");
  });
});
