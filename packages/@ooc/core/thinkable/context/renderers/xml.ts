/**
 * XmlRenderer — renders a ContextSnapshot to the XML format used by the LLM.
 *
 * Replaces the old renderContextXml function.
 * Structure:
 *   <context>
 *     <self object_id="..."/>
 *     <thread id="..." status="...">
 *       <creator_thread_id>...</creator_thread_id>
 *       <parent_thread_id>...</parent_thread_id>
 *       <context_windows>
 *         <window id type status [sharing read_only]>
 *           <title>...</title>
 *           ... type-specific content (readable / renderXml / compressView)
 *           <commands hint="...">...</commands>
 *           <sub_windows>...</sub_windows>?
 *         </window>
 *       </context_windows>
 *       <inbox><message>...</message>...</inbox>?
 *       <outbox><message>...</message>...</outbox>?
 *     </thread>
 *     <context_overflow item_count="N">
 *       <item id title relevance reason/>...
 *     </context_overflow>?
 *   </context>
 */
import type { ContextSnapshot } from "../snapshot.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID } from "../../../executable/windows/_shared/types.js";
import {
  type RenderContext,
  type ObjectRegistry,
} from "../../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../../executable/windows/index.js";
import { filterMessagesForDoWindow } from "../../../executable/windows/do/index.js";
import { filterMessagesForTalkWindow } from "../../../executable/windows/talk/index.js";
import type { ThreadContext, ThreadMessage } from "../index.js";
import { loadObjectReadable, loadObjectWindow } from "../../../runtime/server-loader.js";
import { readReadable, type StoneObjectRef } from "../../../persistable/index.js";
import {
  appendNode,
  optionalElement,
  serializeXml,
  xmlComment,
  xmlElement,
  xmlText,
  type XmlNode,
} from "../xml.js";

// ─────────────────────────── helpers (inbox/outbox) ──────────────────────────

function messageBody(message: ThreadMessage): string {
  return (message as any).content ?? (message as any).text ?? "";
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
        xmlElement("content", {}, [xmlText(messageBody(message))]),
        xmlElement("source", {}, [xmlText(message.source)]),
        xmlElement("created_at", {}, [xmlText(String(message.createdAt))]),
      ]),
    ),
  );
}

// ─────────────────────────── commands node ───────────────────────────────────

const COMMAND_BRIEF_MAX = 80;

function renderMethodsNode(window: ContextWindow, registry: ObjectRegistry): XmlNode | null {
  const def = registry.getObjectDefinition(window.type);
  const names = Object.keys(def.methods ?? {});
  const isCompressed = (window.compressLevel ?? 0) >= 1;
  if (names.length === 0 && !isCompressed) return null;
  names.sort();

  const children: XmlNode[] = names.map((name) => {
    const entry = def.methods[name];
    const paths = entry?.paths ?? [name];
    const brief = paths.join(", ").slice(0, COMMAND_BRIEF_MAX);
    return xmlElement("command", { name }, [xmlText(brief)]);
  });

  if (isCompressed) {
    children.push(
      xmlElement("command", { name: "expand" }, [
        xmlText("expand: 把本 window 从压缩态恢复为完整态(compressLevel → 0)"),
      ]),
    );
  }

  return xmlElement(
    "commands",
    {
      hint: `通过 open(parent_window_id="${window.id}", command="<name>", args={...}) 调用`,
    },
    children,
  );
}

// ─────────────────────────── readable resolution ─────────────────────────────

const BUILTIN_TYPES = new Set([
  "root", "method_exec", "do", "todo", "talk", "program",
  "file", "knowledge", "search", "relation", "skill_index",
  "feishu_chat", "feishu_doc", "plan", "guidance",
]);

