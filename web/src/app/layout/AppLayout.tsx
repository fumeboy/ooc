import type { ReactNode } from "react";

export function AppLayout({ sidebar, main, right }: { sidebar: ReactNode; main: ReactNode; right: ReactNode }) {
  return <div className="app-shell"><div className="app-layout">{sidebar}{main}{right}</div></div>;
}

