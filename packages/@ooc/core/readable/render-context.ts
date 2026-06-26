/**
 * core/readable/render-context —— 单一渲染入口 `renderReadable`（issue E）。
 *
 * 把"渲染一个窗（OocObjectRef）成 LLM 可见内容"的三档 fallback 收口到一处：
 *
 *   1. `render-fn`   ：class 注册了 `readable.readable` render 函数 → 跑它，取 ReadableProjection.content。
 *   2. `static-card` ：class 未注册 render（如 builtin 的 readable.md 名片场景）→ 读 stone 目录的
 *      `readable.md` 作为静态卡片返回。需调用方提供 stone 目录解析能力（opts.loadStoneReadableMd）；
 *      未提供或读不到 → 落 3。
 *   3. `placeholder` ：以上皆失败 → 返回固定占位文本，附 warning。
 *
 * `<window>` XML 壳由 **调用方**（典型为 thread builtin 的 thinkable/context.ts）自己包——本入口
 * 只出 payload + source 标识。这与 issue 拆 "renderReadable / <window> 壳两层" 的裁决一致。
 *
 * 设计权威：`.ooc-world-meta/.../children/readable/self.md`（核心 5 / 7：投影 3 档 fallback）。
 */
import type { OocObjectRef } from "../runtime/ooc-class.js";
import type {
  ClassRegistry,
  ObjectInsRegistry,
} from "../runtime/object-registry.js";
import type { XmlNode } from "../types/xml.js";
import type { ReadableContext } from "../types/readable.js";
import { xmlText } from "../types/xml.js";
import { makeReadonlySelfProxy } from "../runtime/self-proxy.js";

export type ReadableSource = "render-fn" | "static-card" | "placeholder";

/**
 * 渲染结果 —— 调用方只关心 `payload`（内容）+ `source`（哪档 fallback 命中）。
 *
 * - `payload`：渲染产物。
 *    - render-fn 命中 → 来自 ReadableProjection.content（XmlNode[] 或 string）。
 *    - static-card 命中 → readable.md 文本（string）。
 *    - placeholder → 固定占位 string。
 * - `source`：fallback 档位标识，便于 storybook / observability 区分。
 * - `warning`：placeholder / static-card 路径上可选附加的人读提示。
 * - `projectionClass`：render-fn 路径才有——`ReadableProjection.class`，调用方可拿来填 `<window class=...>`。
 * - `nextWin`：render-fn 路径可选返回的新 win 投影态；调用方负责写回 ref.data（沿用旧 context.ts 行为）。
 */
export interface ReadableResult {
  payload: string | XmlNode[];
  source: ReadableSource;
  warning?: string;
  projectionClass?: string;
  nextWin?: unknown;
}

export interface RenderReadableOpts {
  /**
   * 可选：把 `(classId, objectId) → readable.md` 文本读取的能力注入（异步）。命中 static-card 档需要它。
   * 调用方按其能取到 stone 目录的方式实现（如 fs.readFile 拼 stoneDir）。
   */
  loadStoneReadableMd?: (classId: string, objectId: string) => Promise<string | undefined>;
}

const PLACEHOLDER_PREFIX = "(no readable for class ";

/**
 * 把 ref 渲染成 ReadableResult。
 *
 * 三档 fallback 见文件头注释；调用方自包 `<window>` XML 壳。
 */
export async function renderReadable(
  ref: OocObjectRef,
  registry: ObjectInsRegistry,
  classRegistry: ClassRegistry,
  opts: RenderReadableOpts = {},
): Promise<ReadableResult> {
  // 档 1：class 注册了 render fn
  const render = classRegistry.resolveReadableRender(ref.class);
  if (render) {
    const inst = registry.getObject(ref.id);
    const data = inst?.data ?? {};
    const ctx: ReadableContext = { object: { id: ref.id, class: ref.class } };
    const projection = await render(ctx, makeReadonlySelfProxy(data as object), ref);
    return {
      payload: projection.content,
      source: "render-fn",
      projectionClass: projection.class,
      nextWin: projection.win,
    };
  }

  // 档 2：静态 readable.md 名片
  if (opts.loadStoneReadableMd) {
    try {
      const card = await opts.loadStoneReadableMd(ref.class, ref.id);
      if (card && card.trim().length > 0) {
        return {
          payload: card,
          source: "static-card",
        };
      }
    } catch (_) {
      // fall through to placeholder
    }
  }

  // 档 3：占位
  const placeholder: XmlNode[] = [xmlText(`${PLACEHOLDER_PREFIX}${ref.class})`)];
  return {
    payload: placeholder,
    source: "placeholder",
    warning: `no readable render or readable.md card for class ${ref.class}`,
  };
}
