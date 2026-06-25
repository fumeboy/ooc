/**
 * thread thinkable / context 构造 —— 把 thread 状态转成 LLM input items。
 *
 * 输入：thread (data) + ObjectInsRegistry (查每个窗的 readable.render) + 可选 worldDir + ownerId
 * 输出：LlmInputItem[]（system instructions + activated knowledge + context windows + messages）
 *
 * 设计：每个 OocObjectRef 在 thread.contextWindows 里 = 一个 window；经其 class 的 readable.render
 * 投影成 ReadableProjection（class + content），渲染成 XML 文本进 LLM input。
 *
 * knowledge activation：根据当前 contextWindows 的 class 集合计算 ActivationContext，
 * 经 knowledge_base loader 拿 owner 的 KnowledgeIndex，computeActivations 输出激活列表，
 * 按 presentation (full/summary) 嵌入 system message。
 */
import type { LlmInputItem } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ReadableContext, XmlNode } from "@ooc/core/types/index.js";
import { xmlElement, xmlText, serializeXml } from "@ooc/core/types/xml.js";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import { isSuperSessionId } from "@ooc/core/types/constants.js";
import {
  type ActivationContext,
  computeActivations,
} from "@ooc/core/thinkable/knowledge/index.js";
import type { ActivationResult } from "@ooc/core/types/knowledge.js";
import { loadKnowledgeIndex } from "@ooc/builtins/knowledge_base/loader.js";
import type { ThreadContext, ThreadMessage } from "../types.js";

/** 把一个 window 渲染成 XML 节点（经其 class 的 readable.render 投影）。 */
async function renderWindow(
  ref: OocObjectRef,
  registry: ObjectInsRegistry,
): Promise<XmlNode> {
  const render = registry.resolveReadableRender(ref.class);
  if (!render) {
    return xmlElement("window", { id: ref.id, class: ref.class }, [
      xmlText(`(no readable for class ${ref.class})`),
    ]);
  }
  const inst = registry.getObject(ref.id);
  const data = inst?.data ?? {};
  const ctx: ReadableContext = { object: { id: ref.id, class: ref.class } };
  const projection = await render(ctx, makeReadonlySelfProxy(data as object), ref);
  const content = Array.isArray(projection.content)
    ? projection.content
    : [xmlText(projection.content)];
  if (projection.win !== undefined) ref.data = projection.win;
  return xmlElement(
    "window",
    { id: ref.id, class: projection.class, title: ref.title ?? "" },
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
      // phase-1 简化的 source-key 模型：所有 form 的 currentIntents 合并为 activeIntents
      // （phase-2 改读 source-intents store + 按 sourceKey 撤销）
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
    windowNodes.push(await renderWindow(ref, registry));
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
