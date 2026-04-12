/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * 在 OocLogo 基础上增加 4 个药丸形状的卫星按钮：
 * - btn1（上）：灰色空置
 * - btn2（右）：debug 模式切换
 * - btn3（下）：灰色空置
 * - btn4（左）：全局 pause 切换
 *
 * Logo 颜色随状态变化（带淡入淡出动画）：
 * - 默认：黑色
 * - debug on：黄色
 * - globalPause on：橙色
 * - 两者都 on：黄→橙渐变
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

/** 带 toggle 开关的药丸按钮（横向，和 MessageSidebar 的 pause 按钮风格一致） */
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
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={active ? activeLabel : label}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] transition-colors whitespace-nowrap",
        active
          ? `text-white`
          : "bg-[var(--accent)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]/80",
      )}
      style={active ? { backgroundColor: activeColor } : undefined}
    >
      {/* mini toggle */}
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

/** 灰色空置药丸 */
function PlaceholderPill() {
  return (
    <div
      className="rounded-full bg-[var(--accent)]/50"
      style={{ width: 28, height: 10 }}
    />
  );
}

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const [debugEnabled, setDebugEnabled] = useAtom(debugEnabledAtom);
  const [globalPaused, setGlobalPaused] = useAtom(globalPausedAtom);

  /* 启动时同步状态 */
  useEffect(() => {
    getDebugStatus().then((r) => setDebugEnabled(r.debugEnabled)).catch(() => {});
    getGlobalPauseStatus().then((r) => setGlobalPaused(r.globalPaused)).catch(() => {});
  }, []);

  /* Logo 颜色 */
  const logoColor =
    debugEnabled && globalPaused
      ? "gradient"
      : debugEnabled
        ? "#EAB308"
        : globalPaused
          ? "#F97316"
          : "#000";

  const logoPx = isMobile ? 80 : 120;

  const toggleDebug = async () => {
    try {
      if (debugEnabled) {
        await disableDebug();
        setDebugEnabled(false);
      } else {
        await enableDebug();
        setDebugEnabled(true);
      }
    } catch {}
  };

  const toggleGlobalPause = async () => {
    try {
      if (globalPaused) {
        await disableGlobalPause();
        setGlobalPaused(false);
      } else {
        await enableGlobalPause();
        setGlobalPaused(true);
      }
    } catch {}
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* btn1（上）：空置 */}
      <PlaceholderPill />

      {/* 中间行：btn4 + Logo + btn2 */}
      <div className="flex items-center gap-1.5">
        {/* btn4（左）：全局 pause */}
        <TogglePill
          active={globalPaused}
          activeColor="#F97316"
          label="pause"
          activeLabel="paused"
          onClick={toggleGlobalPause}
        />

        {/* Logo（带颜色过渡动画） */}
        <div style={{ transition: "filter 0.3s ease" }}>
          <OocLogo px={logoPx} color={logoColor} />
        </div>

        {/* btn2（右）：debug 模式 */}
        <TogglePill
          active={debugEnabled}
          activeColor="#EAB308"
          label="debug"
          activeLabel="debug"
          onClick={toggleDebug}
        />
      </div>

      {/* btn3（下）：空置 */}
      <PlaceholderPill />
    </div>
  );
}
