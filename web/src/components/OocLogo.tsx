/**
 * OocLogo — OOC 品牌 Logo 组件
 *
 * 星型 SVG + 阿基米德螺旋底纹。
 * size: 预设尺寸 "sm"(32px) / "md"(48px) / "lg"(80px)
 * px: 自定义像素尺寸，优先级高于 size
 * color: Logo 填充色（支持 "gradient" 渐变），带淡入淡出动画
 */

import { useRef, useEffect, useState } from "react";

const SIZES = {
  sm: { px: 32, spiral: "3.5" },
  md: { px: 48, spiral: "3.5" },
  lg: { px: 80, spiral: "3" },
} as const;

/** 生成阿基米德螺旋 SVG path */
function spiralPath(cx: number, cy: number, maxRadius: number, turns: number, steps: number): string {
  const points: string[] = [];
  const maxTheta = turns * 2 * Math.PI;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * maxTheta;
    const r = (theta / maxTheta) * maxRadius;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    points.push(i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

const SPIRAL_D = spiralPath(60, 60, 55, 4, 200);

const STAR_PATH = `M 98 36
   L 98 02
   A 2 2 0 0 1 102 02
   L 102 36
   A 62 62 0 0 0 164 98
   L 178 98
   A 2 2 0 0 1 178 102
   L 164 102
   A 62 62 0 0 0 102 164
   L 102 198
   A 2 2 0 0 1 98 198
   L 98 164
   A 62 62 0 0 0 36 102
   L 22 102
   A 2 2 0 0 1 22 98
   L 36 98
   A 62 62 0 0 0 98 36
   Z`;

/** 星型 SVG 层（用于颜色叠加动画） */
function StarLayer({ fill, opacity }: { fill: string; opacity: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      transform="rotate(95 0 0)"
      viewBox="0 0 200 200"
      width="200"
      height="200"
      className="absolute inset-0 w-full h-full"
      style={{ opacity, transition: "opacity 0.4s ease" }}
    >
      <defs>
        <linearGradient id="ooc-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <path
        d={STAR_PATH}
        fill={fill === "gradient" ? "url(#ooc-logo-gradient)" : fill}
      />
    </svg>
  );
}

export function OocLogo({ size = "sm", px, color }: { size?: keyof typeof SIZES; px?: number; color?: string }) {
  const preset = SIZES[size];
  const dim = px ?? preset.px;
  const spiralW = "8";
  const radius = dim < 40 ? "rounded-lg" : dim < 80 ? "rounded-xl" : "rounded-2xl";
  const fillColor = color ?? "#000";

  /* 颜色过渡：用前一个颜色淡出 + 新颜色淡入 */
  const [prevColor, setPrevColor] = useState(fillColor);
  const [transitioning, setTransitioning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (fillColor !== prevColor) {
      setTransitioning(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setPrevColor(fillColor);
        setTransitioning(false);
      }, 400);
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [fillColor]);

  return (
    <div
      className={`relative ${radius} flex items-center justify-center overflow-hidden`}
      style={{ width: dim, height: dim }}
    >
      {/* 底纹：阿基米德螺旋 */}
      <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full opacity-[0.15] animate-[spin_30s_linear_infinite]">
        <path d={SPIRAL_D} fill="none" stroke={fillColor === "gradient" ? "#F97316" : fillColor} strokeWidth={spiralW} strokeLinecap="round" transform="rotate(60 60 60)" style={{ transition: "stroke 0.4s ease" }} />
      </svg>

      {/* 星型：双层叠加实现颜色淡入淡出 */}
      <StarLayer fill={prevColor} opacity={transitioning ? 0 : 1} />
      <StarLayer fill={fillColor} opacity={1} />
    </div>
  );
}
