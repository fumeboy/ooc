/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * 在 OocLogo 基础上增加 4 个药丸形状的卫星按钮：
 * - btn1（上）：灰色空置
 * - btn2（右）：debug 模式切换
 * - btn3（下）：灰色空置
 * - btn4（左）：全局 pause 切换
 *
 * Logo 颜色随状态变化：
 * - 默认：黑色
 * - debug on：黄色
 * - globalPause on：橙色
 * - 两者都 on：黄→橙渐变
 */
import { useAtom } from "jotai";
import { useEffect } from "react";
import { OocLogo } from "./OocLogo";
import { debugEnabledAtom, globalPausedAtom } from "../store/session";
import {
  enableDebug,
  disableDebug,
  getDebugStatus,
  enableGlobalPause,
  disableGlobalPause,
  getGlobalPauseStatus,
} from "../api/client";

/** 药丸按钮 */
function PillButton({
  position,
  active,
  activeColor,
  onClick,
  label,
  disabled,
}: {
  position: "top" | "right" | "bottom" | "left";
  active?: boolean;
  activeColor?: string;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const posStyles: Record<string, React.CSSProperties> = {
    top: { top: -6, left: "50%", transform: "translateX(-50%)", width: 28, height: 10 },
    bottom: { bottom: -6, left: "50%", transform: "translateX(-50%)", width: 28, height: 10 },
    left: { left: -6, top: "50%", transform: "translateY(-50%)", width: 10, height: 28 },
    right: { right: -6, top: "50%", transform: "translateY(-50%)", width: 10, height: 28 },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        ...posStyles[position],
        position: "absolute",
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        backgroundColor: active ? (activeColor ?? "#9CA3AF") : "#E5E7EB",
        transition: "background-color 0.2s",
        opacity: disabled ? 0.5 : 1,
      }}
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
  const logoColor = debugEnabled && globalPaused
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
    <div className="relative" style={{ width: logoPx + 16, height: logoPx + 16 }}>
      {/* Logo 居中 */}
      <div className="absolute" style={{ top: 8, left: 8 }}>
        <OocLogo px={logoPx} color={logoColor} />
      </div>

      {/* btn1（上）：空置 */}
      <PillButton position="top" disabled />

      {/* btn2（右）：debug 模式 */}
      <PillButton
        position="right"
        active={debugEnabled}
        activeColor="#EAB308"
        onClick={toggleDebug}
        label={debugEnabled ? "关闭 Debug 模式" : "开启 Debug 模式"}
      />

      {/* btn3（下）：空置 */}
      <PillButton position="bottom" disabled />

      {/* btn4（左）：全局 pause */}
      <PillButton
        position="left"
        active={globalPaused}
        activeColor="#F97316"
        onClick={toggleGlobalPause}
        label={globalPaused ? "关闭全局暂停" : "开启全局暂停"}
      />
    </div>
  );
}