async function resolveReadableForType(
  classType: string,
  window: ContextWindow,
  renderCtx: RenderContext,
  _thread: ThreadContext,
  persistence: { baseDir: string } | undefined,
  registry: ObjectRegistry,
): Promise<XmlNode[] | undefined> {
  // Step 1: registry.readable (builtin types)
  try {
    const def = registry.getObjectDefinition(classType as any);
    if (def.readable) {
      return await def.readable(renderCtx);
    }
  } catch {
    // continue
  }

  if (!persistence) return undefined;

  const stoneRef: StoneObjectRef = { baseDir: persistence.baseDir, objectId: classType };

  // Step 2: ObjectWindowDefinition.readable
  try {
    const objWin = await loadObjectWindow(stoneRef);
    if (objWin?.readable) {
      return await objWin.readable(renderCtx);
    }
  } catch { /* continue */ }

  // Step 3: readable.ts dynamic function
  try {
    const readableFn = await loadObjectReadable(stoneRef);
    if (readableFn) {
      return await readableFn(renderCtx);
    }
  } catch { /* continue */ }

  // Step 4: readable.md static content (readReadable falls back to legacy readme.md internally)
  try {
    const readableText = await readReadable(stoneRef);
    if (readableText && readableText.trim().length > 0) {
      return [xmlElement("readable", {}, [xmlText(readableText)])];
    }
  } catch { /* continue */ }

  return undefined;
}

async function resolveObjectReadable(
  window: ContextWindow,
  renderCtx: RenderContext,
  thread: ThreadContext,
  registry: ObjectRegistry,
): Promise<XmlNode[] | undefined> {
  if (BUILTIN_TYPES.has(window.type)) {
    return resolveReadableForType(window.type, window, renderCtx, thread, undefined, registry);
  }

  const persistence = thread.persistence;
  if (!persistence) return undefined;

  const selfResult = await resolveReadableForType(window.type, window, renderCtx, thread, persistence, registry);
  if (selfResult) return selfResult;

  for (const ancestorType of registry.resolveParentClassChain(window.type as any)) {
    const ancestorResult = await resolveReadableForType(
      ancestorType, window, renderCtx, thread, persistence, registry,
    );
    if (ancestorResult) return ancestorResult;
  }

  return [
    xmlElement(
      "readable",
      { source: "placeholder" },
      [xmlText(`Object "${window.id}" 没有可渲染的 readable 或 readme 内容（包括 parentClass 继承链）。`)],
    ),
  ];
}

// ─────────────────────────── window node rendering ───────────────────────────

