/**
 * resolveWindowDiff — 统一 window diff 渲染解析层（线 C）。
 *
 * 对称线 A 的 resolveWindowVisible.tsx。
 * 按 window 快照解析到所属 class/object 自己的 diff 组件渲染：
 *   builtin 走静态注册表（BUILTIN_DIFF），user-defined type 走 before-after 并列视图
 *   （各自调用 WindowVisible），无 type 则 JSON 兜底。
 *
 * 解析顺序（MVP 三档，档 2 user 自有 diff.tsx 暂不做）：
 *  1. type 来自 current?.type ?? previous?.type；无 → json。
 *  2. BUILTIN_DIFF[type] 命中 → static。
 *  3. 否则（user-defined type）→ before-after（objectId=type）。
 */
import type { ComponentType } from "react";
import type { ContextWindow } from "../../../files/context-snapshot";
import type { WindowDiffProps } from "./window-diff-props";
import { BUILTIN_DIFF } from "./builtin-diff-registry";
import { WindowVisible } from "../../../files/components/visible/resolveWindowVisible";
import { FallbackJsonDiff } from "../window-diff-renderers/FallbackJsonDiff";

export type WindowDiffKind =
  | { kind: "static"; key: string }
  | { kind: "before-after"; objectId: string }
  | { kind: "json" };

/**
 * 纯函数：决定一个 window diff 的渲染策略（静态 / before-after / JSON）。
 */
export function resolveWindowDiffKind(props: WindowDiffProps): WindowDiffKind {
  const type =
    (props.current as { type?: string } | undefined)?.type ??
    (props.previous as { type?: string } | undefined)?.type;
  if (!type) return { kind: "json" };
  if (BUILTIN_DIFF[type]) return { kind: "static", key: type };
  return { kind: "before-after", objectId: type };
}

/**
 * before-after 档的 jsonFallback 适配壳。
 * WindowVisible.jsonFallback 签名：ComponentType<{ window: ContextWindow }>，
 * 即 `({ window }) => JSX`；这里用 JSON 序列化展示裸快照。
 */
const JsonWindowAdapter: ComponentType<{ window: ContextWindow }> = ({
  window,
}: {
  window: ContextWindow;
}) => (
  <pre className="window-diff-json" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
    {JSON.stringify(window, null, 2)}
  </pre>
);

/**
 * WindowDiff — 渲染入口。按 resolveWindowDiffKind 分发：
 * - static → builtin diff 组件直渲。
 * - before-after → 用 WindowVisible 并列渲染 previous + current。
 * - json → FallbackJsonDiff（字段级 diff）。
 */
export function WindowDiff({
  previous,
  current,
  sessionId,
}: WindowDiffProps & { sessionId?: string }) {
  const r = resolveWindowDiffKind({ previous, current });

  if (r.kind === "static") {
    const C = BUILTIN_DIFF[r.key]!;
    return <C previous={previous} current={current} />;
  }

  if (r.kind === "before-after") {
    return (
      <div className="window-diff-before-after" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="before">
          {previous ? (
            <WindowVisible
              window={previous as ContextWindow}
              jsonFallback={JsonWindowAdapter}
              sessionId={sessionId}
            />
          ) : (
            <em className="muted">（新增）</em>
          )}
        </div>
        <div className="after">
          {current ? (
            <WindowVisible
              window={current as ContextWindow}
              jsonFallback={JsonWindowAdapter}
              sessionId={sessionId}
            />
          ) : (
            <em className="muted">（移除）</em>
          )}
        </div>
      </div>
    );
  }

  // json 档：显式传全 4 个必需 prop
  const type =
    (current as { type?: string } | undefined)?.type ??
    (previous as { type?: string } | undefined)?.type ??
    "unknown";
  const id =
    (current as { id?: string } | undefined)?.id ??
    (previous as { id?: string } | undefined)?.id ??
    "";
  return (
    <FallbackJsonDiff
      previous={previous}
      current={current}
      windowType={type}
      windowId={id}
    />
  );
}
