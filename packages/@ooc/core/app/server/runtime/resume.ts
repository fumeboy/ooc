import { readFile } from "node:fs/promises";
import { dispatchToolCall } from "@ooc/core/executable/tools";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { type ThreadPersistenceRef } from "@ooc/core/persistable";
import { llmOutputFile } from "@ooc/core/observable/debug-file";
import { loadObject, saveObject } from "@ooc/core/persistable/runtime-object-io.js";
import { applyResumeTransition, canResumeThread } from "./thread-transition";

type SavedToolCall = {
  name: "exec" | "close" | "wait";
  arguments: Record<string, unknown>;
};

type SavedLlmOutput = {
  result: {
    text: string;
    toolCalls: SavedToolCall[];
  };
};

export async function resumePausedThread(ref: ThreadPersistenceRef) {
  const thread = await loadObject(THREAD_CLASS_ID, ref, ref.threadId);
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

  await saveObject(resumedThread);
  return resumedThread;
}
