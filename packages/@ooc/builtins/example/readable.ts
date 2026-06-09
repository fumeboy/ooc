/**
 * example —— readable 维度（标准对象定义样板的另一半）。
 *
 * 本文件拥有并**自注册**整个 readable 维度，经 registry 的 `registerReadable` 入口：
 * - `readable`：把 example_window 渲染进 LLM context（业务数据 message 经 viewport 切片）。
 * - window method `set_viewport`：控制展示视口（写 state.viewport，不碰业务数据）。
 * - `compressView`：折叠/快照态渲染。
 *
 * 这三者都属于 readable 维度——与 executable 维度（object method / constructor，在
 * `executable/index.ts`）物理分离、分注册。`executable/index.ts` side-effect import 本文件触发注册。
 */

import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  windowSetViewport,
  type Viewport,
} from "@ooc/core/extendable/_shared/viewport.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";
import {
  xmlElement,
  xmlText,
  truncateBytes,
  type XmlNode,
} from "@ooc/core/thinkable/context/xml.js";
import type { ExampleWindow } from "./types.js";

const MAX_EXAMPLE_BYTES = 8192;

/** readable hook：渲染 bumpCount + viewport 切片后的 message。 */
export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as ExampleWindow;
  const viewport: Viewport = window.state?.viewport ?? DEFAULT_VIEWPORT;
  const body = applyViewport(window.message ?? "", viewport);
  return [
    xmlElement("bump_count", {}, [xmlText(String(window.bumpCount ?? 0))]),
    xmlElement("message", {}, [xmlText(truncateBytes(body, MAX_EXAMPLE_BYTES))]),
  ];
}

/** window method：调整展示视口（写 state.viewport）。复用通用 windowSetViewport 执行体。 */
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
  exec: (ctx) => windowSetViewport(ctx, "example"),
};

/** compressView hook：折叠/快照态只留元信息。 */
function compressExampleWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as ExampleWindow;
  return [
    xmlElement("example", { bump_count: String(window.bumpCount ?? 0) }),
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  ];
}

builtinRegistry.registerReadable("example", {
  readable,
  windowMethods: {
    set_viewport: setViewportMethod,
  },
  compressView: compressExampleWindow,
});
