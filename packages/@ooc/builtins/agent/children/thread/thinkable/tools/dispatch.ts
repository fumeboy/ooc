/**
 * thread thinkable / tools —— 4 tool 原语 dispatcher（issue E）。
 *
 * LLM 调 `exec` / `close` / `wait` / `open` 时，本模块把调用路由到 ThreadRuntime。LLM 协议层的 tool
 * 元信息（schema）见 `./schema.ts`；本模块只做 dispatch。
 */
import type { LlmToolCall } from "@ooc/core/thinkable/llm/types.js";
import type { ThreadRuntime } from "../../runtime/thread-runtime.js";
import type { ThreadContext } from "../../types.js";

export interface ToolCallResult {
  /** 是否需要把本轮 tool 结果输出回喂给下一轮 LLM。 */
  outputText: string;
  /** thread 是否进入 waiting（wait 原语后 thread.status=waiting）。 */
  shouldWait: boolean;
}

/** 派发一条 tool call 到 ThreadRuntime;返回回喂给 LLM 的文本结果 + 是否进入 wait。 */
export async function dispatchToolCall(
  call: LlmToolCall,
  runtime: ThreadRuntime,
  _thread: ThreadContext,
): Promise<ToolCallResult> {
  try {
    switch (call.name) {
      case "exec": {
        const windowId = String(call.arguments?.window_id ?? "");
        const method = String(call.arguments?.method ?? "");
        const args = (call.arguments?.args as Record<string, unknown> | undefined) ?? {};
        const result = await runtime.exec(windowId, method, args);
        return { outputText: result.message ?? "(ok)", shouldWait: false };
      }
      case "close": {
        const windowId = String(call.arguments?.window_id ?? "");
        await runtime.close(windowId);
        return { outputText: `(closed: ${windowId})`, shouldWait: false };
      }
      case "wait": {
        const windowId = String(call.arguments?.window_id ?? "");
        runtime.wait(windowId);
        return { outputText: `(waiting on: ${windowId})`, shouldWait: true };
      }
      case "open": {
        const objectId = String(call.arguments?.objectId ?? "");
        const methodName = String(call.arguments?.methodName ?? "");
        const want = String(call.arguments?.want ?? "");
        const result = await runtime.open(objectId, methodName, want);
        return { outputText: result.message ?? "(opened)", shouldWait: false };
      }
      default: {
        return { outputText: `(unknown tool: ${call.name})`, shouldWait: false };
      }
    }
  } catch (err) {
    return { outputText: `(error: ${(err as Error).message})`, shouldWait: false };
  }
}
