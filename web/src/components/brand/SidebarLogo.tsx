/**
 * SidebarLogo — compact logo + online pill for ooc-3 sidebar.
 * Adapted from ooc-2 MainLogo; uses ooc-3 /api/health endpoint.
 */
import { useEffect, useState } from "react";
import { OocLogo } from "./OocLogo";

export function SidebarLogo() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/health");
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 12_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return (
    <div className="flex flex-col items-center w-full gap-2">
      <OocLogo px={64} color="#7f857d" />
      <h1 className="text-xs tracking-wide text-[var(--muted-foreground)] text-center" style={{ fontFamily: "monospace" }}>
        OOC-3
      </h1>
      <div className={`status-pill ${online === false ? "" : "online"}`} style={{ fontSize: 10 }}>
        {online === false ? "offline" : online === null ? "…" : "online"}
      </div>
    </div>
  );
}
