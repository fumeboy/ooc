/**
 * thread thinkable / thinkloop —— 单个 thread 一轮 think 的驱动。
 *
 * 一轮 think = build LLM input → call LLM → dispatch tool calls → write events.
 *
 * 设计：
 * - 输入：thread (data) + LlmClient + ObjectInsRegistry
 * - 副作用：mutates `thread.events`（appendEvents）; mutates `thread.contextWindows`（exec/close）;
 *   mutates session 对象表 via ThreadRuntime
 * - 出错：LLM timeout / network error → 写 `lastError` + 标 `status="failed"` + 不抛
 */
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import { ThreadRuntime } from "../runtime/thread-runtime.js";
import type { ThreadContext, ProcessEvent } from "../types.js";
import { buildLlmInput } from "./context.js";
import { PRIMITIVE_TOOLS } from "./tools/schema.js";
import { dispatchToolCall } from "./tools/dispatch.js";

export interface ThinkOptions {
  worldDir?: string;
  /** 持久化挂钩（reportDataEdit 调时落盘）。 */
  onDataEdit?: () => Promise<void> | void;
  /**
   * 跨 session 唤醒钩子——构造 ThreadRuntime 时透传，供 say/reply/talk-super append 写盘后
   * 经 `ctx.runtime.scheduleSession(targetSid)` 唤醒对端 worker。
   * 见 issue G + ThreadRuntime.scheduleSession JSDoc。
   */
  wakeSession?: (sessionId: string) => void;
}

/** 单轮 think —— 一次完整的 LLM 互动 + tool dispatch。 */
export async function think(
  thread: ThreadContext,
  llm: LlmClient,
  registry: ObjectInsRegistry,
  opts: ThinkOptions = {},
): Promise<void> {
  const input = await buildLlmInput(thread, registry, { worldDir: opts.worldDir });

  // 记 call_started（recovery 用）
  const callStartedAt = Date.now();
  thread.events.push({
    category: "llm_interaction",
    kind: "call_started",
    loopIndex: thread.events.filter((e) => "kind" in e && e.kind === "call_started").length,
    createdAt: callStartedAt,
  });

  let result;
  try {
    result = await llm.generate({
      input,
      tools: PRIMITIVE_TOOLS,
      timeoutMs: thread.llmTimeoutMs,
    });
  } catch (err) {
    thread.status = "failed";
    thread.statusReason = (err as Error).name === "LlmTimeoutError" ? "llm_timeout" : "think_error";
    thread.lastError = (err as Error).message;
    return;
  }

  // 写 text / thinking 事件
  if (result.text) {
    thread.events.push({
      category: "llm_interaction",
      kind: "text",
      text: result.text,
      createdAt: Date.now(),
    });
  }
  if (result.thinking) {
    thread.events.push({
      category: "llm_interaction",
      kind: "thinking",
      text: result.thinking,
      createdAt: Date.now(),
    });
  }

  // dispatch tool calls
  const runtime = ThreadRuntime.fromThread(thread, {
    worldDir: opts.worldDir,
    onDataEdit: opts.onDataEdit,
    wakeSession: opts.wakeSession,
  });
  let didWait = false;
  for (const call of result.toolCalls ?? []) {
    thread.events.push({
      category: "llm_interaction",
      kind: "function_call",
      callId: call.id,
      toolName: call.name,
      arguments: call.arguments,
      createdAt: Date.now(),
    });
    const out = await dispatchToolCall(call, runtime, thread);
    thread.events.push({
      category: "llm_interaction",
      kind: "function_call_output",
      callId: call.id,
      toolName: call.name,
      output: out.outputText,
      ok: true,
      createdAt: Date.now(),
    } as unknown as ProcessEvent);
    if (out.shouldWait) didWait = true;
  }

  // 没 tool call ⇒ LLM 表态本轮无副作用 → 进 done（最简退出策略：text-only 也算完成）
  if ((result.toolCalls?.length ?? 0) === 0) {
    thread.status = "done";
    return;
  }

  // 进入 wait 或继续 running
  if (didWait && thread.status === "waiting") {
    // already set by runtime.wait
  } else {
    thread.status = "running";
  }
}
