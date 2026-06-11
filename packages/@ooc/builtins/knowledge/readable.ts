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
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { KnowledgeWindow } from "./types.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";

const MAX_KNOWLEDGE_BYTES = 8192;

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
  description: "Adjust the viewport (line/column range) rendered for this knowledge window.",
  intents: ["set_viewport"],
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  onFormChange(change, { args }) {
    let tip = "set_viewport 可选 line_start/line_end/column_start/column_end；未传字段保留当前值。";
    if (hasAnyViewportField(args)) {
      tip = "参数已就绪，submit 应用视口调整。";
    }
    return { tip, intents: [{ name: "set_viewport" }], quick_exec_submit: hasAnyViewportField(args) };
  },
  exec: (ctx) => windowSetViewport(ctx, "knowledge"),
};

/** 拒绝 close 非 explicit 来源的 knowledge_object（合成 window 不可关闭）。 */
function onCloseKnowledgeWindow(ctx: OnCloseContext): boolean | void {
  if (ctx.window.class !== "knowledge") return;
  // narrowing: ctx.window 契约层是 base ContextWindow；type==="knowledge" 守卫后
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
