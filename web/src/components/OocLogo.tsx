/**
 * OocLogo — OOC 品牌 Logo 组件
 *
 * 三个不同大小的黑色圆点 + 连线，外层圆角方块 + 阿基米德螺旋底纹。
 * size: 预设尺寸 "sm"(32px) / "md"(48px) / "lg"(80px)
 * px: 自定义像素尺寸，优先级高于 size
 */

const SIZES = {
  sm: { px: 32, spiral: "3.5" },
  md: { px: 48, spiral: "3.5" },
  lg: { px: 80, spiral: "3" },
} as const;

/** 生成阿基米德螺旋 SVG path: r = a * θ，从中心等距向外展开 */
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

export function OocLogo({ size = "sm", px }: { size?: keyof typeof SIZES; px?: number }) {
  const preset = SIZES[size];
  const dim = px ?? preset.px;
  const spiralW = "8";
  const radius = dim < 40 ? "rounded-lg" : dim < 80 ? "rounded-xl" : "rounded-2xl";

  return (
    <div
      className={`relative ${radius} flex items-center justify-center overflow-hidden`}
      style={{ width: dim, height: dim }}
    >
      {/* 底纹：阿基米德螺旋，从中心等距向外展开 4 圈，缓慢无限旋转 */}
      <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full opacity-[0.15] animate-[spin_30s_linear_infinite]">
        <path d={SPIRAL_D} fill="none" stroke="currentColor" strokeWidth={spiralW} strokeLinecap="round" transform="rotate(60 60 60)" />
      </svg>
      {/* 主图：三个不同大小的圆（对象）+ 连线（关系） */}
      {/* <svg viewBox="18 12 72 80" className="relative" style={{ width: dim * 0.65, height: dim * 0.65 }} aria-label="OOC Logo">
        <line x1="58" y1="32" x2="38" y2="65" stroke="currentColor" strokeWidth="3" />
        <line x1="58" y1="32" x2="75" y2="72" stroke="currentColor" strokeWidth="3" />
        <line x1="38" y1="65" x2="75" y2="72" stroke="currentColor" strokeWidth="3" />
        <circle cx="58" cy="32" r="13" fill="currentColor" />
        <circle cx="38" cy="65" r="9" fill="currentColor" />
        <circle cx="75" cy="72" r="14" fill="currentColor" />
      </svg> */}
      <svg xmlns="http://www.w3.org/2000/svg" transform="rotate(95 0 0)" viewBox="0 0 200 200" width="200" height="200">
        <path d="M 98 36
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
           Z"
          fill="#000" />
      </svg>
    </div>
  );
}
