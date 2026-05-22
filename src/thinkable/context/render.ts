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
  FileWindow,
  KnowledgeWindow,
  ProgramWindow,
  RelationWindow,
  SearchWindow,
  TalkWindow,
  TodoWindow,
} from "../../executable/windows/_shared/types";
import { ROOT_WINDOW_ID } from "../../executable/windows/_shared/types";
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

function truncateFileBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= MAX_FILE_WINDOW_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_FILE_WINDOW_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

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

/** talk_window 渲染：target + transcript（按 windowId / replyToWindowId 过滤）。 */
function renderTalkWindowChildren(window: TalkWindow, thread: ThreadContext): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("target", {}, [xmlText(window.target)]),
    xmlElement("conversation_id", {}, [xmlText(window.conversationId)]),
  ];
  // 与 do_window 渲染对齐：creator talk_window 必须暴露 is_creator_window=true，
  // 否则 LLM 无法识别"哪条 talk 是创建本 thread 的对端通道"，常见症状是任务做完直接 wait
  // 而忘记 say 回去。protocol 文本（src/executable/index.ts § 一轮结束前的决策树）
  // 显式引用了这个字段。
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  const messages = filterMessagesForTalkWindow(window, thread);
  if (messages.length > 0) {
    children.push(
      xmlElement(
        "transcript",
        {},
        messages.map((m) =>
          xmlElement("message", { id: m.id, source: m.source }, [
            xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
            xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
            xmlElement("content", {}, [xmlText(m.content)]),
          ]),
        ),
      ),
    );
  }
  return children;
}

/** program_window 渲染：history 列表（每条 exec 一行 + 最近一条全文）。 */
function renderProgramWindowChildren(window: ProgramWindow): XmlNode[] {
  const children: XmlNode[] = [];
  if (window.history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }
  // 摘要：所有 exec 的 language + ok 状态
  const summary = window.history.map((rec, idx) => {
    const tag = rec.language;
    const okFlag = rec.ok ? "ok" : "fail";
    return xmlElement(
      "exec",
      { id: rec.execId, n: String(idx), kind: tag, ok: okFlag },
      [],
    );
  });
  children.push(xmlElement("history", {}, summary));

  // 最近一条 full output（过长时截断）
  const last = window.history[window.history.length - 1]!;
  children.push(
    xmlElement(
      "last_output",
      { exec_id: last.execId },
      [xmlText(truncateFileBody(last.output))],
    ),
  );
  return children;
}

/** file_window 渲染：path + lines/columns + 文件正文（按切片+截断）。 */
async function renderFileWindowChildren(window: FileWindow): Promise<XmlNode[]> {
  const children: XmlNode[] = [
    xmlElement("path", {}, [xmlText(window.path)]),
  ];
  if (window.lines) {
    children.push(xmlElement("lines", {}, [xmlText(`${window.lines[0]}-${window.lines[1]}`)]));
  }
  if (window.columns) {
    children.push(xmlElement("columns", {}, [xmlText(`${window.columns[0]}-${window.columns[1]}`)]));
  }
  try {
    const raw = await readFile(window.path, "utf8");
    const sliced = sliceByLinesColumns(raw, window.lines, window.columns);
    children.push(xmlElement("content", {}, [xmlText(truncateFileBody(sliced))]));
  } catch (error) {
    children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
  }
  return children;
}

/**
 * knowledge_window 渲染：path + 正文。
 *
 * Step 2 之后所有 knowledge 都通过 contextWindows 走，包括协议常量与 activator 命中：
 * - source=explicit  ：window.body 通常为空 → 回退到 loader 取（兼容旧 thread.json）
 * - source=protocol  ：window.body 必填，直接渲染
 * - source=activator ：window.body 在 presentation=full 时含正文，summary 时仅 description
 */
