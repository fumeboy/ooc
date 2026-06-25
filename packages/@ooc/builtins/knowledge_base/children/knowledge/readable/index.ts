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
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  mergeViewport,
  type Viewport,
} from "./viewport.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/types/xml.js";

import type { Data } from "../types.js";
import { OocObjectRef } from "@src/runtime/ooc-class.js";

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
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  exec: (_ctx: ReadableContext, _self: ReadonlySelfProxy<Data>, before: KnowledgeWin, args: Record<string, unknown>) => {
    const merged = mergeViewport(before?.viewport ?? DEFAULT_VIEWPORT, args);
    if (!merged.ok) throw new Error(`[knowledge.set_viewport] ${merged.error}`);
    return { viewport: merged.viewport };
  },
};

const readable: ReadableModule<Data, KnowledgeWin> = {
  readable: async (ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<KnowledgeWin>) => {
    const children: XmlNode[] = [xmlElement("path", {}, [xmlText(self.data.path)])];
    // TOOD

    return { class: "knowledge", content: children };
  },
  window: [
    {
      class: "knowledge",
      object_methods: [],
      window_methods: [setViewportMethod],
    },
  ],
};

export default readable;
