/**
 * DynamicUI — 统一动态加载自渲染 UI 组件
 *
 * 支持 Stone 级别和 Flow 级别的动态 import：
 * - Stone: @stones/{name}/files/ui/index.tsx
 * - Flow:  @flows/{sid}/flows/{name}/files/ui/index.tsx
 *
 * 使用 Vite define 注入的 __OOC_ROOT__ 构建 /@fs/ 绝对 URL，
 * 绕过 @vite-ignore 导致的路径解析问题。
 *
 * UI 加载失败时自动通知对应对象，让对象可以修复代码。
 *
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import React, { Component, Suspense, useMemo } from "react";
import { talkTo } from "../api/client";

declare const __OOC_ROOT__: string;

/** 将 @stones/@flows 别名路径转换为 Vite /@fs/ 绝对 URL */
function resolveImportPath(aliasPath: string): string {
  if (aliasPath.startsWith("@stones/")) {
    return `/@fs/${__OOC_ROOT__}/stones/${aliasPath.slice("@stones/".length)}`;
  }
  if (aliasPath.startsWith("@flows/")) {
    return `/@fs/${__OOC_ROOT__}/flows/${aliasPath.slice("@flows/".length)}`;
  }
  return aliasPath;
}

/** 从 importPath 中提取 sessionId 和 objectName */
function extractFlowInfo(importPath: string): { sessionId: string; objectName: string } | null {
  const match = importPath.match(/@flows\/([^/]+)\/flows\/([^/]+)/);
  if (match) return { sessionId: match[1]!, objectName: match[2]! };
  return null;
}

/** 通知对象 UI 加载失败 */
function notifyUIError(importPath: string, error: string) {
  const info = extractFlowInfo(importPath);
  if (!info) return;
  const msg = `[系统通知] 你的 UI 组件加载失败，请修复 ui/index.tsx。\n\n错误信息：\n${error}`;
  talkTo(info.objectName, msg, info.sessionId).catch(() => {});
}

/** Error Boundary for dynamic UI */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class UIErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode; importPath: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    notifyUIError(this.props.importPath, error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm">
          <p className="text-red-500 font-medium">自渲染 UI 加载失败</p>
          {this.state.error && (
            <pre className="mt-2 text-xs text-[var(--muted-foreground)] whitespace-pre-wrap bg-[var(--muted)] p-3 rounded-lg overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
          )}
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">已通知对象修复</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 通用动态 UI 加载器
 *
 * @param importPath - 相对于 .ooc/web/src/features/ 的 import 路径
 * @param componentProps - 传给加载到的组件的 props
 * @param fallback - 加载失败时的降级视图（可选）
 */
export function DynamicUI({
  importPath,
  componentProps,
}: {
  importPath: string;
  componentProps: any;
  fallback?: React.ReactNode;
}) {
  const LazyComponent = useMemo(() => {
    const resolved = resolveImportPath(importPath);
    return React.lazy(async () => {
      try {
        const mod = await import(/* @vite-ignore */ resolved);
        return { default: mod.default as React.ComponentType<any> };
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        notifyUIError(importPath, errorMsg);
        return {
          default: () => (
            <div className="p-4 text-sm">
              <p className="text-red-500 font-medium">自渲染 UI 加载失败</p>
              <pre className="mt-2 text-xs text-[var(--muted-foreground)] whitespace-pre-wrap bg-[var(--muted)] p-3 rounded-lg overflow-auto max-h-40">
                {errorMsg}
              </pre>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">已通知对象修复</p>
            </div>
          ),
        };
      }
    });
  }, [importPath]);

  return (
    <UIErrorBoundary fallback={<div />} importPath={importPath}>
      <Suspense
        fallback={
          <div className="p-4 text-sm text-muted-foreground">加载自渲染 UI...</div>
        }
      >
        <LazyComponent {...componentProps} />
      </Suspense>
    </UIErrorBoundary>
  );
}