async function renderKnowledgeWindowChildren(
  window: KnowledgeWindow,
  thread: ThreadContext,
): Promise<XmlNode[]> {
  const children: XmlNode[] = [
    xmlElement("path", {}, [xmlText(window.path)]),
  ];
  if (window.source) {
    children.push(xmlElement("source", {}, [xmlText(window.source)]));
  }
  if (window.presentation) {
    children.push(xmlElement("presentation", {}, [xmlText(window.presentation)]));
  }
  if (window.description) {
    children.push(xmlElement("description", {}, [xmlText(window.description)]));
  }
  // body 已合成时直接用；否则（explicit 或老数据）回退 loader
  if (typeof window.body === "string" && window.body.length > 0) {
    children.push(xmlElement("content", {}, [xmlText(truncateKnowledgeBody(window.body))]));
    return children;
  }
  if (window.presentation === "summary") {
    // summary 来源不渲染正文
    return children;
  }
  if (!thread.persistence) {
    children.push(xmlElement("error", {}, [xmlText("thread 无 persistence ref")]));
    return children;
  }
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const index = await loadKnowledgeIndex(stoneRef);
    const doc = index.byPath.get(window.path);
    if (!doc) {
      children.push(xmlElement("error", {}, [xmlText(`knowledge "${window.path}" 不存在`)]));
    } else {
      if (doc.frontmatter.description && !window.description) {
        children.push(xmlElement("description", {}, [xmlText(doc.frontmatter.description)]));
      }
      children.push(xmlElement("content", {}, [xmlText(truncateKnowledgeBody(doc.body))]));
    }
  } catch (error) {
    children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
  }
  return children;
}

/**
 * search_window 渲染：query + matches（含截断标记）。
 *
 * 输出形态：
 *   <window type="search" kind="glob|grep" status="open">
 *     <title>...</title>
 *     <query>...</query>
 *     [<search_root>...</search_root>]   (仅 grep)
 *     <matches count="N" truncated="true|false">
 *       <match index="0" path="..." [line="42"]>[snippet 文本]</match>
 *       ...
 *     </matches>
 *   </window>
 *
 * matches 在创建时已截断到 200，这里只反映；snippet 已在创建侧 trim 到 200 字符。
 */
function renderSearchWindowChildren(window: SearchWindow): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
  ];
  if (window.searchRoot) {
    children.push(xmlElement("search_root", {}, [xmlText(window.searchRoot)]));
  }

  const matchNodes: XmlNode[] = window.matches.map((m) => {
    const attrs: Record<string, string> = {
      index: String(m.index),
      path: m.path,
    };
    if (typeof m.line === "number") attrs.line = String(m.line);
    return xmlElement(
      "match",
      attrs,
      m.snippet ? [xmlText(m.snippet)] : [],
    );
  });

  children.push(
    xmlElement(
      "matches",
      {
        count: String(window.matches.length),
        truncated: window.truncated ? "true" : "false",
      },
      matchNodes,
    ),
  );
  return children;
}

/**
 * 渲染 RelationWindow 给 LLM。把原来分散在三条 KnowledgeWindow 的内容(peer readme +
 * self long_term + self session)合并为本 window 的子元素。缺失字段渲染为占位提示,
 * 引导 LLM 用 open(parent_window_id="<rel>", command="edit", ...) 写入。
 */
function renderRelationWindowChildren(window: RelationWindow): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("peer_id", {}, [xmlText(window.peerId)]),
  ];

  // peer readme — 缺失就不渲染节点(LLM 不需要"占位"提示,不像 self relation 它能 edit)
  if (window.peerReadme !== undefined) {
    children.push(
      xmlElement("peer_readme", { path: window.peerReadmePath }, [xmlText(window.peerReadme)]),
    );
  }

  // self long_term / session — 缺失也保留节点 + 占位,让 LLM 知道有 edit 入口可写
  const longTermBody = window.selfLongTermBody !== undefined
    ? window.selfLongTermBody
    : `(暂无;通过 open(parent_window_id="${window.id}", command="edit", args={ content: "...", scope: "long_term" }) 写入)`;
  children.push(
    xmlElement("self_long_term", { path: window.selfLongTermPath }, [xmlText(longTermBody)]),
  );

  const sessionBody = window.selfSessionBody !== undefined
    ? window.selfSessionBody
    : `(暂无;通过 open(parent_window_id="${window.id}", command="edit", args={ content: "...", scope: "session" }) 写入)`;
  children.push(
    xmlElement("self_session", { path: window.selfSessionPath }, [xmlText(sessionBody)]),
  );

  return children;
}

