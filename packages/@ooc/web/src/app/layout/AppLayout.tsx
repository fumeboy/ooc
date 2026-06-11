import type { ReactNode } from "react";
import type { LayoutMode } from "./LayoutModeToggle";

/**
 * AppLayout — 三列布局（sidebar + main + right）；right 缺省时仅渲染左两列，避免空白右栏。
 *
 * `mode = "two-column"` 时强制隐藏 sidebar，main 与 right 各占 50%，让用户专注
 * chat ↔ 主视图。切换由 LayoutModeToggle 触发，状态从 AppShell 透传。
 */
export function AppLayout({
  sidebar,
  main,
  right,
  mode = "three-column",
  sidebarOpen = false,
  onCloseSidebar,
  children,
}: {
  sidebar: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  mode?: LayoutMode;
  /** 窄屏侧栏抽屉是否展开（UI-9）。宽屏由 CSS 忽略，侧栏常驻。 */
  sidebarOpen?: boolean;
  onCloseSidebar?: () => void;
  children?: ReactNode;
}) {
  const showSidebar = mode === "three-column";
  const layoutClass = ["app-layout app-layout-fixed"];
  if (!right) layoutClass.push("app-layout-no-right");
  if (mode === "two-column") layoutClass.push("app-layout-two-col");
  return (
    <div className="app-shell">
      <div className={layoutClass.join(" ")}>
        {showSidebar && (
          <div className={`sidebar-slot${sidebarOpen ? " is-open" : ""}`}>{sidebar}</div>
        )}
        {main}
        {right}
      </div>
      {/* 窄屏抽屉打开时的遮罩——点击关闭。宽屏 CSS display:none。 */}
      {showSidebar && (
        <div
          className={`sidebar-backdrop${sidebarOpen ? " is-open" : ""}`}
          aria-hidden={!sidebarOpen}
          onClick={onCloseSidebar}
        />
      )}
      {children}
    </div>
  );
}
