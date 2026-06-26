/**
 * thread thinkable / context 构造 —— 把 thread 状态转成 LLM input items。
 *
 * 输入：thread (data) + ObjectInsRegistry (查每个窗的 readable.render) + 可选 worldDir + ownerId
 * 输出：LlmInputItem[]（system instructions + activated knowledge + context windows + messages）
 *
 * 设计：每个 OocObjectRef 在 thread.contextWindows 里 = 一个 window；经其 class 的 readable.render
 * 投影成 ReadableProjection（class + content），渲染成 XML 文本进 LLM input。
 *
 * **issue E**：window 内容渲染走 `renderReadable`（core 单一入口，3 档 fallback），本文件只负责
 * 自包 `<window>` XML 壳——payload 来自 `ReadableResult`。
 *
 * knowledge activation：根据当前 contextWindows 的 class 集合计算 ActivationContext，
 * 经 knowledge_base loader 拿 owner 的 KnowledgeIndex，computeActivations 输出激活列表，
 * 按 presentation (full/summary) 嵌入 system message。
 */
import type { LlmInputItem } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { XmlNode } from "@ooc/core/types/index.js";
import { xmlElement, xmlText, serializeXml } from "@ooc/core/types/xml.js";
import { isSuperSessionId } from "@ooc/core/types/constants.js";
import { renderReadable } from "@ooc/core/readable/index.js";
import { isSelfThreadWindow, threadWindowIdOf } from "@ooc/core/types/context-window.js";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import readableModule from "../readable/index.js";
import type { ReadableContext } from "@ooc/core/types/index.js";
import {
  type ActivationContext,
  computeActivations,
} from "@ooc/core/thinkable/knowledge/index.js";
import type { ActivationResult } from "@ooc/core/types/knowledge.js";
import { loadKnowledgeIndex } from "@ooc/builtins/knowledge_base/loader.js";
import type { ThreadContext, ThreadMessage, ThreadWin } from "../types.js";

/**
 * 把一个 window 渲染成 XML 节点。
 *
 * - **self-view ref**（issue I：id 形如 `w_creator_<threadId>`,session 表里没对应 inst）→ 短路
 *   直接调本 thread 的 readable.readable(thread, ref),投影 class 由 readable 自身据视角算
 *   （self / super）。不走 renderReadable 的 inst 解析。
 * - **其它 ref**：经 core `renderReadable` 3 档 fallback。
 *
 * 本函数始终自包 `<window>` XML 壳。
 */
async function renderWindow(
  ref: OocObjectRef,
  registry: ObjectInsRegistry,
  thread: ThreadContext,
): Promise<XmlNode> {
  // self-view ref 短路:直接调本 thread readable,避免 renderReadable 找不到 inst data
  if (isSelfThreadWindow(ref.id) && ref.id === threadWindowIdOf(thread.id)) {
    const ctx: ReadableContext = { object: { id: ref.id, class: ref.class } };
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
      { id: ref.id, class: projection.class, title: ref.title ?? "" },
      content,
    );
  }
  const result = await renderReadable(ref, registry, registry);
  const content = Array.isArray(result.payload)
    ? result.payload
    : [xmlText(result.payload)];
  if (result.nextWin !== undefined) ref.data = result.nextWin;
  const projectionClass = result.projectionClass ?? ref.class;
  return xmlElement(
    "window",
    { id: ref.id, class: projectionClass, title: ref.title ?? "" },
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

/** 计算激活环境 —— 描述当前思考栈的状态。 */
function activationEnv(thread: ThreadContext, registry: ObjectInsRegistry): ActivationContext {
  const windowClasses = new Set<string>();
  const methodForms = new Set<string>();
  const activeIntents = new Set<string>();
  for (const w of thread.contextWindows) {
    windowClasses.add(w.class);
    // method_exec_form 窗 → 经 form 对象 data 取目标 guide 信息 + currentIntents
    if (w.class === "_builtin/agent/method_exec_form") {
      const formInst = registry.getObject(w.id);
      const d = formInst?.data as
        | {
            targetObjectId?: string;
            guideName?: string;
            currentIntents?: string[];
          }
        | undefined;
      if (d?.targetObjectId && d?.guideName) {
        // 经 session 表把 targetObjectId 反查目标 class，与 trigger `method::<class>::<guide>` 对齐
        const targetInst = registry.getObject(d.targetObjectId);
        if (targetInst) {
          methodForms.add(`${targetInst.class}::${d.guideName}`);
        }
      }
      // 扫 form 的 currentIntents 合并为 activeIntents——契约层 phase-2 source-key store
      // （core/thinkable/knowledge/source-intents.ts）已退役、本扫窗模型自然 session-scoped
      // 且天然支持 refine→整组替换 currentIntents 数组（无需 store 撤销）。
      if (Array.isArray(d?.currentIntents)) {
        for (const i of d.currentIntents) activeIntents.add(i);
      }
    }
  }
  return {
    windowClasses,
    methodForms,
    activeIntents,
    inSuper: isSuperSessionId(thread.sessionId),
  };
}

function renderKnowledge(activations: ActivationResult[]): XmlNode {
  return xmlElement(
    "knowledge",
    { count: String(activations.length) },
    activations.map((a) =>
      xmlElement(
        "doc",
        { path: a.path, presentation: a.presentation },
        a.presentation === "full"
          ? [xmlText(a.doc.body)]
          : a.doc.frontmatter.description
            ? [xmlText(a.doc.frontmatter.description)]
            : [],
      ),
    ),
  );
}

export interface BuildLlmInputOptions {
  /** world 根目录；提供则启用 knowledge activator。 */
  worldDir?: string;
}

/**
 * 构造本轮 LLM input。
 *
 * - system instructions（静态 prompt）
 * - <knowledge>（按 thread 状态激活的 knowledge docs）
 * - <context_windows>（thread 全部窗的 readable 渲染合一）
 * - <messages>（最近 thread.messages）
 */
export async function buildLlmInput(
  thread: ThreadContext,
  registry: ObjectInsRegistry,
  opts: BuildLlmInputOptions = {},
): Promise<LlmInputItem[]> {
  // knowledge activation（如果有 worldDir）
  let knowledgeXml = "";
  if (opts.worldDir) {
    try {
      const index = await loadKnowledgeIndex(opts.worldDir, thread.calleeObjectId);
      const env = activationEnv(thread, registry);
      const activations = computeActivations(index, env);
      if (activations.length > 0) {
        knowledgeXml = serializeXml(renderKnowledge(activations));
      }
    } catch (e) {
      // 激活失败不阻塞 thinkloop
      console.warn(`[context] knowledge activation failed: ${(e as Error).message}`);
    }
  }

  const windowNodes: XmlNode[] = [];
  for (const ref of thread.contextWindows) {
    windowNodes.push(await renderWindow(ref, registry, thread));
  }
  const contextWindowsXml = serializeXml(xmlElement("context_windows", {}, windowNodes));
  const messagesXml = serializeXml(renderMessages(thread.messages));

  const parts = [systemInstructions(thread)];
  if (knowledgeXml) parts.push(knowledgeXml);
  parts.push(contextWindowsXml, messagesXml);

  return [
    {
      type: "message",
      role: "system",
      content: parts.join("\n\n"),
    },
  ];
}
