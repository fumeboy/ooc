/**
 * 会话窗共享渲染：transcript-or-handle。
 *
 * talk_window 统一两形态（peer 会话 / fork 子线程窗），transcript 渲染**逐行相同**——
 * creator 窗渲句柄、非 creator 窗渲 viewport + transcript。本 helper 抽出这段共享逻辑
 * （readable hook 算 messages + head 节点后调用它）。filter（fork 按 targetThreadId /
 * peer 按 windowId）寻址不同，由 filterMessagesForTalkWindow 各自处理。
 */
import type { ThreadMessage } from "@ooc/core/_shared/types/thread.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  applyTranscriptViewport,
  DEFAULT_TRANSCRIPT_VIEWPORT,
  type TranscriptViewport,
} from "@ooc/core/readable/transcript-viewport.js";

/** 会话窗渲染所需的最小窗形态（talk / do 都满足）。 */
interface ConversationWindowLike {
  /** 渲染计算入参：本窗是否是 creator 窗（caller 用 isCreatorWindowId(id) 算好传入；非持久化字段）。 */
  isCreator?: boolean;
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
  if (window.isCreator) {
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
    window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
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
