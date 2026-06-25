/**
 * thread thinkable / context 构造 —— 把 thread 状态转成 LLM input items。
 *
 * 输入：thread (data) + ObjectInsRegistry (查每个窗的 readable.render)
 * 输出：LlmInputItem[]（system instructions + 渲染好的 context windows + 最近 messages + events 转化）
 *
 * 设计：每个 OocObjectRef 在 thread.contextWindows 里 = 一个 window；经其 class 的 readable.render
 * 投影成 ReadableProjection（class + content），渲染成 XML 文本进 LLM input。
 */
import type { LlmInputItem } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ReadableContext, XmlNode } from "@ooc/core/types/index.js";
import { xmlElement, xmlText, serializeXml } from "@ooc/core/types/xml.js";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
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
  // win 投影态如返回了，写回 ref.data（caller 持久化此 thread blob 时一并落盘）
  if (projection.win !== undefined) ref.data = projection.win;
  return xmlElement(
    "window",
    { id: ref.id, class: projection.class, title: ref.title ?? "" },
    content,
  );
}

/** 渲染 thread 自身的 messages（最近一段）。 */
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

/** thread 系统 prompt（最小：身份 + tool 原语提示）。 */
function systemInstructions(thread: ThreadContext): string {
  return [
    `You are an OOC agent thread (id=${thread.id}, owner=${thread.calleeObjectId}).`,
    `Your world is a set of context windows; each window is an object you can inspect or operate on.`,
    `Use the tool primitives: exec (call a method on a window), close (remove a window), wait (suspend on a window for new input).`,
    `Always emit one tool call per turn unless you have nothing useful to do.`,
  ].join("\n");
}

/**
 * 构造本轮 LLM input。
 *
 * - system instructions（静态 prompt）
 * - <context_windows>（thread 全部窗的 readable 渲染合一）
 * - <messages>（最近 thread.messages）
 */
export async function buildLlmInput(
  thread: ThreadContext,
  registry: ObjectInsRegistry,
): Promise<LlmInputItem[]> {
  const windowNodes: XmlNode[] = [];
  for (const ref of thread.contextWindows) {
    windowNodes.push(await renderWindow(ref, registry));
  }
  const contextWindowsXml = serializeXml(xmlElement("context_windows", {}, windowNodes));
  const messagesXml = serializeXml(renderMessages(thread.messages));

  return [
    {
      type: "message",
      role: "system",
      content: `${systemInstructions(thread)}\n\n${contextWindowsXml}\n\n${messagesXml}`,
    },
  ];
}
