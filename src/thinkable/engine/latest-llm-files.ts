import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../llm/client.js";

function formatLatestLlmInput(messages: Message[]): string {
  return messages.map(m => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n");
}

export function writeLatestLlmInput(threadDir: string, messages: Message[]): void {
  mkdirSync(threadDir, { recursive: true });
  writeFileSync(join(threadDir, "llm.input.txt"), formatLatestLlmInput(messages), "utf-8");
}

export function writeLatestLlmOutput(threadDir: string, llmOutput: string, thinkingContent?: string): void {
  mkdirSync(threadDir, { recursive: true });
  writeFileSync(join(threadDir, "llm.output.txt"), llmOutput, "utf-8");

  const thinkingFile = join(threadDir, "llm.thinking.txt");
  if (thinkingContent) {
    writeFileSync(thinkingFile, thinkingContent, "utf-8");
  } else if (existsSync(thinkingFile)) {
    unlinkSync(thinkingFile);
  }
}
