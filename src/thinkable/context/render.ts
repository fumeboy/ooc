import type { ActiveForm } from "../../executable/forms/form";
import type { ThreadMessage } from "./index";
import { inferNextAction, inferProtocolHint } from "./protocol";

/** 转义 XML 特殊字符，保证 context 内容不会破坏标签结构。 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 只在字段存在时渲染简单 XML 标签，避免空字段污染 context。 */
export function renderOptionalTag(tag: string, value: string | undefined): string {
  if (!value) return "";
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

/** 将 inbox/outbox 消息数组渲染为结构化 XML 子树。 */
export function renderMessages(tag: "inbox" | "outbox", messages: ThreadMessage[] | undefined): string {
  if (!messages || messages.length === 0) return "";

  const items = messages
    .map((message) => {
      return [
        `<message id="${escapeXml(message.id)}">`,
        `<from_thread_id>${escapeXml(message.fromThreadId)}</from_thread_id>`,
        `<to_thread_id>${escapeXml(message.toThreadId)}</to_thread_id>`,
        `<content>${escapeXml(message.content)}</content>`,
        `<source>${escapeXml(message.source)}</source>`,
        `<created_at>${String(message.createdAt)}</created_at>`,
        "</message>"
      ].join("");
    })
    .join("");

  return `<${tag}>${items}</${tag}>`;
}

/** 渲染 program command 自动激活的方法知识文本。 */
function renderMethodKnowledge(text: string | undefined): string {
  if (!text) return "";
  return `<method_knowledge>${escapeXml(text)}</method_knowledge>`;
}

/** 渲染当前未完成的 form，让 LLM 能继续 refine/submit/close。 */
export function renderActiveForms(activeForms: ActiveForm[] | undefined): string {
  if (!activeForms || activeForms.length === 0) return "";

  const items = activeForms
    .map((form) => {
      const status = form.status ?? "open";
      const commandPaths = form.commandPaths.length
        ? `<command_paths>${form.commandPaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</command_paths>`
        : "";
      const loadedKnowledge = form.loadedKnowledgePaths.length
        ? `<loaded_knowledge>${form.loadedKnowledgePaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</loaded_knowledge>`
        : "";
      const resultXml = status === "executed" && form.result
        ? `<result>${escapeXml(form.result)}</result>`
        : "";
      const methodKnowledgeXml = renderMethodKnowledge(form.methodKnowledge);
      const nextActionXml = `<next_action>${escapeXml(inferNextAction(form))}</next_action>`;
      const protocolHintXml = `<protocol_hint>${escapeXml(inferProtocolHint(form))}</protocol_hint>`;

      return [
        `<form id="${escapeXml(form.formId)}" status="${escapeXml(status)}">`,
        `<command>${escapeXml(form.command)}</command>`,
        `<description>${escapeXml(form.description)}</description>`,
        `<accumulated_args>${escapeXml(JSON.stringify(form.accumulatedArgs))}</accumulated_args>`,
        commandPaths,
        loadedKnowledge,
        nextActionXml,
        protocolHintXml,
        methodKnowledgeXml,
        resultXml,
        "</form>"
      ].join("");
    })
    .join("");

  return `<active_forms>${items}</active_forms>`;
}
