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
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import React, { Component, Suspense, useMemo } from "react";

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

/** Error Boundary for dynamic UI */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class UIErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
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
  fallback,
}: {
  importPath: string;
  componentProps: any;
  fallback?: React.ReactNode;
}) {
  const errorFallback = fallback ?? (
    <div className="p-4 text-sm text-red-500">
      自渲染 UI 加载失败
    </div>
  );

  const LazyComponent = useMemo(() => {
    const resolved = resolveImportPath(importPath);
    return React.lazy(async () => {
      try {
        const mod = await import(/* @vite-ignore */ resolved);
        return { default: mod.default as React.ComponentType<any> };
      } catch {
        return {
          default: () => errorFallback as React.ReactElement,
        };
      }
    });
  }, [importPath]);

  return (
    <UIErrorBoundary fallback={errorFallback}>
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
