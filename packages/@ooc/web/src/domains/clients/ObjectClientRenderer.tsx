/**
 * ObjectClientRenderer — 动态加载 Object 自写的 React UI 组件。
 *
 * 契约见 meta/object/executable/client/index.doc.js：
 * - Stone：<dir>/client/index.tsx（单页入口）
 * - Flow ：<dir>/client/pages/{page}.tsx（多页）
 * - 组件 default export，props {{ sessionId?, objectName?, callMethod? }}
 *
 * 失败处理（plan §3 末尾决策）：
 * - 404 / Failed to fetch → "信息待产出..."
 * - 其它加载错       → 红色块带堆栈与文件绝对路径
 * - 渲染时抛错       → ErrorBoundary 红色块，仅 console.error，**不发任何请求**
 *
 * 不耦合 transport / talk —— 用户看到错误后自行决定是否转发给 Object。
 */
import {
  Component,
  type ComponentType,
  type ReactNode,
  Suspense,
  lazy,
  useMemo,
} from "react";
import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import { StoneFallback } from "./StoneFallback";

/**
 * 根因 #3 (2026-05-24)：frontend 不再硬编码 `${WORLD_ROOT}/stones/${id}/client/index.tsx`。
 * 走 backend `/api/objects/:scope/:objectId/client-source-url` 拿权威 absPath + fsUrl。
 *
 * 旧实现见 git history（依赖 WORLD_ROOT + path-prefix 拼接）；2026-05-21 stones
 * 重组（加 `<branch>/objects/`）后硬编码漂移，本次彻底删掉。
 */

/** 调用入口由 scope 决定，避免上游手拼路径。 */
export type ClientTarget =
  | { scope: "stone"; objectId: string }
  | { scope: "flow"; sessionId: string; objectId: string; page: string };

export interface ObjectClientRendererProps {
  target: ClientTarget;
  /** 透传给被加载组件的 props（不含 callMethod —— 由 renderer 自动合成）。 */
  extraProps?: Record<string, unknown>;
}

/** Object client 默认导出组件的 props 契约。 */
export interface ClientComponentProps {
  sessionId?: string;
  objectName?: string;
  callMethod?: (method: string, args?: object) => Promise<unknown>;
  [key: string]: unknown;
}

interface ClientSourceResolution {
  absPath: string;
  fsUrl: string;
  /** true = backend 报 404 (源文件不存在)；让上游走 fallback。 */
  notFound: boolean;
}

async function resolveClientSource(target: ClientTarget): Promise<ClientSourceResolution> {
  const url =
    target.scope === "stone"
      ? endpoints.clientSourceUrl("stone", target.objectId)
      : endpoints.clientSourceUrl("flow", target.objectId, {
          sessionId: target.sessionId,
          page: target.page,
        });
  try {
    const res = await requestJson<{ absPath: string; fsUrl: string }>(url);
    return { absPath: res.absPath, fsUrl: res.fsUrl, notFound: false };
  } catch (e) {
    // 任何错误（404 / 网络）走 fallback；上层用 absPath="" 的占位，notFound=true 触发 StoneFallback/NotProducedYet。
    const msg = e instanceof Error ? e.message : String(e);
    // 仅 NOT_FOUND 是预期失败（无 client 文件，走 fallback）；其它错误 console.warn 供排查。
    if (!/not\s*found|404/i.test(msg)) {
      console.warn("[ObjectClientRenderer] resolveClientSource failed:", msg);
    }
    return { absPath: "", fsUrl: "", notFound: true };
  }
}

function callMethodFor(target: ClientTarget) {
  return async (method: string, args: object = {}) => {
    const url =
      target.scope === "stone"
        ? endpoints.stoneCallMethod(target.objectId)
        : endpoints.flowCallMethod(target.sessionId, target.objectId);
    const body = JSON.stringify({ method, args });
    // 2026-06-11 废 ui_methods 维度后，call_method 响应即标准 MethodOutcome：
    // 结构化数据走 data、消息文本走 result，!ok 抛 error。
    const response = await requestJson<{ ok: boolean; data?: unknown; result?: string; error?: string }>(url, {
      method: "POST",
      body,
    });
    if (!response.ok) throw new Error(response.error ?? `method '${method}' failed`);
    return response.data ?? response.result;
  };
}

