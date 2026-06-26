/**
 * thinkloop e2e smoke test —— 用 mock LlmClient 跑完整 think tick + scheduler loop。
 *
 * 验证：
 *   1. 单 tick：thread → LLM → tool_use → dispatch → events 增长
 *   2. exec/close/wait 三 tool 在 dispatch 后产生预期效果（exec 改 data；close 移窗；wait 改 status）
 *   3. scheduler 选下个 thread + 跑到所有 thread 终态
 *   4. LlmObservation 记最近一次调用
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { think, runScheduler } from "@ooc/builtins/agent/children/thread/thinkable";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type {
  LlmClient,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmToolCall,
} from "@ooc/core/thinkable/llm/types";
import {
  setLatestLlmInput,
  setLatestLlmOutput,
  getLatestLlmObservation,
} from "@ooc/core/observable/index";

/** 一个简单 mock LLM —— 接受响应序列，每次 generate 返回下一条。 */
function mockLlm(responses: Array<{ text?: string; toolCalls?: LlmToolCall[] }>): LlmClient {
  let i = 0;
  return {
    async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
      const r = responses[i] ?? { text: "(no more responses)" };
      i++;
      setLatestLlmInput("test-thread", params.input, params.tools ?? []);
      const result: LlmGenerateResult = {
        provider: "claude",
        model: "mock",
        outputItems: [],
        text: r.text ?? "",
        toolCalls: r.toolCalls ?? [],
      };
      setLatestLlmOutput("test-thread", result);
      return result;
    },
  };
}

const SID = "thinkloop-e2e";

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SID);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SID, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hi" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("thinkloop e2e", () => {
  beforeEach(() => releaseSessionRegistry(SID));
  afterEach(() => releaseSessionRegistry(SID));

  it("single tick: text-only LLM → thread done", async () => {
    const thread = await makeThread();
    const llm = mockLlm([{ text: "I'm done" }]);
    const reg = getSessionRegistry(SID);
    await think(thread, llm, reg);
    expect(thread.status).toBe("done");
    expect(thread.events.length).toBeGreaterThan(0);
    expect(thread.events.some((e) => "kind" in e && e.kind === "text")).toBe(true);
  });

  it("tool call: LLM calls exec → method runs", async () => {
    const thread = await makeThread();
    const reg = getSessionRegistry(SID);
    // first instantiate a todo into context
    const { ThreadRuntime } = await import("@ooc/builtins/agent/children/thread");
    const runtime = ThreadRuntime.fromThread(thread);
    const todoRef = await runtime.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "test task" },
    });
    // LLM responds with exec on the todo
    const llm = mockLlm([
      {
        text: "marking done",
        toolCalls: [
          {
            id: "call_1",
            name: "exec",
            arguments: { window_id: todoRef.id, method: "done", args: {} },
          },
        ],
      },
    ]);
    await think(thread, llm, reg);
    expect((reg.getObject(todoRef.id)?.data as { status: string }).status).toBe("done");
    expect(
      thread.events.some(
        (e) => "kind" in e && e.kind === "function_call_output",
      ),
    ).toBe(true);
  });

  it("wait → thread enters waiting status", async () => {
    const thread = await makeThread();
    const reg = getSessionRegistry(SID);
    const llm = mockLlm([
      {
        text: "waiting",
        toolCalls: [
          {
            id: "call_w",
            name: "wait",
            arguments: { window_id: "_builtin/filesystem" },
          },
        ],
      },
    ]);
    await think(thread, llm, reg);
    expect(thread.status).toBe("waiting");
  });

  it("scheduler picks next thread + runs until exhaustion", async () => {
    const t1 = await makeThread();
    const llm = mockLlm([{ text: "done1" }]);
    // issue H：adapter fail-loud 要求 worldDir + onDataEdit；测试提供无副作用 stub。
    await runScheduler(SID, llm, {
      maxTicks: 5,
      worldDir: "/tmp/_test_scheduler_seam",
      onDataEdit: async () => {},
    });
    expect(t1.status).toBe("done");
  });

  it("LlmObservation captures last call", async () => {
    const thread = await makeThread();
    const reg = getSessionRegistry(SID);
    const llm = mockLlm([{ text: "trace me" }]);
    await think(thread, llm, reg);
    const obs = getLatestLlmObservation();
    expect(obs?.output?.result.text).toBe("trace me");
    expect(obs?.input?.tools.length).toBeGreaterThan(0);
  });
});
