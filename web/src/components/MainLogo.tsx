/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * 在 OocLogo 基础上增加 4 个药丸形状的卫星按钮，缓慢围绕 Logo 旋转。
 * - btn1（0°）：灰色空置
 * - btn2（90°）：debug 模式切换
 * - btn3（180°）：灰色空置
 * - btn4（270°）：全局 pause 切换
 *
 * Logo 颜色随状态变化（带淡入淡出动画）
 */
import { useAtom } from "jotai";
import { useEffect } from "react";
import { OocLogo } from "./OocLogo";
import { debugEnabledAtom, globalPausedAtom } from "../store/session";
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
const PILL_STYLE = "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] transition-colors whitespace-nowrap min-w-[52px] h-[18px] justify-center";

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
      style={active ? { backgroundColor: activeColor } : undefined}
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

/** 灰色空置药丸（和 TogglePill 相同尺寸） */
function PlaceholderPill() {
  return (
    <div className={cn(PILL_STYLE, "bg-[var(--accent)]/50 opacity-70 cursor-default")} />
  );
}

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const [debugEnabled, setDebugEnabled] = useAtom(debugEnabledAtom);
  const [globalPaused, setGlobalPaused] = useAtom(globalPausedAtom);

  useEffect(() => {
    getDebugStatus().then((r) => setDebugEnabled(r.debugEnabled)).catch(() => {});
    getGlobalPauseStatus().then((r) => setGlobalPaused(r.globalPaused)).catch(() => {});
  }, []);

  const logoColor =
    debugEnabled && globalPaused
      ? "gradient"
      : debugEnabled
        ? "#8B5CF6"
        : globalPaused
          ? "#F97316"
          : "#000";

  const logoPx = isMobile ? 80 : 120;
  const containerSize = logoPx + 80; // 容器需要足够大容纳旋转的按钮

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
    <div
      className="relative"
      style={{ width: containerSize, height: containerSize }}
    >
      {/* Logo 居中 */}
      <div
        className="absolute"
        style={{
          top: (containerSize - logoPx) / 2,
          left: (containerSize - logoPx) / 2,
        }}
      >
        <OocLogo px={logoPx} color={logoColor} />
      </div>

      {/* btn1（左上）：空置 */}
      <div className="absolute" style={{ top: 0, left: 0 }}>
        <PlaceholderPill />
      </div>

      {/* btn2（右上）：debug */}
      <div className="absolute" style={{ top: 0, right: 0 }}>
        <TogglePill
          active={debugEnabled}
          activeColor="#8B5CF6"
          label="debug"
          activeLabel="debug"
          onClick={toggleDebug}
        />
      </div>

      {/* btn3（左下）：空置 */}
      <div className="absolute" style={{ bottom: 0, left: 0 }}>
        <PlaceholderPill />
      </div>

      {/* btn4（右下）：全局 pause */}
      <div className="absolute" style={{ bottom: 0, right: 0 }}>
        <TogglePill
          active={globalPaused}
          activeColor="#F97316"
          label="pause"
          activeLabel="paused"
          onClick={toggleGlobalPause}
        />
      </div>
    </div>
  );
}
