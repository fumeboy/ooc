/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * OocLogo + 三个药丸按钮（debug、pause、online）水平排列在 Logo 标题下方。
 * Logo 颜色随状态变化（带淡入淡出动画）。
 */
import { useAtom } from "jotai";
import { useEffect } from "react";
import { OocLogo } from "./OocLogo";
import { debugEnabledAtom, globalPausedAtom, sseConnectedAtom } from "../store/session";
import { cn } from "../lib/utils";
import {
  enableDebug,
  disableDebug,
  getDebugStatus,
  enableGlobalPause,
  disableGlobalPause,
  getGlobalPauseStatus,
} from "../api/client";

/** 药丸按钮的统一尺寸 */
const PILL_STYLE = "flex items-center gap-2 rounded-lg text-[10px] transition-colors whitespace-nowrap p-0.5 justify-center flex-1";

/** 带 toggle 开关的药丸按钮 */
function TogglePill({
  active,
  activeColor,
  label,
  activeLabel,
  onClick,
}: {
  active: boolean;
  activeColor: string;
  label: string;
  activeLabel: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={active ? activeLabel : label}
      className={cn(
        PILL_STYLE,
        active
          ? "text-white"
          : "bg-[var(--accent)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]/80 opacity-70",
      )}
      style={active ? { backgroundColor: activeColor + "90" } : undefined}
    >
      <span className="relative w-5 h-3 rounded-full bg-black/20 shrink-0">
        <span
          className={cn(
            "absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all",
            active ? "left-[10px]" : "left-0.5",
          )}
        />
      </span>
      <span>{active ? activeLabel : label}</span>
    </button>
  );
}

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const [debugEnabled, setDebugEnabled] = useAtom(debugEnabledAtom);
  const [globalPaused, setGlobalPaused] = useAtom(globalPausedAtom);
  const [sseConnected] = useAtom(sseConnectedAtom);

  useEffect(() => {
    getDebugStatus().then((r) => setDebugEnabled(r.debugEnabled)).catch(() => {});
    getGlobalPauseStatus().then((r) => setGlobalPaused(r.globalPaused)).catch(() => {});
  }, []);

  const logoColor =
    debugEnabled && globalPaused
      ? "gradient"
      : debugEnabled
        ? "#283baa"
        : globalPaused
          ? "#b56933"
          : "#000";

  const logoPx = isMobile ? 80 : 120;

  const toggleDebug = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (debugEnabled) { await disableDebug(); setDebugEnabled(false); }
      else { await enableDebug(); setDebugEnabled(true); }
    } catch {}
  };

  const toggleGlobalPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (globalPaused) { await disableGlobalPause(); setGlobalPaused(false); }
      else { await enableGlobalPause(); setGlobalPaused(true); }
    } catch {}
  };

  return (
    <div className="flex flex-col items-center w-full">
      <OocLogo px={logoPx} color={logoColor} />

      {/* Title */}
      <h1
        className="text-xs tracking-wide text-[var(--muted-foreground)] mt-1"
        style={{ fontFamily: "monospace" }}
      >
        Oriented Object Context
      </h1>

      {/* 三个按钮等宽排列在灰色圆角容器中 */}
      <div className="w-full mt-2">
        <div className="flex items-center gap-1 bg-[var(--accent)] rounded-md p-0.5">
          <TogglePill
            active={globalPaused}
            activeColor="#b56933"
            label="pause"
            activeLabel="paused"
            onClick={toggleGlobalPause}
          />
          <TogglePill
            active={debugEnabled}
            activeColor="#283baa"
            label="debug"
            activeLabel="debug"
            onClick={toggleDebug}
          />
          <div
            className={cn(
              PILL_STYLE,
              sseConnected
                ? "bg-green-500/20 text-green-600"
                : "opacity-70",
            )}
          >
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0",
              sseConnected ? "bg-green-500" : "bg-gray-400",
            )} />
            <span>{sseConnected ? "online" : "offline"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