function NotProducedYet() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <p className="text-sm text-[var(--muted-foreground)]">信息待产出...</p>
    </div>
  );
}

interface LoadErrorBoxProps {
  message: string;
  absPath: string;
  kind: "load" | "render";
}

function LoadErrorBox({ message, absPath, kind }: LoadErrorBoxProps) {
  return (
    <div className="p-4 text-sm">
      <p className="text-red-500 font-medium">
        Object client {kind === "load" ? "加载" : "渲染"}失败
      </p>
      <pre className="mt-2 text-xs whitespace-pre-wrap bg-[var(--muted)] p-3 rounded-lg overflow-auto max-h-60">
        {message}
      </pre>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        文件路径：<code>{absPath}</code>
      </p>
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ClientRenderErrorBoundary extends Component<
  { children: ReactNode; absPath: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // 显式失败：仅 console.error，不发请求、不投递 talk。
    // plan §3 末尾 D1：渲染层不耦合 transport。
    console.error("[ObjectClientRenderer] render error:", error);
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.stack ?? this.state.error?.message ?? "(unknown)";
      return <LoadErrorBox message={msg} absPath={this.props.absPath} kind="render" />;
    }
    return this.props.children;
  }
}

export function ObjectClientRenderer({
  target,
  extraProps,
}: ObjectClientRendererProps) {
  const componentProps = useMemo<ClientComponentProps>(() => {
    const base: ClientComponentProps = {
      ...extraProps,
      callMethod: callMethodFor(target),
    };
    if (target.scope === "stone") {
      base.objectName = target.objectId;
    } else {
      base.sessionId = target.sessionId;
      base.objectName = target.objectId;
    }
    return base;
  }, [target, extraProps]);

  const LazyComponent = useMemo(() => {
    return lazy<ComponentType<ClientComponentProps>>(async () => {
      // 通过 backend 权威 endpoint 拿 absPath / fsUrl；404 → 走 fallback。
      const resolution = await resolveClientSource(target);
      if (resolution.notFound) {
        // Stone scope 用 StoneFallback 拼名片；flow scope 维持 NotProducedYet。
        if (target.scope === "stone") {
          const objectId = target.objectId;
          const Fallback: ComponentType<ClientComponentProps> = () => (
            <StoneFallback objectId={objectId} />
          );
          return { default: Fallback };
        }
        const Fallback: ComponentType<ClientComponentProps> = () => <NotProducedYet />;
        return { default: Fallback };
      }
      const { absPath, fsUrl } = resolution;
      try {
        const mod = (await import(/* @vite-ignore */ fsUrl)) as {
          default?: ComponentType<ClientComponentProps>;
        };
        if (!mod.default) {
          if (target.scope === "stone") {
            const objectId = target.objectId;
            const Fallback: ComponentType<ClientComponentProps> = () => (
              <StoneFallback
                objectId={objectId}
                loadError={{
                  message:
                    "模块未 default export 任何组件。期望：export default function ...(props) { ... }",
                  absPath,
                }}
              />
            );
            return { default: Fallback };
          }
          const Fallback: ComponentType<ClientComponentProps> = () => (
            <LoadErrorBox
              message="模块未 default export 任何组件。期望：export default function ...(props) { ... }"
              absPath={absPath}
              kind="load"
            />
          );
          return { default: Fallback };
        }
        return { default: mod.default };
      } catch (e) {
        const msg = e instanceof Error ? e.stack ?? e.message : String(e);
        if (target.scope === "stone") {
          const objectId = target.objectId;
          const Fallback: ComponentType<ClientComponentProps> = () => (
            <StoneFallback objectId={objectId} loadError={{ message: msg, absPath }} />
          );
          return { default: Fallback };
        }
        const Fallback: ComponentType<ClientComponentProps> = () => (
          <LoadErrorBox message={msg} absPath={absPath} kind="load" />
        );
        return { default: Fallback };
      }
    });
  }, [target]);

  return (
    <ClientRenderErrorBoundary absPath="">
      <Suspense
        fallback={
          <div className="p-4 text-sm text-[var(--muted-foreground)]">
            加载 Object client...
          </div>
        }
      >
        <LazyComponent {...componentProps} />
      </Suspense>
    </ClientRenderErrorBoundary>
  );
}
