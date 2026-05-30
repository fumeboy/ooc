/**
 * MainLogo — adapted for ooc-3.
 * Global-pause and debug toggles are HARD-tier (Batch 5 deferred).
 * Shows online status via /api/health polling + site name from /api/world/config.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import { OocLogo } from "./OocLogo";

const REFRESH_MS = 10_000;

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const logoPx = isMobile ? 80 : 120;
  const [online, setOnline] = useState<boolean | null>(null);
  const [siteName, setSiteName] = useState<string>("Oriented Object Context");

  const onlineLabel = useMemo(() => (online === false ? "offline" : "online"), [online]);
  const onlineClassName = useMemo(
    () =>
      `flex items-center gap-2 rounded-lg text-[10px] transition-colors whitespace-nowrap p-0.5 justify-center flex-1 ${
        online === false ? "bg-orange-500/15 text-orange-700" : "bg-green-500/20 text-green-600"
      }`,
    [online],
  );

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ siteName: string }>(endpoints.worldConfig)
      .then((cfg) => {
        if (cancelled) return;
        if (typeof cfg?.siteName === "string" && cfg.siteName.trim().length > 0) {
          setSiteName(cfg.siteName.trim());
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      await requestJson<{ ok: boolean }>(endpoints.health);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => { void refreshStatus(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const logoColor = online === false ? "#b56933" : "#7f857d";

  return (
    <div className="flex flex-col items-center w-full">
      <OocLogo px={logoPx} color={logoColor} />
      <h1 className="text-xs tracking-wide text-[var(--muted-foreground)] mt-1" style={{ fontFamily: "monospace" }}>
        {siteName}
      </h1>
      <div className="w-full mt-2">
        <div className="flex items-center gap-1 bg-[var(--accent)] rounded-md p-0.5">
          <div className={onlineClassName}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${online === false ? "bg-orange-500" : "bg-green-500"}`} />
            <span>{onlineLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
