/**
 * MainLogo — 左边栏专用 Logo 组件
 *
 * 结构与视觉直接对齐旧 Web 的 MainLogo；去掉旧系统 jotai/API 依赖，保留静态状态展示。
 */
import { OocLogo } from "./OocLogo";

const PILL_STYLE = "flex items-center gap-2 rounded-lg text-[10px] transition-colors whitespace-nowrap p-0.5 justify-center flex-1";

function StaticPill({ active, activeColor, label }: { active?: boolean; activeColor?: string; label: string }) {
  return (
    <div
      className={`${PILL_STYLE} ${
        active
          ? "text-white font-semibold uppercase tracking-wider shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
          : "bg-[var(--accent)] text-[var(--muted-foreground)] opacity-70"
      }`}
      style={active && activeColor ? { backgroundColor: activeColor } : undefined}
    >
      <span className={`relative w-5 h-3 rounded-full shrink-0 ${active ? "bg-black/30" : "bg-black/20"}`}>
        <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all ${active ? "left-[10px]" : "left-0.5"}`} />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function MainLogo({ isMobile }: { isMobile?: boolean }) {
  const logoPx = isMobile ? 80 : 120;
  return (
    <div className="flex flex-col items-center w-full">
      <OocLogo px={logoPx} color="#283baa" />

      <h1 className="text-xs tracking-wide text-[var(--muted-foreground)] mt-1" style={{ fontFamily: "monospace" }}>
        Oriented Object Context
      </h1>

      <div className="w-full mt-2">
        <div className="flex items-center gap-1 bg-[var(--accent)] rounded-md p-0.5">
          <StaticPill label="pause" />
          <StaticPill active activeColor="#283baa" label="debug" />
          <div className={`${PILL_STYLE} bg-green-500/20 text-green-600`}>
            <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
            <span>online</span>
          </div>
        </div>
      </div>
    </div>
  );
}

