import { readFile } from "node:fs/promises";
import { deriveStoneFromThread } from "../../persistable/common";
import {
  computeActivations,
  loadKnowledgeIndex,
  type ActivationResult
} from "../knowledge";
import type {
  CommandExecWindow,
  ContextWindow,
  DoWindow,
  TodoWindow,
} from "../../executable/windows/types";
import { ROOT_WINDOW_ID } from "../../executable/windows/types";
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
const MAX_FILE_WINDOW_BYTES = 32768;
void MAX_FILE_WINDOW_BYTES; // 占位，待 Step 2 file_window 回归后启用

/** 转义 XML 特殊字符，保证 context 内容不会破坏标签结构。 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shouldUseCdata(text: string): boolean {
  return escapeXml(text) !== text;
}

function wrapCdata(text: string): string {
  return `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function renderXmlTextValue(text: string): string {
  return shouldUseCdata(text) ? wrapCdata(text) : escapeXml(text);
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
    return `${indent}${renderXmlTextValue(node.value)}`;
  }

  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  const children = node.children ?? [];

  if (children.length === 0) {
    return `${indent}<${node.tag}${attrs}></${node.tag}>`;
  }

  if (children.length === 1 && children[0]?.kind === "text") {
    return `${indent}<${node.tag}${attrs}>${renderXmlTextValue(children[0].value)}</${node.tag}>`;
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

void readFile; // Step 2 file_window 回归时启用

/** 渲染 inbox/outbox 的扁平消息列表（仅顶层兜底，未被 window 视图收纳的消息）。 */
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

// ---- Window 渲染（spec § 渲染示例） ----

/** command_exec form 的内容渲染：accumulated_args / command_paths / loaded_knowledge / result。 */
function renderCommandExecWindowChildren(form: CommandExecWindow): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("command", {}, [xmlText(form.command)]),
    xmlElement("description", {}, [xmlText(form.description)]),
    xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(form.accumulatedArgs))]),
  ];
  appendNode(children, renderPathList("command_paths", form.commandPaths));
  appendNode(children, renderPathList("loaded_knowledge", form.loadedKnowledgePaths));
  appendNode(children, renderPathList("command_knowledge_paths", form.commandKnowledgePaths));
  if (form.status === "executed" && form.result) {
    children.push(xmlElement("result", {}, [xmlText(form.result)]));
  }
  return children;
}

/** do_window 的渲染：target_thread + creator 标记 + 该 window 视图下的消息时间线。 */
function renderDoWindowChildren(window: DoWindow, thread: ThreadContext): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("target_thread", {}, [xmlText(window.targetThreadId)]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  // 视图过滤：from/to 端涉及 target 的消息进入该 window 的 transcript
  const transcriptMessages = filterMessagesForDoWindow(window, thread);
  if (transcriptMessages.length > 0) {
    children.push(
      xmlElement(
        "transcript",
        {},
        transcriptMessages.map((m) =>
          xmlElement(
            "message",
            { id: m.id, source: m.source },
            [
              xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
              xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
              xmlElement("content", {}, [xmlText(m.content)]),
            ]
          )
        )
      )
    );
  }
  return children;
}

/** todo_window 的渲染：content + on_command_path。 */
function renderTodoWindowChildren(window: TodoWindow): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("content", {}, [xmlText(window.content)]),
  ];
  if (window.onCommandPath && window.onCommandPath.length > 0) {
    children.push(renderPathList("on_command_path", window.onCommandPath)!);
  }
  return children;
}

/**
 * 把单个 window 投影成 XmlNode。
 *
 * 通用结构：
 *   <window id type status title>
 *     ...type 特有内容
 *     <sub_windows>...</sub_windows>
 *   </window>
 */
function renderWindowNode(window: ContextWindow, thread: ThreadContext, allWindows: ContextWindow[]): XmlNode {
  const children: XmlNode[] = [
    xmlElement("title", {}, [xmlText(window.title)]),
  ];

  switch (window.type) {
    case "command_exec":
      children.push(...renderCommandExecWindowChildren(window));
      break;
    case "do":
      children.push(...renderDoWindowChildren(window, thread));
      break;
    case "todo":
      children.push(...renderTodoWindowChildren(window));
      break;
    case "root":
      // root 一般不显式渲染（隐含 window）；如果出现就只渲染基本信息
      break;
  }

  // 子 window 折叠
  const subWindows = allWindows.filter((w) => w.parentWindowId === window.id);
  if (subWindows.length > 0) {
    children.push(
      xmlElement(
        "sub_windows",
        {},
        subWindows.map((sub) => renderWindowNode(sub, thread, allWindows))
      )
    );
  }

  return xmlElement("window", { id: window.id, type: window.type, status: window.status }, children);
}

