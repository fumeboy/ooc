/**
 * thread thinkable / context 构造 —— 把 thread 状态转成 LLM input items。
 *
 * 输入：thread (data) + ObjectInsRegistry (查每个窗的 readable.render) + 可选 worldDir + ownerId
 * 输出：LlmInputItem[]（system instructions + context windows + messages）
 *
 * 设计：每个 OocObjectRef 在 thread.contextWindows 里 = 一个 window；经其 class 的 readable.render
 * 投影成 ReadableProjection（view + content）,渲染成 XML 文本进 LLM input。
 *
 * **issue E**：window 内容渲染走 `renderReadable`（core 单一入口，3 档 fallback），本文件只负责
 * 自包 `<window>` XML 壳——payload 来自 `ReadableResult`。
 *
 * **issue N** knowledge 激活机制下沉:
 *   1. 旧 thread/context.ts 直渲 `<knowledge>` 顶层段已废止——activationEnv / loadKnowledgeIndex /
 *      computeActivations / renderKnowledge 整套迁入 `builtins/knowledge_base/`。
 *   2. 本文件改职责：
 *      - 调 core `scanIntents` 聚合 contextWindows 的 intents,作为 ReadableContext.intents 注入每个
 *        readable render。
 *      - 遇到 `_builtin/knowledge_base` ref 时预加载 KnowledgeIndex 注入 ref.data,让 kb 的 readable
 *        据 ctx.intents 自渲 `<knowledge>` 子节点。
 *   3. XML 形状变化：原来顶层 `<knowledge>` 段，现在归到 `<window class="_builtin/knowledge_base">`
 *      内的 `<knowledge>` 子节点。
 */
import type { LlmInputItem } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { XmlNode } from "@ooc/core/types/index.js";
import { xmlElement, xmlText, serializeXml } from "@ooc/core/types/xml.js";
import { renderReadable } from "@ooc/core/readable/index.js";
import { scanIntents } from "@ooc/core/thinkable/context/index.js";
import { isSelfThreadWindow, threadWindowIdOf } from "@ooc/core/types/context-window.js";
import { DEFAULT_WINDOW_VIEW } from "@ooc/core/runtime/object-registry.js";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import readableModule from "../readable/index.js";
import type { ReadableContext } from "@ooc/core/types/index.js";
import { loadKnowledgeIndex } from "@ooc/builtins/knowledge_base/loader.js";
import type { ThreadContext, ThreadMessage, ThreadWin } from "../types.js";

const KNOWLEDGE_BASE_CLASS_ID = "_builtin/knowledge_base";

/**
 * 把一个 window 渲染成 XML 节点。
 *
 * - **self-view ref**（issue I：id 形如 `w_creator_<threadId>`,session 表里没对应 inst）→ 短路
 *   直接调本 thread 的 readable.readable(thread, ref),投影 class 由 readable 自身据视角算
 *   （self / super）。不走 renderReadable 的 inst 解析。
 * - **其它 ref**：经 core `renderReadable` 3 档 fallback。
 *
 * 本函数始终自包 `<window>` XML 壳。
 *
 * **issue N**：caller 传入 `intents`（core scanIntents 聚合的本轮 Set）；本函数把它注入
 * ReadableContext.intents,所有 readable render 据此跑"基于意图的资源激活"（knowledge_base 是
 * 实现之一）。renderReadable 内部构造 ctx 时也注入同一 intents（已统一）。
 */
async function renderWindow(
  ref: OocObjectRef,
  registry: ObjectInsRegistry,
  thread: ThreadContext,
  intents: Set<string>,
): Promise<XmlNode> {
  // self-view ref 短路:直接调本 thread readable,避免 renderReadable 找不到 inst data
  if (isSelfThreadWindow(ref.id) && ref.id === threadWindowIdOf(thread.id)) {
    const ctx: ReadableContext = { object: { id: ref.id, class: ref.class }, intents };
    const projection = await readableModule.readable(
      ctx,
      makeReadonlySelfProxy(thread),
      ref as OocObjectRef<ThreadWin>,
    );
    if (projection.win !== undefined) ref.data = projection.win;
    const content = Array.isArray(projection.content)
      ? projection.content
      : [xmlText(projection.content)];
    return xmlElement(
      "window",
      { id: ref.id, view: projection.view, title: ref.title ?? "" },
      content,
    );
  }
  const result = await renderReadable(ref, registry, registry, { intents });
  const content = Array.isArray(result.payload)
    ? result.payload
    : [xmlText(result.payload)];
  if (result.nextWin !== undefined) ref.data = result.nextWin;
  // issue J:`<window view="...">` —— 投影视角而非对象 class id;优先用 render 返回的
  // projectionView,缺省回退 ref.window_view,最终 DEFAULT_WINDOW_VIEW。
  const projectionView = result.projectionView ?? ref.window_view ?? DEFAULT_WINDOW_VIEW;
  return xmlElement(
    "window",
    { id: ref.id, view: projectionView, title: ref.title ?? "" },
    content,
  );
}

