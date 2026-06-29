/**
 * resolveWindowDiff — 统一 window diff 渲染解析层（线 C）。
 *
 * 对称线 A 的 resolveWindowVisible.tsx。
 * 按 window 快照解析到所属 class/object 自己的 diff 组件渲染：
 *   builtin 走静态注册表（BUILTIN_DIFF），user-defined type 先尝试动态加载
 *   visible/diff.tsx（dynamic-diff），不存在则回退 before-after 并列视图
 *   （各自调用 WindowVisible），无 type 则 JSON 兜底。
 *
 * 解析顺序（MVP 四档，含档 2 user 自有 diff.tsx）：
 *  1. type 来自 current?.class ?? previous?.class；无 → json。
 *  2. BUILTIN_DIFF[type] 命中 → static。
 *  3. 否则（user-defined type）→ dynamic-diff（objectId=type）：
 *     a. 尝试动态加载 visible/diff.tsx（clientSourceUrl ?file=diff）。
 *     b. 404 / 加载失败 → 回退 before-after（并列两个 WindowVisible）。
 *  4. 无 type → json。
 */
import {
  Component,
  Suspense,
  lazy,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ContextWindow } from "../../../files/context-snapshot";
import type { WindowDiffProps } from "./window-diff-props";
import { BUILTIN_DIFF } from "./builtin-diff-registry";
import { WindowVisible } from "../../../files/components/visible/resolveWindowVisible";
import { FallbackJsonDiff } from "../window-diff-renderers/FallbackJsonDiff";
import { endpoints } from "../../../../transport/endpoints";
import { requestJson } from "../../../../transport/http";

export type WindowDiffKind =
  | { kind: "static"; key: string }
  | { kind: "dynamic-diff"; objectId: string }
  | { kind: "json" };

/**
 * 纯函数：决定一个 window diff 的渲染策略（静态 / dynamic-diff / JSON）。
 */
export function resolveWindowDiffKind(props: WindowDiffProps): WindowDiffKind {
  const type =
    (props.current as { class?: string } | undefined)?.class ??
    (props.previous as { class?: string } | undefined)?.class;
  if (!type) return { kind: "json" };
  if (BUILTIN_DIFF[type]) return { kind: "static", key: type };
  return { kind: "dynamic-diff", objectId: type };
}

/**
 * before-after 档适配壳（也用作 dynamic-diff 的 fallback）。
 * WindowVisible.jsonFallback 签名：ComponentType<{ window: ContextWindow }>。
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
 * BeforeAfterDiff — user-defined type 的 before-after 并列视图。
 * 作为 dynamic-diff 的 Fallback，也是直接渲染降级路径。
 */
function BeforeAfterDiff({
  previous,
  current,
  sessionId,
}: WindowDiffProps & { sessionId?: string }) {
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

type DiffComp = ComponentType<WindowDiffProps & { sessionId?: string }>;

const dynamicDiffCache = new Map<string, DiffComp>();

/**
 * 动态加载 user-defined object 自己的 visible/diff.tsx。
 * notFound（无 diff.tsx，后端 404）或加载失败 → 回退到 Fallback（before-after）。
 */
function loadDynamicDiff(
  objectId: string,
  sessionId: string | undefined,
  Fallback: DiffComp,
): DiffComp {
  const cacheKey = `stone:${objectId}:${sessionId ?? ""}:diff`;
  let comp = dynamicDiffCache.get(cacheKey);
  if (!comp) {
    comp = lazy<DiffComp>(async () => {
      const url = endpoints.clientSourceUrl("stone", objectId, { sessionId, file: "diff" });
      try {
        const { fsUrl } = await requestJson<{ absPath: string; fsUrl: string }>(url);
        const mod = (await import(/* @vite-ignore */ fsUrl)) as { default?: ComponentType<WindowDiffProps> };
        if (!mod.default) return { default: Fallback };
        // Narrow: mod.default is ComponentType<WindowDiffProps>; wrap to accept sessionId too
        const Loaded = mod.default;
        const Wrapped: DiffComp = ({ previous, current }) => <Loaded previous={previous} current={current} />;
        return { default: Wrapped };
      } catch (e) {
        // 404（无 diff.tsx）= 预期回退；其它错误也走 fallback，仅 warn 供排查。
        const msg = e instanceof Error ? e.message : String(e);
        if (!/not\s*found|404/i.test(msg)) {
          console.warn("[resolveWindowDiff] dynamic diff load failed:", msg);
        }
        return { default: Fallback };
      }
    });
    dynamicDiffCache.set(cacheKey, comp);
  }
  return comp;
}

interface DiffErrorBoundaryState {
  hasError: boolean;
}

/** 动态 diff 渲染时抛错 → 回退 fallback（不白屏）。 */
class WindowDiffErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  DiffErrorBoundaryState
> {
  state: DiffErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(): DiffErrorBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[resolveWindowDiff] render error:", error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * WindowDiff — 渲染入口。按 resolveWindowDiffKind 分发：
 * - static → builtin diff 组件直渲。
 * - dynamic-diff → 动态加载 object 自己的 visible/diff.tsx；notFound / 加载失败回退 before-after。
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

  if (r.kind === "dynamic-diff") {
    const FallbackComponent: DiffComp = ({ previous: p, current: c, sessionId: sid }) => (
      <BeforeAfterDiff previous={p} current={c} sessionId={sid} />
    );
    const C = loadDynamicDiff(r.objectId, sessionId, FallbackComponent);
    return (
      <WindowDiffErrorBoundary
        fallback={<BeforeAfterDiff previous={previous} current={current} sessionId={sessionId} />}
      >
        <Suspense fallback={<div className="llm-input-empty">加载 diff…</div>}>
          <C previous={previous} current={current} sessionId={sessionId} />
        </Suspense>
      </WindowDiffErrorBoundary>
    );
  }

  // json 档：显式传全 4 个必需 prop
  const type =
    (current as { class?: string } | undefined)?.class ??
    (previous as { class?: string } | undefined)?.class ??
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
