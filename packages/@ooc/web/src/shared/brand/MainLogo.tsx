/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * 结构与视觉直接对齐旧 Web 的 MainLogo;接入后端真实 runtime / health 状态。
 *
 * S8 (2026-06-29): world-config / global-pause / debug toggle 全解桩,真接通。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../../transport/http";
import { endpoints } from "../../transport/endpoints";
import { OocLogo } from "./OocLogo";

const PILL_STYLE = "flex items-center gap-2 rounded-lg text-[10px] transition-colors whitespace-nowrap p-0.5 justify-center flex-1";
const REFRESH_MS = 10_000;

function TogglePill({
  active,
  activeColor,
  label,
  busy = false,
  disabled = false,
  onClick,
}: {
  active?: boolean;
  activeColor?: string;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy || !onClick}
      className={`${PILL_STYLE} ${
        active
          ? "text-white font-semibold uppercase tracking-wider shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
          : "bg-[var(--accent)] text-[var(--muted-foreground)] opacity-70"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      style={active && activeColor ? { backgroundColor: activeColor } : undefined}
    >
      <span className={`relative w-5 h-3 rounded-full shrink-0 ${active ? "bg-black/30" : "bg-black/20"}`}>
        <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all ${active ? "left-[10px]" : "left-0.5"}`} />
      </span>
      <span>{busy ? `${label}…` : label}</span>
    </button>
  );
}

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const logoPx = isMobile ? 80 : 120;
  const [online, setOnline] = useState<boolean | null>(null);
  const [globalPaused, setGlobalPaused] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [debugBusy, setDebugBusy] = useState(false);
  // 站名来自 .world.json 的 siteName（GET /api/world/config）；fetch 完成前显示默认值，
  // 避免因网络抖动出现"先空白再蹦出"的闪烁。
  const [siteName, setSiteName] = useState<string>("Oriented Object Context");

  const onlineLabel = useMemo(() => (online === false ? "offline" : "online"), [online]);
  const onlineClassName = useMemo(
    () => `${PILL_STYLE} ${online === false ? "bg-orange-500/15 text-orange-700" : "bg-green-500/20 text-green-600"}`,
    [online],
  );

  // 一次性拉 world config(站名极少变;不进 REFRESH_MS 周期里)。
  useEffect(() => {
    let cancelled = false;
    void requestJson<{ siteName?: string }>(endpoints.worldConfig).then((cfg) => {
      if (cancelled) return;
      if (typeof cfg?.siteName === "string" && cfg.siteName.trim().length > 0) {
        setSiteName(cfg.siteName.trim());
      }
    }).catch(() => {
      // 静默:拿不到就保留默认值
    });
    return () => { cancelled = true; };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      await requestJson<{ ok: boolean }>(endpoints.health);
      const [pause, debug] = await Promise.all([
        requestJson<{ enabled: boolean }>(endpoints.runtimeGlobalPauseStatus),
        requestJson<{ enabled: boolean }>(endpoints.runtimeDebugStatus),
      ]);
      setOnline(true);
      setGlobalPaused(pause.enabled);
      setDebugEnabled(debug.enabled);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const handleToggleGlobalPause = useCallback(async () => {
    setPauseBusy(true);
    try {
      const result = await requestJson<{ enabled: boolean }>(
        globalPaused ? endpoints.runtimeGlobalPauseDisable : endpoints.runtimeGlobalPauseEnable,
        { method: "POST" },
      );
      setGlobalPaused(result.enabled);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setPauseBusy(false);
    }
  }, [globalPaused]);

  const handleToggleDebug = useCallback(async () => {
    setDebugBusy(true);
    try {
      const result = await requestJson<{ enabled: boolean }>(
        debugEnabled ? endpoints.runtimeDebugDisable : endpoints.runtimeDebugEnable,
        { method: "POST" },
      );
      setDebugEnabled(result.enabled);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setDebugBusy(false);
    }
  }, [debugEnabled]);

  const logoColor = useMemo(() => {
    if (globalPaused && debugEnabled) return "gradient";
    if (globalPaused) return "#b56933";
    if (debugEnabled) return "#283baa";
    return "#7f857d";
  }, [debugEnabled, globalPaused]);

  return (
    <div className="flex flex-col items-center w-full">
      <OocLogo px={logoPx} color={logoColor} />

      <h1 className="text-xs tracking-wide text-[var(--muted-foreground)] mt-1" style={{ fontFamily: "monospace" }}>
        {siteName}
      </h1>

      <div className="w-full mt-2">
        <div className="flex items-center gap-1 bg-[var(--accent)] rounded-md p-0.5">
          <TogglePill active={globalPaused} activeColor="#b56933" label="pause" busy={pauseBusy} disabled={online === false} onClick={handleToggleGlobalPause} />
          <TogglePill active={debugEnabled} activeColor="#283baa" label="debug" busy={debugBusy} disabled={online === false} onClick={handleToggleDebug} />
          <div className={onlineClassName}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${online === false ? "bg-orange-500" : "bg-green-500"}`} />
            <span>{onlineLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
