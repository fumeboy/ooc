/**
 * Context XML 渲染调度器。
 *
 * 设计哲学（根因 #4 接口 explicit；2026-05-24 fix-plan）：
 * - render.ts 只负责通用框架：外层 `<context><self/><thread>...</thread></context>` +
 *   每个 window 的 `<window id type status>` 外壳 + `<title>` + `<commands>` 元数据 +
 *   `<sub_windows>` 折叠 + sharing 属性 + 顶层 inbox/outbox 兜底
 * - 各 window type 的"内容渲染"作为 RenderHook 注册到 WindowRegistry，本文件按 type
 *   调度而不再 switch-by-case；缺 hook 会在启动期 fail-loud（registry.assertAll...）
 *
 * 修复点对照：
 * - R2 #1  : skill_index / custom object types 的 renderXml hook 不再被忽略 — 通过 def.renderXml 调度
 * - R2 #5  : 每个 window 末尾输出 `<commands>` 块（命令名 + 简要说明），LLM 直接看到该
 *            window 上可调用的命令面
 * - R2 #10 : 同上；不再需要让 LLM 翻 knowledge 文本去猜命令
 * - R3 #15 : talk_window transcript 已由 talk/index.ts:renderTalkWindow + filter 函数渲染
 * - R6 #46 : skill_index 通过通用调度器输出，不再被 switch 漏掉
 */

import {
  getWindowTypeDefinition,
  getObjectDefinition,
  resolveParentClassChain,
  type RenderContext,
} from "../../executable/windows/_shared/registry";
import { filterMessagesForDoWindow } from "../../executable/windows/do/index";
import { filterMessagesForTalkWindow } from "../../executable/windows/talk/index";
import type { ContextWindow } from "../../executable/windows/_shared/types";
import { ROOT_WINDOW_ID } from "../../executable/windows/_shared/types";
import type { ThreadContext, ThreadMessage } from "./index";
import {
  appendNode,
  optionalElement,
  serializeXml,
  xmlComment,
  xmlElement,
  xmlText,
  type XmlNode,
} from "./xml";
import { loadObjectReadable, loadObjectWindow } from "../../executable/server/loader.js";
import { readReadable, readReadme, type StoneObjectRef } from "../../persistable/index.js";

// ─────────────────────────── helpers (顶层 inbox/outbox) ──────────────────────

/**
 * 从消息里取正文。兼容两种字段名：
 * - `content`：ThreadMessage 类型定义里的 canonical 字段
 * - `text`：历史遗留 / 手动构造消息时常用的别名
 */
function messageBody(message: ThreadMessage): string {
  return (message as any).content ?? (message as any).text ?? "";
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
        xmlElement("content", {}, [xmlText(messageBody(message))]),
        xmlElement("source", {}, [xmlText(message.source)]),
        xmlElement("created_at", {}, [xmlText(String(message.createdAt))]),
      ]),
    ),
  );
}

// ─────────────────────────── commands 元数据节点 ──────────────────────────────

const COMMAND_BRIEF_MAX = 80;

/**
 * 为某 window 输出一段 `<commands>` 元数据，列出该 type 上注册的所有 command 名
 * 与简要说明（R2 #5 / R2 #10 修复）。
 *
 * 简要说明取自 `def.commands[name]` 的 paths 末尾或 — 因为 CommandTableEntry 没有
 * 独立的 "brief" 字段——我们以 command name 加上"通过 open/exec(parent_window_id=...,
 * command=...) 调用"的标准提示。具体的 knowledge 文本仍由 form 上下文 / basicKnowledge
 * 提供，本节点只做"命令面索引"。
 *
 * 空 commands 表的 window（如 todo / skill_index）不输出该节点，避免噪音。
 *
 * 压缩态(window.compressLevel ≥ 1)的 window 额外注入一条通用 `expand` command —
 * 不需要每个 type 自己注册;由 expand-command 模块在 exec 路径上响应(B5)。
 */
