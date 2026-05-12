import { deriveStoneFromThread } from "../../persistable/common";
import {
  computeActivations,
  loadKnowledgeIndex,
  type ActivationResult
} from "../knowledge";
import type { ActiveForm } from "../../executable/forms/form";
import type { ThreadContext, ThreadMessage } from "./index";

type XmlNode =
  | {
      kind: "element";
      tag: string;
      attrs?: Record<string, string>;
      children?: XmlNode[];
    }
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "comment";
      value: string;
    };

const INDENT = "  ";
const MAX_KNOWLEDGE_BYTES = 8192;

/** 转义 XML 特殊字符，保证 context 内容不会破坏标签结构。 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeXmlComment(text: string): string {
  return text.replaceAll("--", "- -");
}

function xmlElement(tag: string, attrs: Record<string, string> = {}, children: XmlNode[] = []): XmlNode {
  return { kind: "element", tag, attrs, children };
}

function xmlText(value: string): XmlNode {
  return { kind: "text", value };
}

function xmlComment(value: string): XmlNode {
  return { kind: "comment", value };
}

function optionalElement(tag: string, value: string | undefined): XmlNode | null {
  if (!value) return null;
  return xmlElement(tag, {}, [xmlText(value)]);
}

function renderPathList(tag: string, paths: string[] | undefined): XmlNode | null {
  if (!paths || paths.length === 0) return null;
  return xmlElement(
    tag,
    {},
    paths.map((path) => xmlElement("path", {}, [xmlText(path)]))
  );
}

function appendNode(nodes: XmlNode[], node: XmlNode | null): void {
  if (node) nodes.push(node);
}

function serializeXml(node: XmlNode, depth = 0): string {
  const indent = INDENT.repeat(depth);

  if (node.kind === "comment") {
    return `${indent}<!-- ${escapeXmlComment(node.value)} -->`;
  }

  if (node.kind === "text") {
    return `${indent}${escapeXml(node.value)}`;
  }

  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  const children = node.children ?? [];

  if (children.length === 0) {
    return `${indent}<${node.tag}${attrs}></${node.tag}>`;
  }

  if (children.length === 1 && children[0]?.kind === "text") {
    return `${indent}<${node.tag}${attrs}>${escapeXml(children[0].value)}</${node.tag}>`;
  }

  const renderedChildren = children
    .map((child) => serializeXml(child, depth + 1))
    .join("\n");

  return `${indent}<${node.tag}${attrs}>\n${renderedChildren}\n${indent}</${node.tag}>`;
}

function truncateKnowledgeBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= MAX_KNOWLEDGE_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_KNOWLEDGE_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function renderMessagesNode(tag: "inbox" | "outbox", messages: ThreadMessage[] | undefined): XmlNode | null {
  if (!messages || messages.length === 0) return null;

  return xmlElement(
    tag,
    {},
    messages.map((message) =>
      xmlElement("message", { id: message.id }, [
        xmlElement("from_thread_id", {}, [xmlText(message.fromThreadId)]),
        xmlElement("to_thread_id", {}, [xmlText(message.toThreadId)]),
        xmlElement("content", {}, [xmlText(message.content)]),
        xmlElement("source", {}, [xmlText(message.source)]),
        xmlElement("created_at", {}, [xmlText(String(message.createdAt))]),
      ])
    )
  );
}

function renderKnowledgeEntriesNode(knowledgeEntries: Record<string, string>): XmlNode | null {
  const entries = Object.entries(knowledgeEntries);
  if (entries.length === 0) return null;

  return xmlElement(
    "knowledge_entries",
    {},
    entries.map(([path, content]) =>
      xmlElement("knowledge", { path }, [
        xmlElement("content", {}, [xmlText(content)]),
      ])
    )
  );
}

function renderActiveFormsNode(activeForms: ActiveForm[] | undefined): XmlNode | null {
  if (!activeForms || activeForms.length === 0) return null;

  return xmlElement(
    "active_forms",
    {},
    activeForms.map((form) => {
      const status = form.status ?? "open";
      const children: XmlNode[] = [
        xmlElement("command", {}, [xmlText(form.command)]),
        xmlElement("description", {}, [xmlText(form.description)]),
        xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(form.accumulatedArgs))]),
      ];

      appendNode(children, renderPathList("command_paths", form.commandPaths));
      appendNode(children, renderPathList("loaded_knowledge", form.loadedKnowledgePaths));
      appendNode(children, renderPathList("command_knowledge_paths", form.commandKnowledgePaths));
      if (status === "executed" && form.result) {
        children.push(xmlElement("result", {}, [xmlText(form.result)]));
      }

      return xmlElement("form", { id: form.formId, status }, children);
    })
  );
}

function renderActiveKnowledgeNode(activations: ActivationResult[]): XmlNode | null {
  if (activations.length === 0) return null;

  return xmlElement(
    "active_knowledge",
    {},
    activations.map((activation) => {
      const children: XmlNode[] = [];
      const desc = activation.doc.frontmatter.description ?? "";
      if (desc) {
        children.push(xmlElement("description", {}, [xmlText(desc)]));
      }
      if (activation.presentation === "full") {
        children.push(xmlElement("content", {}, [xmlText(truncateKnowledgeBody(activation.doc.body))]));
      }
      return xmlElement("knowledge", { path: activation.path, presentation: activation.presentation }, children);
    })
  );
}

async function computeActiveKnowledgeNode(thread: ThreadContext): Promise<XmlNode | null> {
  if (!thread.persistence) return null;
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const index = await loadKnowledgeIndex(stoneRef);
    const activations = computeActivations(thread, index);
    return renderActiveKnowledgeNode(activations);
  } catch {
    return null;
  }
}

export async function renderContextXml(input: {
  thread: ThreadContext;
  activeForms: ActiveForm[] | undefined;
  knowledgeEntries: Record<string, string>;
}): Promise<string> {
  const threadChildren: XmlNode[] = [];
  appendNode(threadChildren, optionalElement("creator_thread_id", input.thread.creatorThreadId));
  appendNode(threadChildren, optionalElement("parent_thread_id", input.thread.parentThreadId));
  appendNode(threadChildren, optionalElement("plan", input.thread.plan));

  const activeFormsNode = renderActiveFormsNode(input.activeForms);
  if (activeFormsNode) {
    threadChildren.push(xmlComment("active forms: unfinished command forms that can still be refined, submitted, or closed"));
    threadChildren.push(activeFormsNode);
  }

  const knowledgeEntriesNode = renderKnowledgeEntriesNode(input.knowledgeEntries);
  if (knowledgeEntriesNode) {
    threadChildren.push(xmlComment("executable knowledge entries: deduplicated protocol knowledge for commands in this turn"));
    threadChildren.push(knowledgeEntriesNode);
  }

  const activeKnowledgeNode = await computeActiveKnowledgeNode(input.thread);
  if (activeKnowledgeNode) {
    threadChildren.push(xmlComment("active knowledge: persistent or activated project knowledge available to this turn"));
    threadChildren.push(activeKnowledgeNode);
  }

  appendNode(threadChildren, renderMessagesNode("inbox", input.thread.inbox));
  appendNode(threadChildren, renderMessagesNode("outbox", input.thread.outbox));

  const root = xmlElement("context", {}, [
    xmlElement("thread", { id: input.thread.id, status: input.thread.status }, threadChildren),
  ]);

  return serializeXml(root);
}
