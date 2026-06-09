import {
  builtinRegistry,
  type OnCloseContext,
  type RenderContext,
} from "@ooc/core/extendable/_shared/registry.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  windowSetViewport,
  hasAnyViewportField,
  type Viewport,
} from "@ooc/core/extendable/_shared/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import type { KnowledgeWindow } from "./types.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const MAX_KNOWLEDGE_BYTES = 8192;

const KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC = "internal/windows/knowledge/set_viewport/basic";
const KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT = "internal/windows/knowledge/set_viewport/input";

const SET_VIEWPORT_KNOWLEDGE = `
knowledge_object.set_viewport 精细化调整渲染窗口（行+列）。

打开 explicit knowledge_object 时默认 viewport = { line_start: 0, line_end: 200, column_start: 0, column_end: 200 }。
对大多数短 markdown 知识等价"全文显示"；超长知识需要扩窗时显式 set_viewport。

参数（**全部可选**，未传字段保留当前值）：
- line_start / line_end / column_start / column_end

约束：非负整数；line_start <= line_end；column_start <= column_end。

渲染：超 line_end 标 \`…(+N more lines)\`；行长 > column_end 标 \`…(+N more)\`。

注意：viewport 仅对 source=explicit 的 knowledge_object 有效；
protocol / activator / relation 来源的 knowledge_object 由系统按 description / full / summary 决定展示形态。
`.trim();

/**
 * knowledge_object 的 readable hook：path + 正文。
 *
 * 多 source 处理：
 * - source=protocol  : window.body 必填，直接渲染
 * - source=activator : presentation=full 时 window.body 含正文；summary 仅 description
 * - source=explicit  : window.body 通常为空 → 回退到 loader 拉取（兼容旧 thread.json）
 */
export async function readable(ctx: RenderContext): Promise<XmlNode[]> {
  const window = ctx.window as KnowledgeWindow;
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
  const useViewport = window.source === "explicit" || !window.source;
  // 展示状态从 window.state 读，向后兼容旧平铺字段。
  const viewport: Viewport | undefined = useViewport
    ? window.state?.viewport ?? window.viewport ?? DEFAULT_VIEWPORT
    : undefined;
  if (viewport) {
    children.push(
      xmlElement(
        "viewport",
        {
          line_start: String(viewport.lineStart),
          line_end: String(viewport.lineEnd),
          column_start: String(viewport.columnStart),
          column_end: String(viewport.columnEnd),
        },
        [],
      ),
    );
  }
  const renderBody = (raw: string): string => {
    const sliced = viewport ? applyViewport(raw, viewport) : raw;
    return truncateBytes(sliced, MAX_KNOWLEDGE_BYTES);
  };
  if (typeof window.body === "string" && window.body.length > 0) {
    children.push(xmlElement("content", {}, [xmlText(renderBody(window.body))]));
    return children;
  }
  if (window.presentation === "summary") {
    return children;
  }
  if (!ctx.thread.persistence) {
    children.push(xmlElement("error", {}, [xmlText("thread 无 persistence ref")]));
    return children;
  }
  try {
    const stoneRef = deriveStoneFromThread(ctx.thread.persistence);
    const poolRef = derivePoolFromThread(ctx.thread.persistence);
    const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
    const doc = index.byPath.get(window.path);
    if (!doc) {
      children.push(xmlElement("error", {}, [xmlText(`knowledge "${window.path}" 不存在`)]));
    } else {
      if (doc.frontmatter.description && !window.description) {
        children.push(xmlElement("description", {}, [xmlText(doc.frontmatter.description)]));
      }
      children.push(xmlElement("content", {}, [xmlText(renderBody(doc.body))]));
    }
  } catch (error) {
    children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
  }
  return children;
}

const setViewportMethod: WindowMethod = {
  kind: "window",
  paths: ["set_viewport"],
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC]: SET_VIEWPORT_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyViewportField(args)) {
      entries[KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT] =
        "set_viewport 至少需要传入 line_start / line_end / column_start / column_end 之一。\n" +
        "未传字段保留当前值。请 refine 补齐后 submit。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => windowSetViewport(ctx, "knowledge"),
};

/** 拒绝 close 非 explicit 来源的 knowledge_object（合成 window 不可关闭）。 */
function onCloseKnowledgeWindow(ctx: OnCloseContext): boolean | void {
  if (ctx.window.type !== "knowledge") return;
  // batch C narrowing(N1): ctx.window 契约层是 base ContextWindow；type==="knowledge" 守卫后
  // narrow 回 KnowledgeWindow 以读 source/path（runtime 保证此 window 即 knowledge 实例）。
  const w = ctx.window as KnowledgeWindow;
  // 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
  if (w.source && w.source !== "explicit") {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] knowledge_object "${w.path}" 来自 ${w.source}，由系统每轮合成，不可显式关闭。`,
    });
    return false;
  }
}

// readable 维度自注册（readable + window method set_viewport + onClose）。
builtinRegistry.registerReadable("knowledge", {
  windowMethods: {
    set_viewport: setViewportMethod,
  },
  onClose: onCloseKnowledgeWindow,
  readable,
});
