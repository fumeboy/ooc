import type { LlmMessage } from "./llm/types";

// ProcessEvent 先只保留 think 单轮会直接写入的四种事件。
export type ProcessEvent =
  | {
      category: "llm_interaction";
      kind: "text";
      text: string;
    }
  | {
      category: "llm_interaction";
      kind: "tool_use";
      toolName: "open" | "refine" | "submit" | "close" | "wait" | "compress";
      arguments: Record<string, unknown>;
    }
  | {
      category: "llm_interaction";
      kind: "thinking";
      text: string;
    }
  | {
      category: "context_change";
      kind: "inject";
      text: string;
    };

// ThreadContext 当前不实现完整 thread runtime，只服务单轮执行。
export type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
};

// buildContext 先给最小占位实现，后续由正式 context 系统替换。
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  void thread;
  return [];
}
