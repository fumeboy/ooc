/**
 * Protocol knowledge windows — extracted from the old synthesizer.collectExecutableKnowledgeEntries.
 *
 * Produces KnowledgeWindow entries with source="protocol" covering:
 * - Global BASIC_KNOWLEDGE + ROOT_KNOWLEDGE
 * - REFLECTABLE knowledge (gated on sessionId === "super")
 * - Type-level basicKnowledge (per window type present in context)
 * - Creator-reply protocol knowledge (per creator do/talk window)
 * - End-form reflection reminder (when business thread opens "end" form)
 */
import type { ContextWindow, KnowledgeWindow } from "../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import { BASIC_KNOWLEDGE_PATH, KNOWLEDGE } from "../knowledge/basic-knowledge.js";
import { ROOT_BASIC_PATH, ROOT_KNOWLEDGE } from "@ooc/builtins/root";
import {
  END_REFLECTION_REMINDER_KNOWLEDGE,
  END_REFLECTION_REMINDER_PATH,
  REFLECTABLE_BASIC_PATH,
  REFLECTABLE_KNOWLEDGE,
  REFLECTABLE_METAPROG_KNOWLEDGE,
  REFLECTABLE_METAPROG_PATH,
} from "../reflectable/reflectable-knowledge.js";
import { SUPER_SESSION_ID } from "../../executable/windows/_shared/super-constants.js";
import type { ThreadContext } from "./index.js";
import type { MethodExecWindow } from "../../executable/windows/_shared/types.js";

let syntheticIdCounter = 0;
function nextSyntheticId(): string {
  syntheticIdCounter += 1;
  return `kn_${Date.now().toString(36)}_${syntheticIdCounter.toString(36)}`;
}

function makeKnowledgeWindow(
  path: string,
  body: string,
  source: NonNullable<KnowledgeWindow["source"]>,
): KnowledgeWindow {
  return {
    id: nextSyntheticId(),
    type: "knowledge",
    parentWindowId: ROOT_WINDOW_ID,
    title: path,
    status: "open",
    createdAt: Date.now(),
    path,
    source,
    body,
  };
}

/**
 * 子→父 reply protocol knowledge builder.
 * Tells sub-thread LLM the only valid reply channel is creator_window.continue/say.
 */
function buildCreatorReplyKnowledge(window: ContextWindow): string {
  if (window.type === "do") {
    return [
      "# 子→父 reply 协议（你的 creator do_window）",
      "",
      `你当前 thread 的 creator window 是 \`${window.id}\`（type=do_window，isCreatorWindow=true，不可被 close）。`,
      "",
      "**想把结果 / 状态 / 中间进展带回父线程，唯一通道**：",
      "",
      "```",
      `exec(window_id="${window.id}", method="continue", args={ msg: "<结果或状态描述>" })`,
      "```",
      "",
      "这条消息会被自动 deliver 到父 thread 的 inbox，父 LLM 下一轮就能看到。",
      "",
      "**重要边界**：",
      "- `end` command 只用于声明本轮**自己**结束，**不是回报通道**。",
      "- 即便 end 接受 `result` 参数（便捷糖），它内部仍是模拟在 creator window 上调一次 continue；",
      "  多段对话 / 复杂状态汇报，请显式走 `creator_do_window.continue`，不要塞到 end 里。",
      "- 不要 hallucinate \"reply\" / \"report\" / \"finish_with\" 等不存在的 command；只有 continue / say / wait / close。",
    ].join("\n");
  }
  // talk creator window
  return [
    "# 子→父 reply 协议（你的 creator talk_window）",
    "",
    `你当前 thread 的 creator window 是 \`${window.id}\`（type=talk_window，isCreatorWindow=true，不可被 close）。`,
    "",
    "**想给 caller 回信，唯一通道**：",
    "",
    "```",
    `exec(window_id="${window.id}", method="say", args={ msg: "<回复内容>", wait: false|true })`,
    "```",
    "",
    "这条消息会通过 talk-delivery 派送到 caller object 的对端 thread；caller 下一轮就能看到。",
    "",
    "**重要边界**：",
    "- `end` command 只用于声明本轮**自己**结束，**不是回报通道**。",
    "- 即便 end 接受 `result` 参数（便捷糖），它内部仍是模拟在 creator window 上调一次 say；",
    "  多轮往返 / 复杂确认，请显式走 `creator_talk_window.say`，不要塞到 end 里。",
    "- 不要 open 新的 talk_window 给同一个 caller；用现有的 creator talk_window 复用。",
  ].join("\n");
}

