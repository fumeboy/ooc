/**
 * thread thinkable / tools —— 3 tool 原语 dispatcher。
 *
 * LLM 调 `exec` / `close` / `wait` 时，本模块把调用路由到 WindowManager。LLM 协议层的 tool
 * 元信息（schema）见 `./schema.ts`；本模块只做 dispatch。
 */
import type { LlmToolCall } from "@ooc/core/thinkable/llm/types.js";
import type { WindowManager } from "../../runtime/window-manager.js";
import type { ThreadContext } from "../../types.js";

export interface ToolCallResult {
  /** 是否需要把本轮 tool 结果输出回喂给下一轮 LLM。 */
  outputText: string;
  /** thread 是否进入 waiting（wait 原语后 thread.status=waiting）。 */
  shouldWait: boolean;
}

/** 派发一条 tool call 到 WindowManager；返回回喂给 LLM 的文本结果 + 是否进入 wait。 */
export async function dispatchToolCall(
  call: LlmToolCall,
  mgr: WindowManager,
  _thread: ThreadContext,
): Promise<ToolCallResult> {
  try {
    switch (call.name) {
      case "exec": {
        const windowId = String(call.arguments?.window_id ?? "");
        const method = String(call.arguments?.method ?? "");
        const args = (call.arguments?.args as Record<string, unknown> | undefined) ?? {};
        const result = await mgr.exec(windowId, method, args);
        return { outputText: result.message ?? "(ok)", shouldWait: false };
      }
      case "close": {
        const windowId = String(call.arguments?.window_id ?? "");
        await mgr.close(windowId);
        return { outputText: `(closed: ${windowId})`, shouldWait: false };
      }
      case "wait": {
        const windowId = String(call.arguments?.window_id ?? "");
        mgr.wait(windowId);
        return { outputText: `(waiting on: ${windowId})`, shouldWait: true };
      }
      default: {
        return { outputText: `(unknown tool: ${call.name})`, shouldWait: false };
      }
    }
  } catch (err) {
    return { outputText: `(error: ${(err as Error).message})`, shouldWait: false };
  }
}
