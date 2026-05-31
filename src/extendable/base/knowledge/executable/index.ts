/**
 * base/knowledge/executable — knowledge 原型的 behavior 真源（OOC-4 L4.2c）。
 *
 * methods（reload/close/set_viewport）+ renderXml + onClose 的**实现**住这里
 * （物理 move 自 windows/knowledge/index.ts），由活路径沿 base 原型链解析
 * （src/executable/windows/_shared/behavior.ts）。
 *
 * onClose（拒绝 close 非 explicit 来源）是 L4 排除项、仍 registry-served：
 * windows/knowledge/index.ts 薄壳 import 本文件的 onCloseKnowledgeWindow 注册回 registry。
 *
 * knowledge 无 basicKnowledge（method-level knowledge 由各 entry.knowledge() 派生）。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import type {
  MethodKnowledgeEntries,
  MethodEntry,
} from "../../../../executable/windows/_shared/method-types.js";
import type {
  OnCloseContext,
  RenderContext,
} from "../../../../executable/windows/_shared/registry.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  executeWindowSetViewport,
  hasAnyViewportField,
  type Viewport,
} from "../../../../executable/windows/_shared/viewport.js";
import {
  xmlElement,
  xmlText,
  truncateBytes,
  type XmlNode,
} from "../../../../thinkable/context/xml.js";
import type { KnowledgeWindow } from "../../../../executable/windows/knowledge/types.js";
import { deriveStoneFromThread } from "../../../../persistable/common.js";
import { derivePoolFromThread } from "../../../../persistable/pool-object.js";
import { loadKnowledgeIndex } from "../../../../thinkable/knowledge/index.js";

const MAX_KNOWLEDGE_BYTES = 8192;

const KNOWLEDGE_WINDOW_RELOAD_BASIC = "internal/windows/knowledge/reload/basic";
const KNOWLEDGE_WINDOW_CLOSE_BASIC = "internal/windows/knowledge/close/basic";
const KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC = "internal/windows/knowledge/set_viewport/basic";
const KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT = "internal/windows/knowledge/set_viewport/input";

const RELOAD_KNOWLEDGE = `
knowledge_window.reload 强制下一轮重新计算激活集合。当前 loader 已按 mtime 自动失效缓存，
本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
knowledge_window.close 释放 window；不影响 knowledge 文件本身。

注意：source=protocol / source=activator 的 knowledge_window 是系统每轮自动合成的，
不存在于 thread.contextWindows 持久状态——LLM 也无法 close 它们（hook 会拒绝）。
仅 source=explicit（来自 open_knowledge）的 window 可被 close。
`.trim();

const SET_VIEWPORT_KNOWLEDGE = `
knowledge_window.set_viewport 精细化调整渲染窗口（行+列）。

打开 explicit knowledge_window 时默认 viewport = { line_start: 0, line_end: 200, column_start: 0, column_end: 200 }。
对大多数短 markdown 知识等价"全文显示"；超长知识需要扩窗时显式 set_viewport。

参数（**全部可选**，未传字段保留当前值）：
- line_start / line_end / column_start / column_end

约束：非负整数；line_start <= line_end；column_start <= column_end。

渲染：超 line_end 标 \`…(+N more lines)\`；行长 > column_end 标 \`…(+N more)\`。

注意：viewport 仅对 source=explicit 的 knowledge_window 有效；
protocol / activator / relation 来源的 knowledge_window 由系统按 description / full / summary 决定展示形态。
`.trim();

export const reloadCommand: MethodEntry = {
  paths: ["reload"],
  match: () => ["reload"],
  knowledge: (): MethodKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE }),
  exec: () => undefined,
};

export const closeCommand: MethodEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): MethodKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

export const setViewportCommand: MethodEntry = {
  paths: ["set_viewport"],
  match: () => ["set_viewport"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = {
      [KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC]: SET_VIEWPORT_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyViewportField(args)) {
      entries[KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT] =
        "set_viewport 至少需要传入 line_start / line_end / column_start / column_end 之一。\n" +
        "未传字段保留当前值。请 refine 补齐后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeWindowSetViewport(ctx, "knowledge"),
};

/** 拒绝 close 非 explicit 来源的 knowledge_window（合成 window 不可关闭）。 */
export function onCloseKnowledgeWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "knowledge") return;
  // 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
  if (w.source && w.source !== "explicit") {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] knowledge_window "${w.path}" 来自 ${w.source}，由系统每轮合成，不可显式关闭。`,
    });
    return false;
  }
}

/**
 * knowledge_window 的 renderXml hook：path + 正文。
 *
 * 多 source 处理：
 * - source=protocol  : window.body 必填，直接渲染
 * - source=activator : presentation=full 时 window.body 含正文；summary 仅 description
 * - source=explicit  : window.body 通常为空 → 回退到 loader 拉取（兼容旧 thread.json）
 */
export async function renderKnowledgeWindow(ctx: RenderContext): Promise<XmlNode[]> {
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
  // viewport 仅对 explicit 来源生效；其它来源（protocol/activator/relation）由系统决定 presentation
  const useViewport = window.source === "explicit" || !window.source;
  const viewport: Viewport | undefined = useViewport
    ? window.viewport ?? DEFAULT_VIEWPORT
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
  // body 已合成时直接用；否则（explicit 或旧数据）回退 loader
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

export const window: ObjectWindowDefinition = {
  methods: {
    reload: reloadCommand,
    close: closeCommand,
    set_viewport: setViewportCommand,
  },
  renderXml: renderKnowledgeWindow,
};