/** 按行/列范围切片文件正文；range 缺失则原样返回。 */
function sliceByLinesColumns(
  raw: string,
  lines?: [number, number],
  columns?: [number, number],
): string {
  let body = raw;
  if (lines) {
    const arr = body.split("\n");
    const [start, end] = lines;
    body = arr.slice(start, end).join("\n");
  }
  if (columns) {
    const [start, end] = columns;
    body = body
      .split("\n")
      .map((line) => line.slice(start, end))
      .join("\n");
  }
  return body;
}

/**
 * 把单个 window 投影成 XmlNode。
 *
 * 通用结构：
 *   <window id type status title>
 *     ...type 特有内容
 *     <sub_windows>...</sub_windows>
 *   </window>
 *
 * 异步版本：file_window / knowledge_window 需要 IO 读 body。
 */
async function renderWindowNode(
  window: ContextWindow,
  thread: ThreadContext,
  allWindows: ContextWindow[],
): Promise<XmlNode> {
  // sharing 状态（plan §do_window.move）：用 snapshot 内容渲染，title 加前缀
  // - ref：自己持有的只读引用，owner 在别处
  // - lent_out：自己曾是 owner，已借出，临时只读
  const sharingState = window.sharing;
  const renderedWindow: ContextWindow = sharingState ? sharingState.snapshot : window;

  const titlePrefix = sharingState
    ? sharingState.kind === "ref"
      ? `[ref → owner@thread:${sharingState.ownerThreadId}] `
      : `[已借给 thread:${sharingState.borrowerThreadId}] `
    : "";

  const children: XmlNode[] = [
    xmlElement("title", {}, [xmlText(titlePrefix + renderedWindow.title)]),
  ];

  switch (renderedWindow.type) {
    case "command_exec":
      children.push(...renderCommandExecWindowChildren(renderedWindow));
      break;
    case "do":
      children.push(...renderDoWindowChildren(renderedWindow, thread));
      break;
    case "todo":
      children.push(...renderTodoWindowChildren(renderedWindow));
      break;
    case "talk":
      children.push(...renderTalkWindowChildren(renderedWindow, thread));
      break;
    case "program":
      children.push(...renderProgramWindowChildren(renderedWindow));
      break;
    case "file":
      children.push(...(await renderFileWindowChildren(renderedWindow)));
      break;
    case "knowledge":
      children.push(...(await renderKnowledgeWindowChildren(renderedWindow, thread)));
      break;
    case "search":
      children.push(...renderSearchWindowChildren(renderedWindow));
      break;
    case "relation":
      children.push(...renderRelationWindowChildren(renderedWindow));
      break;
    case "root":
      // root 一般不显式渲染（隐含 window）；如果出现就只渲染基本信息
      break;
  }

  // 子 window 折叠
  const subWindows = allWindows.filter((w) => w.parentWindowId === window.id);
  if (subWindows.length > 0) {
    const subNodes = await Promise.all(
      subWindows.map((sub) => renderWindowNode(sub, thread, allWindows)),
    );
    children.push(xmlElement("sub_windows", {}, subNodes));
  }

  // sharing 属性 + read_only 标记
  const attrs: Record<string, string> = {
    id: window.id,
    type: window.type,
    status: window.status,
  };
  if (sharingState) {
    attrs.read_only = "true";
    attrs.sharing = sharingState.kind;
    if (sharingState.kind === "ref") {
      attrs.owner_thread = sharingState.ownerThreadId;
    } else {
      attrs.borrower_thread = sharingState.borrowerThreadId;
    }
  }

  return xmlElement("window", attrs, children);
}