async function renderWindowNode(
  window: ContextWindow,
  thread: ThreadContext,
  allWindows: ContextWindow[],
  registry: ObjectRegistry,
): Promise<XmlNode> {
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

  const def = registry.getObjectDefinition(renderedWindow.type as never);
  const compressLevel = (renderedWindow.compressLevel ?? 0) as 0 | 1 | 2;
  const renderCtx: RenderContext = { thread, window: renderedWindow };

  if (compressLevel === 1 || compressLevel === 2) {
    if (def.compressView) {
      const typeChildren = await def.compressView(renderCtx, compressLevel);
      children.push(...typeChildren);
    } else {
      children.push(
        xmlElement(
          "compressed",
          { level: String(compressLevel) },
          [
            xmlText(
              `本 window 处于压缩态(level=${compressLevel}); type "${renderedWindow.type}" 未注册 compressView hook。通过 expand 命令恢复完整内容。`,
            ),
          ],
        ),
      );
    }
  } else {
    const readableChildren = await resolveObjectReadable(renderedWindow, renderCtx, thread, registry);
    if (readableChildren) {
      children.push(...readableChildren);
    } else {
      if (!def.renderXml) {
        throw new Error(
          `XmlRenderer: window type "${renderedWindow.type}" 缺少 renderXml hook（接口契约）。`,
        );
      }
      const typeChildren = await def.renderXml(renderCtx);
      children.push(...typeChildren);
    }
  }

  appendNode(children, renderMethodsNode(renderedWindow, registry));

  const subWindows = allWindows.filter((w) => w.parentWindowId === window.id);
  if (subWindows.length > 0) {
    const subNodes = await Promise.all(
      subWindows.map((sub) => renderWindowNode(sub, thread, allWindows, registry)),
    );
    children.push(xmlElement("sub_windows", {}, subNodes));
  }

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

async function renderContextWindowsNode(
  windows: ContextWindow[],
  thread: ThreadContext,
  registry: ObjectRegistry,
): Promise<XmlNode | null> {
  if (windows.length === 0) return null;

  const topLevel = windows.filter((w) => !w.parentWindowId || w.parentWindowId === ROOT_WINDOW_ID);
  const children = await Promise.all(topLevel.map((w) => renderWindowNode(w, thread, windows, registry)));
  return xmlElement("context_windows", {}, children);
}

function collectWindowConsumedMessageIds(windows: ContextWindow[], thread: ThreadContext): Set<string> {
  const consumed = new Set<string>();
  for (const w of windows ?? []) {
    if (w.type === "do") {
      for (const m of filterMessagesForDoWindow(w, thread)) consumed.add(m.id);
    } else if (w.type === "talk") {
      for (const m of filterMessagesForTalkWindow(w, thread)) consumed.add(m.id);
    }
  }
  return consumed;
}

// ─────────────────────────── self nodes ──────────────────────────────────────

function renderSelfNodes(objectId: string | undefined): XmlNode[] {
  if (!objectId) return [];
  return [xmlElement("self", { object_id: objectId })];
}

// ─────────────────────────── XmlRenderer class ───────────────────────────────

export class XmlRenderer {
  private registry: ObjectRegistry;

  constructor(registry?: ObjectRegistry) {
    this.registry = registry ?? builtinRegistry;
  }

  async render(snapshot: ContextSnapshot, thread: ThreadContext): Promise<string> {
    // Use snapshot.windows (already budget-allocated) for rendering
    const windows = snapshot.windows;
    const threadForRender: ThreadContext = {
      ...thread,
      contextWindows: windows,
    };

    const threadChildren: XmlNode[] = [];
    appendNode(threadChildren, optionalElement("creator_thread_id", threadForRender.creatorThreadId));
    appendNode(threadChildren, optionalElement("parent_thread_id", threadForRender.parentThreadId));

    const contextWindowsNode = await renderContextWindowsNode(windows, threadForRender, this.registry);
    if (contextWindowsNode) {
      threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with (knowledge synthesized as knowledge_window with source=protocol|activator|explicit)"));
      threadChildren.push(contextWindowsNode);
    }

    // Top-level inbox/outbox fallback
    const consumedMsgIds = collectWindowConsumedMessageIds(windows, threadForRender);
    const fallbackInbox = (threadForRender.inbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
    const fallbackOutbox = (threadForRender.outbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
    appendNode(threadChildren, renderMessagesNode("inbox", fallbackInbox));
    appendNode(threadChildren, renderMessagesNode("outbox", fallbackOutbox));

    const rootChildren: XmlNode[] = [
      ...renderSelfNodes(threadForRender.persistence?.objectId),
      xmlElement("thread", { id: threadForRender.id, status: threadForRender.status }, threadChildren),
    ];

    // <context_overflow> section
    if (snapshot.overflow.length > 0) {
      const overflowNodes: XmlNode[] = snapshot.overflow.map((o) => ({
        kind: "element",
        tag: "item",
        attrs: {
          id: o.id,
          title: o.title,
          relevance: o.relevance.toFixed(2),
          reason: o.reason,
        },
      }));

      rootChildren.push({
        kind: "element",
        tag: "context_overflow",
        attrs: {
          item_count: String(snapshot.overflow.length),
        },
        children: overflowNodes,
      });
    }

    const root: XmlNode = {
      kind: "element",
      tag: "context",
      attrs: {},
      children: rootChildren,
    };

    return serializeXml(root);
  }
}
