import type { ReactNode } from "react";

export function AppLayout({ sidebar, main, right, children }: { sidebar: ReactNode; main: ReactNode; right: ReactNode; children?: ReactNode }) {
  return <div className="app-shell"><div className="app-layout app-layout-fixed">{sidebar}{main}{right}</div>{children}</div>;
}