/** 渲染 thread.contextWindows 的整体节点，按 root 下的直接子 window 自顶向下展开。 */
function renderContextWindowsNode(thread: ThreadContext): XmlNode | null {
  const all = thread.contextWindows ?? [];
  if (all.length === 0) return null;

  // 直接子 = parentWindowId 缺省 或 等于 ROOT_WINDOW_ID
  const topLevel = all.filter((w) => !w.parentWindowId || w.parentWindowId === ROOT_WINDOW_ID);
  return xmlElement(
    "context_windows",
    {},
    topLevel.map((w) => renderWindowNode(w, thread, all))
  );
}

/**
 * do_window 的视图过滤：选出与该 window targetThreadId 相关的消息。
 *
 * 规则（spec § inbox / outbox 在新模型下的归属）：
 * - 父侧 do_window：messages where to_thread_id == target（父 → 子）或 from_thread_id == target（子 → 父）
 * - 创建 creator do_window：targetThreadId 是父；同样规则
 *
 * 全部从 thread.inbox + thread.outbox 拉取并按 createdAt 升序。
 */
function filterMessagesForDoWindow(window: DoWindow, thread: ThreadContext): ThreadMessage[] {
  const target = window.targetThreadId;
  const all: ThreadMessage[] = [...(thread.inbox ?? []), ...(thread.outbox ?? [])];
  const seen = new Set<string>();
  const filtered = all.filter((m) => {
    if (seen.has(m.id)) return false;
    if (m.fromThreadId === target || m.toThreadId === target) {
      seen.add(m.id);
      return true;
    }
    return false;
  });
  filtered.sort((a, b) => a.createdAt - b.createdAt);
  return filtered;
}

/** 收集所有已被 window 视图收纳的消息 id；其余消息走顶层 inbox/outbox 兜底渲染。 */
function collectWindowConsumedMessageIds(thread: ThreadContext): Set<string> {
  const consumed = new Set<string>();
  for (const w of thread.contextWindows ?? []) {
    if (w.type !== "do") continue;
    for (const m of filterMessagesForDoWindow(w, thread)) {
      consumed.add(m.id);
    }
  }
  return consumed;
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
  contextWindows: ContextWindow[] | undefined;
  knowledgeEntries: Record<string, string>;
}): Promise<string> {
  // 写回 thread.contextWindows 的 enrich 后版本（不 mutate input.thread，但渲染时按 enriched 走）
  const threadForRender: ThreadContext = input.contextWindows
    ? { ...input.thread, contextWindows: input.contextWindows }
    : input.thread;

  const threadChildren: XmlNode[] = [];
  appendNode(threadChildren, optionalElement("creator_thread_id", threadForRender.creatorThreadId));
  appendNode(threadChildren, optionalElement("parent_thread_id", threadForRender.parentThreadId));
  appendNode(threadChildren, optionalElement("plan", threadForRender.plan));

  const contextWindowsNode = renderContextWindowsNode(threadForRender);
  if (contextWindowsNode) {
    threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with"));
    threadChildren.push(contextWindowsNode);
  }

  const knowledgeEntriesNode = renderKnowledgeEntriesNode(input.knowledgeEntries);
  if (knowledgeEntriesNode) {
    threadChildren.push(xmlComment("executable knowledge entries: deduplicated protocol knowledge for active windows in this turn"));
    threadChildren.push(knowledgeEntriesNode);
  }

  const activeKnowledgeNode = await computeActiveKnowledgeNode(threadForRender);
  if (activeKnowledgeNode) {
    threadChildren.push(xmlComment("active knowledge: persistent or activated project knowledge available to this turn"));
    threadChildren.push(activeKnowledgeNode);
  }

  // 顶层 inbox/outbox 渲染：仅展示未被任何 window 视图收纳的兜底消息（避免重复）
  const consumedMsgIds = collectWindowConsumedMessageIds(threadForRender);
  const fallbackInbox = (threadForRender.inbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
  const fallbackOutbox = (threadForRender.outbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
  appendNode(threadChildren, renderMessagesNode("inbox", fallbackInbox));
  appendNode(threadChildren, renderMessagesNode("outbox", fallbackOutbox));

  const root = xmlElement("context", {}, [
    xmlElement("thread", { id: threadForRender.id, status: threadForRender.status }, threadChildren),
  ]);

  return serializeXml(root);
}
