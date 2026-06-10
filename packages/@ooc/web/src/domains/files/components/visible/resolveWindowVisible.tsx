/**
 * resolveWindowVisible — 统一 window 视觉渲染解析层（线 A）。
 *
 * thread_context 视图展示任意 window 时，按 window 解析到它所属 class/object 自己的 visible
 * 组件渲染：builtin 走静态注册表（BUILTIN_VISIBLE），user-defined object 走运行时动态加载
 * （client-source-url → /@fs dynamic import）。无 per-type switch、无 HANDLED_WINDOW_TYPES。
 *
 * 解析顺序（Review 修订，M3：object 自己的 visible 优先于继承的 builtin）：
 *  1. BUILTIN_VISIBLE[window.class]（**原始 type 直命中**，不经 effectiveVisibleType）→ 静态 builtin。
 *  2. 否则（user-defined type）→ dynamic：加载该 object 自己的 stone visible（objectId=window.class）。
 *  3. dynamic notFound（该 object 没写 visible）→ fallback BUILTIN_VISIBLE[effectiveVisibleType]（继承链）。
 *  4. 仍无 → JSON 兜底。
 *
 * scope 恒为 stone：OOC object 的 visible 是其身份的一部分，写在 stone scope
 * `stones/<obj>/visible/index.tsx`；session（flow）是 stone 的 lazy worktree 分支，
 * client-source-url 的 stone 分支已用 sessionId 做 worktree 路由（可选）。
 *
 * 设计来源：docs/2026-06-08-line-a-unified-window-visible-render-plan.md（## Review 修订）。
 */
import {
  Component,
  Suspense,
  lazy,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ContextWindow } from "../../context-snapshot";
import { BUILTIN_VISIBLE } from "./builtin-visible-registry";
import { endpoints } from "../../../../transport/endpoints";
import { requestJson } from "../../../../transport/http";
import { usePeerReadme } from "../../../objects";
import { MarkdownContent } from "../../../../shared/ui/MarkdownContent";

export type WindowVisibleKind =
  | { kind: "static"; key: string }
  | { kind: "dynamic"; objectId: string; scope: "stone"; sessionId?: string }
  | { kind: "json" };

/**
 * 纯函数：决定一个 window 的初步渲染策略（静态 / 动态 / JSON）。
 *
 * 用**原始 window.class** 直命中 builtin（不是 effectiveVisibleType），否则继承会抢在 object
 * 自己的 visible 前面（M3）。user-defined type 一律走 dynamic（objectId=type, scope=stone）；
 * 动态加载内部 notFound 时再回退 effectiveVisibleType builtin / JSON。
 */
export function resolveWindowVisibleKind(
  window: ContextWindow,
  sessionId: string | undefined,
): WindowVisibleKind {
  if (BUILTIN_VISIBLE[window.class]) return { kind: "static", key: window.class };
  return { kind: "dynamic", objectId: window.class, scope: "stone", sessionId };
}

type WindowComp = ComponentType<{ window: ContextWindow }>;

const dynamicCache = new Map<string, WindowComp>();

/**
 * 无 visible 时的回退：展示该 object/window 的 **readable 文本**（对外呈现文本，
 * 即该 object 的 readme，经 `/api/stones/<id>/readme` 取）。window 所属 object 的 id
 * = `window.class`（与 resolveWindowVisibleKind 的 dynamic objectId 同源）。
 *
 * - readable 文本存在 → markdown 渲染。
 * - 加载中 → 占位提示。
 * - 无 readable 文本（文件缺失 / 空 / 非 stone id）→ 继续退到 JSON 兜底（jsonFallback）。
 */
