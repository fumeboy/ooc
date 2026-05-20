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
import { WORLD_ROOT } from "../../shared/world-root";
import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import { StoneFallback } from "./StoneFallback";

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

function clientAbsPath(target: ClientTarget): string {
  if (target.scope === "stone") {
    return `${WORLD_ROOT}/stones/${target.objectId}/client/index.tsx`;
  }
  return `${WORLD_ROOT}/flows/${target.sessionId}/objects/${target.objectId}/client/pages/${target.page}.tsx`;
}

function fsImportUrl(absPath: string): string {
  return `/@fs${absPath}`;
}

function callMethodFor(target: ClientTarget) {
  return async (method: string, args: object = {}) => {
    const url =
      target.scope === "stone"
        ? endpoints.stoneCallMethod(target.objectId)
        : endpoints.flowCallMethod(target.sessionId, target.objectId);
    const body = JSON.stringify({ method, args });
    const response = await requestJson<{ returnValue: unknown }>(url, {
      method: "POST",
      body,
    });
    return response.returnValue;
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

/**
 * 用 HEAD 请求显式判文件是否存在，避免与"语法错"等其它失败混淆：
 *
 * Vite dev server 对 /@fs/<missing> 与 /@fs/<exists> 都返回 200，但 Content-Type
 * 不同：实际文件是 `text/javascript`（转译后），不存在则返回 SPA fallback HTML
 * （`text/html`）。靠 content-type 判存在与否最稳。
 *
 * 网络层失败按"不存在"处理（开发机断网时 fallback 比红块友好）。
 */
async function fileExists(importUrl: string): Promise<boolean> {
  try {
    const res = await fetch(importUrl, { method: "HEAD" });
    if (res.status === 404) return false;
    const ctype = res.headers.get("content-type") ?? "";
    // text/javascript / application/javascript 算存在；text/html 是 SPA fallback
    return /(?:^|\W)javascript\b/i.test(ctype);
  } catch {
    return false;
  }
}

export function ObjectClientRenderer({
  target,
  extraProps,
}: ObjectClientRendererProps) {
  const absPath = useMemo(() => clientAbsPath(target), [target]);
  const importUrl = useMemo(() => fsImportUrl(absPath), [absPath]);

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
      // 先 HEAD 判 404：避免和语法错 / 转译错混淆。
      const exists = await fileExists(importUrl);
      if (!exists) {
        // Stone scope 不再用空白的 "信息待产出..."; 改用 StoneFallback 拼出
        // self.md / readme.md / knowledge / 入口 名片 (Supervisor 决策)。
        // Flow scope 维持原 NotProducedYet — flow page 语义还不明确, 不在本次范围。
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
      try {
        const mod = (await import(/* @vite-ignore */ importUrl)) as {
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
  }, [importUrl, absPath, target]);

  return (
    <ClientRenderErrorBoundary absPath={absPath}>
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
