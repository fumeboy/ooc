/**
 * 会话窗（talk / do）共享渲染：transcript-or-handle。
 *
 * talk_window 与 do_window 本质同为"对端 thread 的会话窗"（见 docs/2026-06-14-…axiom 推论一）。
 * attention 分层（2026-06-14）后两者的 transcript 渲染**逐行相同**——creator 窗渲句柄、非 creator
 * 窗渲 viewport + transcript。本 helper 抽出这段共享逻辑（两边 readable hook 各自算 messages + head
 * 节点后调用它），消除重复。filter（do 按 targetThreadId / talk 按 windowId）寻址不同，仍各自保留。
 *
 * 注：do_window 类终将并入 talk_window（S4b）；届时本 helper 仍是 talk 的 transcript 渲染器，非废弃。
 */
import type { ThreadMessage } from "@ooc/core/_shared/types/thread.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  applyTranscriptViewport,
  DEFAULT_TRANSCRIPT_VIEWPORT,
  type TranscriptViewport,
} from "./transcript-viewport.js";

/** 会话窗渲染所需的最小窗形态（talk / do 都满足）。 */
interface ConversationWindowLike {
  isCreatorWindow?: boolean;
  state?: { transcriptViewport?: TranscriptViewport };
  transcriptViewport?: TranscriptViewport;
}

/**
 * 渲染会话窗的 transcript 区（或 creator 句柄）。返回应 push 进 children 的节点。
 *
 * - **creator 窗（主要 attention）**：内容走 LLM message 流；此处只渲句柄
 *   （`is_creator_window` + `transcript_in_messages` 指引），不内联 transcript。
 * - **非 creator 窗（次要 attention）**：渲 `transcript_viewport` 元信息 + 切片后的 `transcript`。
 */
export function renderTranscriptOrHandle(
  window: ConversationWindowLike,
  messages: ThreadMessage[],
): XmlNode[] {
  if (window.isCreatorWindow) {
    return [
      xmlElement("is_creator_window", {}, [xmlText("true")]),
      xmlElement(
        "transcript_in_messages",
        { total: String(messages.length) },
        [xmlText("与 creator 的对话在 LLM message 流（主要 attention），本窗不重复渲 transcript。")],
      ),
    ];
  }

  const viewport: TranscriptViewport =
    window.state?.transcriptViewport ?? window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(messages, viewport);

  const viewportAttrs: Record<string, string> = { total: String(messages.length) };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (typeof viewport.rangeStart === "number" && typeof viewport.rangeEnd === "number") {
    viewportAttrs.range_start = String(viewport.rangeStart);
    viewportAttrs.range_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) viewportAttrs.earlier_omitted = String(earlierCount);

  const nodes: XmlNode[] = [xmlElement("transcript_viewport", viewportAttrs)];
  if (visible.length > 0) {
    nodes.push(
      xmlElement(
        "transcript",
        {},
        visible.map((m) =>
          xmlElement("message", { id: m.id, source: m.source }, [
            xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
            xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
            xmlElement("content", {}, [xmlText(m.content)]),
          ]),
        ),
      ),
    );
  }
  return nodes;
}