function renderCommandsNode(window: ContextWindow): XmlNode | null {
  const def = getWindowTypeDefinition(window.type);
  const names = Object.keys(def.commands ?? {});
  const isCompressed = (window.compressLevel ?? 0) >= 1;
  if (names.length === 0 && !isCompressed) return null;
  names.sort();

  const children: XmlNode[] = names.map((name) => {
    const entry = def.commands[name];
    const paths = entry?.paths ?? [name];
    const brief = paths.join(", ").slice(0, COMMAND_BRIEF_MAX);
    return xmlElement(
      "command",
      { name },
      [xmlText(brief)],
    );
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

// ─── Readable Resolution (2026-05-28 ooc-6 Object Unification; P6.§7 parentClass inheritance 2026-06-02) ───

/**
 * 对单个 type 尝试解析 readable（不涉及继承链）。
 *
 * 返回 XmlNode[] 表示命中；返回 undefined 表示该 type 无 readable，需要继续回退。
 *
 * 优先级：
 *   1. registry.def.readable（builtin types 在注册时直接注入）
 *   2. ObjectWindowDefinition.readable（stone 的 executable/index.ts export const window.readable）
 *   3. readable.ts 导出的函数（stone 侧动态渲染）
 *   4. readable.md 静态内容
 *   5. readme.md（身份说明 fallback）
 *
 * 只有 builtin types 会命中 #1；stone-backed types 走 #2–#5。
 */
async function resolveReadableForType(
  classType: string,
  window: ContextWindow,
  renderCtx: RenderContext,
  thread: ThreadContext,
  persistence: { baseDir: string } | undefined,
): Promise<XmlNode[] | undefined> {
  // Step 1: registry.readable（builtin types 走这条，因为它们没有 stone 可读文件）
  try {
    const def = getObjectDefinition(classType as any);
    if (def.readable) {
      return await def.readable(renderCtx);
    }
  } catch {
    // 未注册 → 静默继续，尝试 stone 路径
  }

  // Steps 2-5 都需要 stone/persistence。若无 persistence，直接 miss。
  if (!persistence) return undefined;

  const stoneRef: StoneObjectRef = { baseDir: persistence.baseDir, objectId: classType };

  // Step 2: ObjectWindowDefinition.readable（stone executable/index.ts export const window.readable）
  try {
    const objWin = await loadObjectWindow(stoneRef);
    if (objWin?.readable) {
      return await objWin.readable(renderCtx);
    }
  } catch {
    // 静默失败，继续
  }

  // Step 3: readable.ts 动态函数
  try {
    const readableFn = await loadObjectReadable(stoneRef);
    if (readableFn) {
      return await readableFn(renderCtx);
    }
  } catch {
    // 静默失败，继续
  }

  // Step 4: readable.md 静态内容
  try {
    const readableText = await readReadable(stoneRef);
    if (readableText && readableText.trim().length > 0) {
      return [xmlElement("readable", {}, [xmlText(readableText)])];
    }
  } catch {
    // 静默失败，fallback 到 readme
  }

  // Step 5: readme.md fallback
  try {
    const readmeText = await readReadme(stoneRef);
    if (readmeText && readmeText.trim().length > 0) {
      return [xmlElement("readable", { source: "readme" }, [xmlText(readmeText)])];
    }
  } catch {
    // 静默失败
  }

  return undefined;
}

/**
 * 解析 Object 的 readable 渲染内容。
 *
 * P6.§7 (2026-06-02): 先在自身 type 解析；miss 后沿 parentClass 继承链（closest → farthest）
 * 逐个 ancestor 尝试；整条链都 miss 时返回 minimal placeholder。
 *
 * 返回 undefined 只在「builtin type + 无 persistence」等极少数路径出现（caller 会 fallback 到 renderXml）。
 */
async function resolveObjectReadable(
  window: ContextWindow,
  renderCtx: RenderContext,
  thread: ThreadContext,
): Promise<XmlNode[] | undefined> {
  // ooc-6: For custom object types (not builtin), resolve readable via stone.
  // Window id = object id in the new design.
  const BUILTIN_TYPES = new Set([
    "root", "command_exec", "do", "todo", "talk", "program",
    "file", "knowledge", "search", "relation", "skill_index",
    "feishu_chat", "feishu_doc", "plan"
  ]);

  // Builtin types 无 persistence 也能解析（readable 在 registry 里）；
  // 但如果它们 registry.readable 为空，也不需要 stone 路径 fallback——直接返回 undefined。
  if (BUILTIN_TYPES.has(window.type)) {
    return resolveReadableForType(window.type, window, renderCtx, thread, undefined);
  }

  const persistence = thread.persistence;
  if (!persistence) return undefined;

  // Step A: 自身 type 尝试
  const selfResult = await resolveReadableForType(window.type, window, renderCtx, thread, persistence);
  if (selfResult) return selfResult;

  // Step B: 沿 parentClass 继承链回退（closest → farthest）
  for (const ancestorType of resolveParentClassChain(window.type as any)) {
    const ancestorResult = await resolveReadableForType(
      ancestorType, window, renderCtx, thread, persistence,
    );
    if (ancestorResult) return ancestorResult;
  }

  // Step C: 整条链都 miss → placeholder
  return [
    xmlElement(
      "readable",
      { source: "placeholder" },
      [xmlText(`Object "${window.id}" 没有可渲染的 readable 或 readme 内容（包括 parentClass 继承链）。`)],
    ),
  ];
}

// ─────────────────────────── window 节点调度 ──────────────────────────────────

/**
 * 把单个 window 投影成 XmlNode。
 *
 * 通用结构：
 *   <window id type status [sharing read_only]>
 *     <title>...</title>
 *     ...type-specific children (由 def.renderXml 提供)
 *     <commands hint="...">...</commands>
 *     <sub_windows>...</sub_windows>?
 *   </window>
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

  // ── 调度到 type-specific renderXml / compressView hook
  //   compressLevel >= 1 → 走 compressView(若 type 注册了)；否则走通用 fallback
  //   compressLevel = 0 / undefined → 走 renderXml（接口契约，无 fallback）
  const def = getWindowTypeDefinition(renderedWindow.type);
  const compressLevel = (renderedWindow.compressLevel ?? 0) as 0 | 1 | 2;
  const renderCtx: RenderContext = { thread, window: renderedWindow };

  if (compressLevel === 1 || compressLevel === 2) {
    if (def.compressView) {
      const typeChildren = await def.compressView(renderCtx, compressLevel);
      children.push(...typeChildren);
    } else {
      // 通用 fallback: 仅输出 <compressed> 元节点;commands 末尾再追加 expand 由
      // renderCommandsNode 注入(任何 compressLevel >= 1 的 window 都自动获得 expand)
      children.push(
        xmlElement(
          "compressed",
          { level: String(compressLevel) },
          [
            xmlText(
              `本 window 处于压缩态(level=${compressLevel}); type "${renderedWindow.type}" 未注册 compressView hook(P0c 待补)。通过 expand 命令恢复完整内容。`,
            ),
          ],
        ),
      );
    }
  } else {
    // 2026-05-28 ooc-6 Object Unification: 优先尝试 readable 渲染
    const readableChildren = await resolveObjectReadable(renderedWindow, renderCtx, thread);
    if (readableChildren) {
      children.push(...readableChildren);
    } else {
      if (!def.renderXml) {
        throw new Error(
          `render.ts: window type "${renderedWindow.type}" 缺少 renderXml hook（接口契约）。`,
        );
      }
      const typeChildren = await def.renderXml(renderCtx);
      children.push(...typeChildren);
    }
  }

  // ── commands 元数据（R2 #5 / R2 #10）
  appendNode(children, renderCommandsNode(renderedWindow));

  // ── 子 window 折叠
  const subWindows = allWindows.filter((w) => w.parentWindowId === window.id);
  if (subWindows.length > 0) {
    const subNodes = await Promise.all(
      subWindows.map((sub) => renderWindowNode(sub, thread, allWindows)),
    );
    children.push(xmlElement("sub_windows", {}, subNodes));
  }

  // ── attrs：id / type / status / sharing
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

// ─────────────────────────── entry point ──────────────────────────────────────

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
  // thread.plan 字段已废弃 (2026-05-26, patches.thread_plan_deprecated)；
  // 行动计划现以 first-class plan_window 形式渲染在 <context_windows> 子树中。

  const contextWindowsNode = await renderContextWindowsNode(threadForRender);
  if (contextWindowsNode) {
    threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with (knowledge synthesized as knowledge_window with source=protocol|activator|explicit)"));
    threadChildren.push(contextWindowsNode);
  }

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

/** 兼容 re-export：旧代码引用 escapeXml 时可继续从本模块拿到。 */
export { escapeXml } from "./xml";
