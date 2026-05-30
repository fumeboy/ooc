/**
 * ObjectClientRenderer — dynamically loads an Object's custom React UI component.
 *
 * ooc-3 adaptation:
 * - Uses GET /api/objects/:scope/:name/client-source-url to resolve the /@fs/ URL
 * - Falls back to StoneFallback when client file not found (404)
 * - Dynamic import via vite /@fs/ URL
 *
 * If dynamic loading is too complex for the environment, the fallback
 * (StoneFallback / "not produced yet") is always available.
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

export type ClientTarget =
  | { scope: "stone"; objectId: string }
  | { scope: "flow"; sessionId: string; objectId: string; page: string };

export interface ObjectClientRendererProps {
  target: ClientTarget;
  extraProps?: Record<string, unknown>;
}

export interface ClientComponentProps {
  sessionId?: string;
  objectName?: string;
  callMethod?: (method: string, args?: object) => Promise<unknown>;
  [key: string]: unknown;
}

interface ClientSourceResolution {
  absPath: string;
  fsUrl: string;
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
    const res = await requestJson<{ absPath?: string; url?: string; fsUrl?: string }>(url);
    // ooc-3 returns { ok, url } where url is the /@fs/ path
    const fsUrl = res.fsUrl ?? res.url ?? "";
    const absPath = res.absPath ?? fsUrl;
    if (!fsUrl) return { absPath: "", fsUrl: "", notFound: true };
    return { absPath, fsUrl, notFound: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/not\s*found|404/i.test(msg)) {
      // eslint-disable-next-line no-console
      console.warn("[ObjectClientRenderer] resolveClientSource failed:", msg);
    }
    return { absPath: "", fsUrl: "", notFound: true };
  }
}

function callMethodFor(target: ClientTarget) {
  return async (method: string, args: object = {}) => {
    const url =
      target.scope === "stone"
        ? endpoints.stoneCallMethod("main", target.objectId)
        : endpoints.flowCallMethod(target.sessionId, target.objectId);
    const response = await requestJson<{ result: unknown }>(url, {
      method: "POST",
      body: JSON.stringify({ method, args }),
    });
    return response.result;
  };
}

function NotProducedYet() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 200 }}>
      <p className="muted small">信息待产出...</p>
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
    <div style={{ padding: 16, fontSize: 13 }}>
      <p style={{ color: "var(--error, red)", fontWeight: 500 }}>
        Object client {kind === "load" ? "load" : "render"} failed
      </p>
      <pre style={{ marginTop: 8, fontSize: 11, whiteSpace: "pre-wrap", background: "var(--muted)", padding: 12, borderRadius: 8, overflow: "auto", maxHeight: 240 }}>
        {message}
      </pre>
      <p style={{ marginTop: 8, fontSize: 11, color: "var(--muted-foreground)" }}>
        Path: <code>{absPath}</code>
      </p>
    </div>
  );
}

interface ErrorBoundaryState { hasError: boolean; error?: Error }

class ClientRenderErrorBoundary extends Component<
  { children: ReactNode; absPath: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
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

export function ObjectClientRenderer({ target, extraProps }: ObjectClientRendererProps) {
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
      const resolution = await resolveClientSource(target);
      if (resolution.notFound) {
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
                loadError={{ message: "Module has no default export.", absPath }}
              />
            );
            return { default: Fallback };
          }
          const Fallback: ComponentType<ClientComponentProps> = () => (
            <LoadErrorBox message="Module has no default export." absPath={absPath} kind="load" />
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
          <div style={{ padding: 16, fontSize: 13, color: "var(--muted-foreground)" }}>
            Loading Object client…
          </div>
        }
      >
        <LazyComponent {...componentProps} />
      </Suspense>
    </ClientRenderErrorBoundary>
  );
}