/** 渲染 thread.contextWindows 的整体节点，按 root 下的直接子 window 自顶向下展开。 */
async function renderContextWindowsNode(thread: ThreadContext): Promise<XmlNode | null> {
  const all = thread.contextWindows ?? [];
  if (all.length === 0) return null;

  const topLevel = all.filter((w) => !w.parentWindowId || w.parentWindowId === ROOT_WINDOW_ID);
  const children = await Promise.all(topLevel.map((w) => renderWindowNode(w, thread, all)));
  return xmlElement("context_windows", {}, children);
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

/**
 * talk_window 的视图过滤：
 * - outbox 上 windowId === self.id（say 写入时的标记）
 * - inbox 上 replyToWindowId === self.id（control plane user-reply 路由）
 *
 * spec § ThreadMessage 字段扩展。
 */
function filterMessagesForTalkWindow(window: TalkWindow, thread: ThreadContext): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  for (const m of thread.outbox ?? []) {
    if (m.windowId === window.id) messages.push(m);
  }
  for (const m of thread.inbox ?? []) {
    if (m.replyToWindowId === window.id) messages.push(m);
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

/** 收集所有已被 window 视图收纳的消息 id；其余消息走顶层 inbox/outbox 兜底渲染。 */
function collectWindowConsumedMessageIds(thread: ThreadContext): Set<string> {
  const consumed = new Set<string>();
  for (const w of thread.contextWindows ?? []) {
    if (w.type === "do") {
      for (const m of filterMessagesForDoWindow(w, thread)) consumed.add(m.id);
    } else if (w.type === "talk") {
      for (const m of filterMessagesForTalkWindow(w, thread)) consumed.add(m.id);
    }
  }
  return consumed;
}

// （renderActiveKnowledgeNode / computeActiveKnowledgeNode 已统一到
//  src/executable/index.ts: collectExecutableKnowledgeEntries 合成 KnowledgeWindow，
//  通过 contextWindows 渲染；本文件不再维护 <active_knowledge> 顶级节点。）

export async function renderContextXml(input: {
  thread: ThreadContext;
  contextWindows: ContextWindow[] | undefined;
  /** 兼容签名保留；实际 knowledge 已通过 contextWindows 投影。 */
  knowledgeEntries?: Record<string, string>;
}): Promise<string> {
  // 写回 thread.contextWindows 的 enrich 后版本（不 mutate input.thread，但渲染时按 enriched 走）
  const threadForRender: ThreadContext = input.contextWindows
    ? { ...input.thread, contextWindows: input.contextWindows }
    : input.thread;

  const threadChildren: XmlNode[] = [];
  appendNode(threadChildren, optionalElement("creator_thread_id", threadForRender.creatorThreadId));
  appendNode(threadChildren, optionalElement("parent_thread_id", threadForRender.parentThreadId));
  appendNode(threadChildren, optionalElement("plan", threadForRender.plan));

  const contextWindowsNode = await renderContextWindowsNode(threadForRender);
  if (contextWindowsNode) {
    threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with (knowledge synthesized as knowledge_window with source=protocol|activator|explicit)"));
    threadChildren.push(contextWindowsNode);
  }

  // <knowledge_entries> / <active_knowledge> 旧顶级节点已统一吸收进 contextWindows
  // （src/executable/index.ts: collectExecutableKnowledgeEntries 合成 KnowledgeWindow），
  // 这里不再单独渲染。input.knowledgeEntries 仅作为渲染回退兼容字段保留在签名中。

  // 顶层 inbox/outbox 渲染：仅展示未被任何 window 视图收纳的兜底消息（避免重复）
  const consumedMsgIds = collectWindowConsumedMessageIds(threadForRender);
  const fallbackInbox = (threadForRender.inbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
  const fallbackOutbox = (threadForRender.outbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
  appendNode(threadChildren, renderMessagesNode("inbox", fallbackInbox));
  appendNode(threadChildren, renderMessagesNode("outbox", fallbackOutbox));

  const root = xmlElement("context", {}, [
    ...renderSelfNodes(threadForRender),
    xmlElement("thread", { id: threadForRender.id, status: threadForRender.status }, threadChildren),
  ]);

  return serializeXml(root);
}

/**
 * <self object_id="..."> — Object 的对内身份标记。
 *
 * 让 LLM 在系统上下文顶部就能看到"我是谁"，对多 Object 共存的 Session 尤其重要。
 * 详细身份说明 (self.md 正文) 通过 LlmGenerateParams.instructions 传递，
 * 由 buildInputItems 读取并塞进 instructions 字段；此处只暴露稳定的 objectId 标记。
 *
 * thread.persistence 缺失（in-memory 测试模式）时返回空数组，保持原有渲染契约。
 */
function renderSelfNodes(thread: ThreadContext): XmlNode[] {
  const objectId = thread.persistence?.objectId;
  if (!objectId) return [];
  return [xmlElement("self", { object_id: objectId })];
}
