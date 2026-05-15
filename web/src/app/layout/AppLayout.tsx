import type { ReactNode } from "react";

/**
 * AppLayout — 三列布局；right 缺省时仅渲染左两列，避免空白右栏。
 *
 * user.root 之类没有"和谁对话"语义的 thread 走 right=null 路径。
 */
export function AppLayout({ sidebar, main, right, children }: { sidebar: ReactNode; main: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="app-shell">
      <div className={`app-layout app-layout-fixed${right ? "" : " app-layout-no-right"}`}>
        {sidebar}
        {main}
        {right}
      </div>
      {children}
    </div>
  );
}