function renderMessages(messages: ThreadMessage[], tail = 40): XmlNode {
  const slice = messages.slice(-tail);
  const children = slice.map((m) =>
    xmlElement(
      "message",
      { from: m.from, at: String(m.createdAt) },
      [xmlText(m.content)],
    ),
  );
  return xmlElement("messages", { count: String(slice.length) }, children);
}

function systemInstructions(thread: ThreadContext): string {
  return [
    `You are an OOC agent thread (id=${thread.id}, owner=${thread.calleeObjectId}).`,
    `Your world is a set of context windows; each window is an object you can inspect or operate on.`,
    `Use the tool primitives: exec (call a method on a window), close (remove a window), wait (suspend on a window for new input).`,
    `Always emit one tool call per turn unless you have nothing useful to do.`,
  ].join("\n");
}

export interface BuildLlmInputOptions {
  /** world 根目录；提供则启用 knowledge activator。 */
  worldDir?: string;
}

/**
 * issue N: **协议层 intents 聚合** + **knowledge_base ref 预加载 index 注入** 都在本入口完成,
 * 让 knowledge_base.readable 据 ctx.intents 自渲 `<knowledge>` 子节点。
 *
 * - core `scanIntents` 聚合 contextWindows 中所有 readable.intents 供给——典型 producer 是
 *   `method_exec_form`（产 form_open intent）和 `thread` 自己（据 sessionId 产 super_flow intent）。
 * - knowledge_base ref 在被渲染前,把 KnowledgeIndex 写入 ref.data.index,让 kb.readable 直读。
 *
 * 构造本轮 LLM input。
 *
 * - system instructions（静态 prompt）
 * - <context_windows>（thread 全部窗的 readable 渲染合一,knowledge_base ref 自渲 `<knowledge>` 子节点）
 * - <messages>（最近 thread.messages）
 */
export async function buildLlmInput(
  thread: ThreadContext,
  registry: ObjectInsRegistry,
  opts: BuildLlmInputOptions = {},
): Promise<LlmInputItem[]> {
  // 聚合本轮 intents（core scanIntents,统一 Set 去重）
  const intents = scanIntents(thread.contextWindows, registry, registry);

  // 预加载 knowledge index 注入 knowledge_base ref（若有）。kb 不在 ref 集 → 整段消失（裁决 13）。
  if (opts.worldDir) {
    const kbRef = thread.contextWindows.find((r) => r.class === KNOWLEDGE_BASE_CLASS_ID);
    if (kbRef) {
      try {
        const index = await loadKnowledgeIndex(opts.worldDir, thread.calleeObjectId);
        // 把 index 注入 ref.data —— kb.readable 经 win.data?.index 读取
        kbRef.data = { ...(kbRef.data as object | undefined ?? {}), index };
      } catch (e) {
        // 加载失败不阻塞 thinkloop;kb readable 走 fallback 不渲 <knowledge> 子节点
        console.warn(`[context] knowledge index load failed: ${(e as Error).message}`);
      }
    }
  }

  const windowNodes: XmlNode[] = [];
  for (const ref of thread.contextWindows) {
    windowNodes.push(await renderWindow(ref, registry, thread, intents));
  }
  const contextWindowsXml = serializeXml(xmlElement("context_windows", {}, windowNodes));
  const messagesXml = serializeXml(renderMessages(thread.messages));

  const parts = [systemInstructions(thread), contextWindowsXml, messagesXml];

  return [
    {
      type: "message",
      role: "system",
      content: parts.join("\n\n"),
    },
  ];
}