function makeReadableFallback(jsonFallback: WindowComp): WindowComp {
  return function ReadableFallback({ window }: { window: ContextWindow }) {
    const { text, isLoading } = usePeerReadme(window.class);
    if (text && text.trim().length > 0) {
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">{window.title}</div>
              <div className="llm-input-detail-meta">readable · {window.class}</div>
            </div>
          </div>
          <div className="llm-input-readable markdown markdown-content">
            <MarkdownContent content={text} />
          </div>
        </div>
      );
    }
    if (isLoading) {
      return <div className="llm-input-empty">加载 readable…</div>;
    }
    const J = jsonFallback;
    return <J window={window} />;
  };
}

/**
 * 动态加载 user-defined object 自己的 stone visible。
 *
 * 内联 ObjectClientRenderer 的 `clientSourceUrl → requestJson → import(fsUrl)` 逻辑
 * （resolveClientSource 是 module-private）。notFound（无 visible 源文件）或加载失败时，
 * 回退到 fallback 组件（继承链 builtin 或 JSON），保证不白屏。
 */
function loadDynamic(
  objectId: string,
  sessionId: string | undefined,
  Fallback: WindowComp,
): WindowComp {
  const cacheKey = `stone:${objectId}:${sessionId ?? ""}`;
  let comp = dynamicCache.get(cacheKey);
  if (!comp) {
    comp = lazy<WindowComp>(async () => {
      const url = endpoints.clientSourceUrl("stone", objectId, { sessionId });
      try {
        const { fsUrl } = await requestJson<{ absPath: string; fsUrl: string }>(url);
        const mod = (await import(/* @vite-ignore */ fsUrl)) as { default?: WindowComp };
        if (!mod.default) return { default: Fallback };
        return { default: mod.default };
      } catch (e) {
        // 404（无 visible 源）= 预期回退；其它错误也走 fallback，仅 warn 供排查。
        const msg = e instanceof Error ? e.message : String(e);
        if (!/not\s*found|404/i.test(msg)) {
          console.warn("[resolveWindowVisible] dynamic visible load failed:", msg);
        }
        return { default: Fallback };
      }
    });
    dynamicCache.set(cacheKey, comp);
  }
  return comp;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** 动态 visible 渲染时抛错 → 回退 fallback（不白屏、不发请求）。 */
class WindowVisibleErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[resolveWindowVisible] render error:", error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * WindowVisible — 渲染入口。按 resolveWindowVisibleKind 分发：
 * - static → builtin 组件直渲。
 * - dynamic → 动态加载 object 自己的 visible；notFound / 加载失败回退到继承链 builtin 或 JSON。
 * - json → JSON 兜底。
 */
export function WindowVisible({
  window,
  jsonFallback,
  sessionId,
}: {
  window: ContextWindow;
  jsonFallback: WindowComp;
  sessionId?: string;
}) {
  const kind = resolveWindowVisibleKind(window, sessionId);

  if (kind.kind === "static") {
    const C = BUILTIN_VISIBLE[kind.key]!;
    return <C window={window} />;
  }

  // 无 visible 时优先回退 readable 文本（对外呈现），readable 也没有再退 JSON。
  const ReadableFallback = makeReadableFallback(jsonFallback);

  if (kind.kind === "json") {
    return <ReadableFallback window={window} />;
  }

  // dynamic：先确定 fallback（继承链 builtin → readable → JSON），再动态加载 object 自己的
  // visible；object 没写 visible（notFound）时落到这个 fallback。
  const inheritedKey = window.effectiveVisibleType;
  const InheritedFallback =
    inheritedKey && inheritedKey !== window.class ? BUILTIN_VISIBLE[inheritedKey] : undefined;
  const Fallback: WindowComp = InheritedFallback ?? ReadableFallback;

  const C = loadDynamic(kind.objectId, kind.sessionId, Fallback);
  return (
    <WindowVisibleErrorBoundary fallback={<Fallback window={window} />}>
      <Suspense fallback={<div className="llm-input-empty">加载 visible…</div>}>
        <C window={window} />
      </Suspense>
    </WindowVisibleErrorBoundary>
  );
}
