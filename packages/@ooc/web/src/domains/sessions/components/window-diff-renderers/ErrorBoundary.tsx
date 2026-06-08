/**
 * DiffRendererErrorBoundary — 包住单个 window diff renderer。
 *
 * 设计原则（design § 3.4 + silent-swallow ban）：
 *   - renderer 抛错 → catch；console.warn 显式（含 windowType / windowId / message）
 *   - 渲染 FallbackJsonDiff 兜底（user 不会看到白屏；JSON 视图保留）
 *   - 不静默：UI 显示一行 "diff renderer error: <msg> — showing JSON fallback"
 *
 * 实现采用 React.Component class 形式（hook 还不能 catch render-phase 错误）。
 */

import React, { type ReactNode } from "react";
import { FallbackJsonDiff } from "./FallbackJsonDiff";
import type { WindowDiffRendererProps } from "./types";

interface ErrorBoundaryProps extends WindowDiffRendererProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string | undefined;
}

export class DiffRendererErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown): void {
    // silent-swallow ban: 显式 warn 含上下文
    console.warn(
      `[DiffRenderer:${this.props.windowType}] window=${this.props.windowId} renderer failed:`,
      error,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="window-diff-renderer-error"
          data-testid={`window-diff-renderer-error-${this.props.windowId}`}
        >
          <div
            className="error"
            role="alert"
            style={{
              border: "1px solid #fca5a5",
              padding: "6px 8px",
              borderRadius: 4,
              marginBottom: 6,
              fontSize: 12,
              background: "rgba(254, 226, 226, .35)",
            }}
          >
            diff renderer (<code>{this.props.windowType}</code>) error:{" "}
            {this.state.message ?? "unknown"} — showing JSON tree fallback.
          </div>
          <FallbackJsonDiff
            previous={this.props.previous}
            current={this.props.current}
            windowType={this.props.windowType}
            windowId={this.props.windowId}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