/**
 * Produce all protocol-level knowledge windows for a thread.
 *
 * Includes: global basics, super-session reflectable knowledge, type-level basics,
 * creator-reply protocol hints, and end-reflection reminder.
 */
export function buildProtocolKnowledgeWindows(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): KnowledgeWindow[] {
  const windows: KnowledgeWindow[] = [];
  const entries = new Map<string, string>();

  // 1) Global protocol entries
  entries.set(BASIC_KNOWLEDGE_PATH, KNOWLEDGE);
  entries.set(ROOT_BASIC_PATH, ROOT_KNOWLEDGE);

  // 2) Super session reflectable knowledge
  if (thread.persistence?.sessionId === SUPER_SESSION_ID) {
    entries.set(REFLECTABLE_BASIC_PATH, REFLECTABLE_KNOWLEDGE);
    entries.set(REFLECTABLE_METAPROG_PATH, REFLECTABLE_METAPROG_KNOWLEDGE);
  }

  // 3) Type-level basicKnowledge — inject per window type present
  const presentTypes = new Set<string>();
  for (const w of thread.contextWindows ?? []) presentTypes.add(w.type);
  for (const t of presentTypes) {
    let def;
    try {
      def = registry.getObjectDefinition(t as ContextWindow["type"]);
    } catch {
      continue;
    }
    if (!def.basicKnowledge) continue;
    const path = `internal/windows/${t}/basic`;
    if (!entries.has(path)) {
      entries.set(path, def.basicKnowledge);
    }
  }

  // 4) Creator-reply protocol knowledge
  // batch C narrowing(N1/N4): contextWindows 契约层是 base[]；narrow 回 union[] 以读 isCreatorWindow 并传入 buildCreatorReplyKnowledge。
  for (const w of (thread.contextWindows ?? []) as ContextWindow[]) {
    const isCreator = (w.type === "do" || w.type === "talk") && w.isCreatorWindow === true;
    if (!isCreator) continue;
    const path = `internal/windows/${w.type}/creator-reply/${w.id}`;
    if (entries.has(path)) continue;
    entries.set(path, buildCreatorReplyKnowledge(w));
  }

  // 5) End-form reflection reminder (G2)
  for (const w of thread.contextWindows ?? []) {
    if (w.type !== "method_exec") continue;
    const form = w as MethodExecWindow;
    try {
      const isEndForm = form.method === "end";
      const inSuperSession = thread.persistence?.sessionId === SUPER_SESSION_ID;
      if (isEndForm && !inSuperSession && !entries.has(END_REFLECTION_REMINDER_PATH)) {
        entries.set(END_REFLECTION_REMINDER_PATH, END_REFLECTION_REMINDER_KNOWLEDGE);
      }
    } catch (err) {
      console.warn(`[protocol] end-reflection-reminder inject failed: ${(err as Error).message}`);
    }
  }

  // 6) Convert entries map → KnowledgeWindow list
  for (const [path, body] of entries) {
    windows.push(makeKnowledgeWindow(path, body, "protocol"));
  }

  return windows;
}

/**
 * Compute per-window type-level basicKnowledge paths for a given thread.
 * Used by tests and the old knowledgeEntries map output.
 */
export function collectProtocolEntries(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const w of buildProtocolKnowledgeWindows(thread, registry)) {
    if (w.body != null) result[w.path] = w.body;
  }
  return result;
}
