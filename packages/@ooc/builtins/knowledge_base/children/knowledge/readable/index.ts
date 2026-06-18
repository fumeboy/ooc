/**
 * knowledge —— readable 维度（把 Data 投影成 context window + window method）。
 *
 * - readable：把 knowledge Data 投影成 window —— path + source + 正文（按 viewport 切片 + 截断）。
 *   多 source 处理：
 *     - protocol  : Data.body 必填，直接渲染
 *     - activator : presentation=full 时 Data.body 含正文；summary 仅 description
 *     - explicit  : Data.body 通常为空 → 回退到 loader 拉取（兼容旧持久化）
 * - window method `set_viewport`：只调投影态 `win`（viewport），不碰 Data、不产副作用。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  WindowMethod,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  mergeViewport,
  type Viewport,
} from "@ooc/core/_shared/utils/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
import type { Data } from "../types.js";

const MAX_KNOWLEDGE_BYTES = 8192;

/** knowledge 的**投影态**（与 Data 分离）：行/列 viewport（仅 explicit 来源使用）。 */
export interface KnowledgeWin {
  viewport: Viewport;
}

/** window method：调整展示视口（返回新 win；不碰 Data）。 */
const setViewportMethod: WindowMethod<Data, KnowledgeWin> = {
  name: "set_viewport",
  description: "Adjust the viewport (line/column range) rendered for this knowledge window.",
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: KnowledgeWin, args: Record<string, unknown>) => {
    const merged = mergeViewport(before?.viewport ?? DEFAULT_VIEWPORT, args);
    if (!merged.ok) throw new Error(`[knowledge.set_viewport] ${merged.error}`);
    return { viewport: merged.viewport };
  },
};

const readable: ReadableModule<Data, KnowledgeWin> = {
  readable: async (ctx: ReadableContext, self: Data, win: KnowledgeWin) => {
    const children: XmlNode[] = [xmlElement("path", {}, [xmlText(self.path)])];
    if (self.source) {
      children.push(xmlElement("source", {}, [xmlText(self.source)]));
    }
    if (self.presentation) {
      children.push(xmlElement("presentation", {}, [xmlText(self.presentation)]));
    }
    if (self.description) {
      children.push(xmlElement("description", {}, [xmlText(self.description)]));
    }
    const useViewport = self.source === "explicit" || !self.source;
    const viewport: Viewport | undefined = useViewport
      ? win?.viewport ?? DEFAULT_VIEWPORT
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
    if (typeof self.body === "string" && self.body.length > 0) {
      children.push(xmlElement("content", {}, [xmlText(renderBody(self.body))]));
      return { class: "knowledge", content: children };
    }
    if (self.presentation === "summary") {
      return { class: "knowledge", content: children };
    }
    const persistence = ctx.thread?.persistence;
    if (!persistence) {
      children.push(xmlElement("error", {}, [xmlText("thread 无 persistence ref")]));
      return { class: "knowledge", content: children };
    }
    try {
      const stoneRef = deriveStoneFromThread(persistence);
      const poolRef = derivePoolFromThread(persistence);
      const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
      const doc = index.byPath.get(self.path);
      if (!doc) {
        children.push(xmlElement("error", {}, [xmlText(`knowledge "${self.path}" 不存在`)]));
      } else {
        if (doc.frontmatter.description && !self.description) {
          children.push(xmlElement("description", {}, [xmlText(doc.frontmatter.description)]));
        }
        children.push(xmlElement("content", {}, [xmlText(renderBody(doc.body))]));
      }
    } catch (error) {
      children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
    }
    return { class: "knowledge", content: children };
  },
  window: [
    {
      class: "knowledge",
      object_methods: ["reload", "close"],
      window_methods: [setViewportMethod],
    },
  ],
};

export default readable;
