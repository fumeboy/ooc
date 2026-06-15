import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject } from "@ooc/core/persistable";
import { createLlmClient } from "@ooc/core/thinkable/llm/client";
import type { LlmClient } from "@ooc/core/thinkable/llm/types";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import { initContextWindows } from "@ooc/core/thinkable/context/init.js";

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
 * 构造一对 (inbox + inbox_message_arrived 事件)，作为 thread 的初始 user 输入。
 *
 * 用于自己手搭 ThreadContext 的测试（如带自定义 stoneRef / 自定义 contextWindows 等）。
 * makeRootThread 内部也用它。
 *
 * 为什么不用 inject：OOC processEventToItems 仅渲染 error-inject，普通 inject 视作
 * "过期上下文"被丢弃；用 inject 传 prompt → LLM 看不到任何用户意图，会陷入
 * "I don't have any prior context to continue from"的无限自问自答。
 */
export function bootstrapInboxFromPrompt(prompt: string): {
  inbox: NonNullable<ThreadContext["inbox"]>;
  events: ThreadContext["events"];
} {
  const msgId = `msg_init_${Math.random().toString(36).slice(2, 10)}`;
  return {
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
  };
}

/** 在临时 flow object 下创建一个携带初始 prompt 的 root thread。 */
export async function makeRootThread(tempRoot: string, prompt: string): Promise<ThreadContext> {
  const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
  const { inbox, events } = bootstrapInboxFromPrompt(prompt);
  const thread: ThreadContext = {
    id: "root",
    status: "running",
    inbox,
    events,
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

/**
 * 统计本 thread 内"实际执行成功的 form"次数：
 * - 显式 submit 成功（tool_runtime.function_call_output, toolName="submit", ok=true）
 * - 经 open 一步直建并 auto-submit 成功（toolName="open", output.executed=true）
 *
 * 旧 fixture 用 countEventsWithPrefix(thread, "[form executed]") 但那条 prefix 出现在
 * function_call_output 的 message 字段（tool_runtime 事件），从未作为 inject 出现——
 * 所以旧断言永远是 0；这是 responses-first item 模型上线后没跟上的测试债。
 */
export function countFormExecutions(thread: ThreadContext): number {
  let n = 0;
  for (const event of thread.events) {
    if (event.category !== "tool_runtime") continue;
    if (event.kind !== "function_call_output") continue;
    if (!event.ok) continue;
    if (event.toolName !== "exec") continue;
    try {
      const out = JSON.parse(event.output) as { executed?: boolean };
      // 普通 exec 调用算一次 form 执行（form 自身的 refine/submit 也走 exec）；
      // executed=true 表示 args 齐全直接执行
      void out.executed;
      n += 1;
    } catch {
      n += 1;
    }
  }
  return n;
}

/**
 * 统计某个 tool 的成功调用次数（如 "close" / "wait" / "refine"）；不限定 tool 时
 * 统计所有成功的 function_call_output。
 */
export function countSuccessfulToolCalls(thread: ThreadContext, toolName?: string): number {
  return thread.events.filter((event) => {
    if (event.category !== "tool_runtime") return false;
    if (event.kind !== "function_call_output") return false;
    if (!event.ok) return false;
    if (toolName && event.toolName !== toolName) return false;
    return true;
  }).length;
}
