import { readFile } from "node:fs/promises";
import { dispatchToolCall } from "@src/executable/tools";
import { llmOutputFile, readThread, writeThread, type ThreadPersistenceRef } from "@src/persistable";

type SavedToolCall = {
  name: "open" | "refine" | "submit" | "close" | "wait" | "compress";
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
  if (thread.status !== "paused") {
    throw new Error(`thread ${ref.threadId} is not paused`);
  }

  const raw = await readFile(llmOutputFile(ref), "utf8");
  const payload = JSON.parse(raw) as SavedLlmOutput;

  thread.status = "running";
  if (payload.result.text) {
    thread.events.push({
      category: "llm_interaction",
      kind: "text",
      text: payload.result.text,
    });
  }

  for (const [index, toolCall] of payload.result.toolCalls.entries()) {
    thread.events.push({
      category: "llm_interaction",
      kind: "tool_use",
      toolName: toolCall.name,
      arguments: toolCall.arguments,
    });
    await dispatchToolCall(thread, {
      id: `resume_${ref.threadId}_${index}`,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  await writeThread(thread);
  return thread;
}
