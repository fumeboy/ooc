/**
 * example —— readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data 投影成 window —— 动态算出 class + content（业务数据 message 经 viewport 切片）。
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
} from "@ooc/core/readable/viewport.js";
import { xmlElement, xmlText, truncateBytes } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

const MAX_EXAMPLE_BYTES = 8192;

/** example 的**投影态**（与 Data 分离）：行/列 viewport。 */
export interface ExampleWin {
  viewport: Viewport;
}

/** window method：调整展示视口（返回新 win；不碰 Data）。 */
const setViewportMethod: WindowMethod<Data, ExampleWin> = {
  name: "set_viewport",
  description: "Adjust the rendered viewport (line/column range) for this example window.",
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: ExampleWin, args: Record<string, unknown>) => {
    const merged = mergeViewport(before?.viewport ?? DEFAULT_VIEWPORT, args);
    if (!merged.ok) throw new Error(`[example.set_viewport] ${merged.error}`);
    return { viewport: merged.viewport };
  },
};

const readable: ReadableModule<Data, ExampleWin> = {
  readable: (_ctx: ReadableContext, self: Data, win: ExampleWin) => {
    const viewport = win?.viewport ?? DEFAULT_VIEWPORT;
    const body = applyViewport(self.message ?? "", viewport);
    return {
      class: "example",
      content: [
        xmlElement("bump_count", {}, [xmlText(String(self.bumpCount ?? 0))]),
        xmlElement("message", {}, [xmlText(truncateBytes(body, MAX_EXAMPLE_BYTES))]),
      ],
    };
  },
  window: [
    {
      class: "example",
      object_methods: ["bump"],
      window_methods: [setViewportMethod],
    },
  ],
};

export default readable;
