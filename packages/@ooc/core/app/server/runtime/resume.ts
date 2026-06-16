import { readFile } from "node:fs/promises";
import { dispatchToolCall } from "@ooc/core/executable/tools";
import { llmOutputFile, type ThreadPersistenceRef } from "@ooc/core/persistable";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import { applyResumeTransition, canResumeThread } from "./thread-transition";

type SavedToolCall = {
  name: "exec" | "close" | "wait" | "compress";
  arguments: Record<string, unknown>;
};

type SavedLlmOutput = {
  result: {
    text: string;
    toolCalls: SavedToolCall[];
  };
};

export async function resumePausedThread(ref: ThreadPersistenceRef) {
  const thread = await readThread(ref, ref.threadId);
  if (!thread) {
    throw new Error(`thread not found: ${ref.threadId}`);
  }
  if (!canResumeThread(thread)) {
    throw new Error(`thread ${ref.threadId} is not paused`);
  }

  const raw = await readFile(llmOutputFile(ref), "utf8");
  const payload = JSON.parse(raw) as SavedLlmOutput;

  const resumedThread = applyResumeTransition(thread);
  if (payload.result.text) {
    resumedThread.events.push({
      category: "llm_interaction",
      kind: "text",
      text: payload.result.text,
    });
  }

  for (const [index, toolCall] of payload.result.toolCalls.entries()) {
    resumedThread.events.push({
      category: "llm_interaction",
      kind: "tool_use",
      toolName: toolCall.name,
      arguments: toolCall.arguments,
    });
    await dispatchToolCall(resumedThread, {
      id: `resume_${ref.threadId}_${index}`,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  await writeThread(resumedThread);
  return resumedThread;
}
