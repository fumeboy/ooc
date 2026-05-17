import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject } from "../../src/persistable";
import { createLlmClient } from "../../src/thinkable/llm/client";
import type { LlmClient } from "../../src/thinkable/llm/types";
import type { ThreadContext } from "../../src/thinkable/context";
import { initContextWindows } from "../../src/executable/windows";

/** 当所有 OOC_* env 都设置时返回 true，否则集成测试自动 skip。 */
export const hasLlmEnv = Boolean(
  process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL
);

/** 懒构造，避免在 skip 路径上读到坏 env 抛错。 */
let cachedClient: LlmClient | undefined;
export function llm(): LlmClient {
  if (!cachedClient) cachedClient = createLlmClient();
  return cachedClient;
}

/** 为单个集成测试准备 mkdtemp + cleanup。 */
export async function setupTempFlow(): Promise<{ tempRoot: string; cleanup: () => Promise<void> }> {
  const tempRoot = await mkdtemp(join(tmpdir(), "ooc-it-"));
  const cleanup = async () => {
    await rm(tempRoot, { recursive: true, force: true });
  };
  return { tempRoot, cleanup };
}

/**
 * 在临时 flow object 下创建一个携带初始 prompt 的 root thread。
 *
 * 实现走 inbox/inbox_message_arrived 路径——OOC 的 processEventToItems 仅渲染 error-inject，
 * 普通 inject 视作"过期上下文"被丢弃；若把 prompt 塞进 inject，LLM 看不到任何用户意图，
 * 会陷入"I don't have any prior context to continue from"的无限自问自答。
 */
export async function makeRootThread(tempRoot: string, prompt: string): Promise<ThreadContext> {
  const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
  const msgId = `msg_init_${Math.random().toString(36).slice(2, 10)}`;
  const thread: ThreadContext = {
    id: "root",
    status: "running",
    inbox: [
      {
        id: msgId,
        fromThreadId: "user",
        toThreadId: "root",
        content: prompt,
        createdAt: Date.now(),
        source: "user",
      },
    ],
    events: [{ category: "context_change", kind: "inbox_message_arrived", msgId }],
    contextWindows: [],
    persistence: { ...flow, threadId: "root" },
  };
  initContextWindows(thread, { initialTaskTitle: prompt.slice(0, 60) });
  return thread;
}

/** 统计 thread.events 中 inject 文案以指定前缀开头的数量。 */
export function countEventsWithPrefix(thread: ThreadContext, prefix: string): number {
  return thread.events.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && e.text.startsWith(prefix)
  ).length;
}
