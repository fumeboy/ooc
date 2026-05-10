import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject } from "../../src/persistable";
import { createLlmClient } from "../../src/thinkable/llm/client";
import type { LlmClient } from "../../src/thinkable/llm/types";
import type { ThreadContext } from "../../src/thinkable/context";

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

/** 在临时 flow object 下创建一个携带初始 prompt 的 root thread。 */
export async function makeRootThread(tempRoot: string, prompt: string): Promise<ThreadContext> {
  const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
  return {
    id: "root",
    status: "running",
    events: [{ category: "context_change", kind: "inject", text: prompt }],
    activeForms: [],
    persistence: { ...flow, threadId: "root" },
  };
}

/** 统计 thread.events 中 inject 文案以指定前缀开头的数量。 */
export function countEventsWithPrefix(thread: ThreadContext, prefix: string): number {
  return thread.events.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && e.text.startsWith(prefix)
  ).length;
}
