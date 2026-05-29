/**
 * OocLogo — OOC brand logo component
 * Ported from ooc-2 verbatim.
 */
import { useEffect, useRef, useState } from "react";

const SIZES = {
  sm: { px: 32 },
  md: { px: 48 },
  lg: { px: 80 },
} as const;

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

function StarLayer({ fill, opacity }: { fill: string; opacity: number }) {
  return (
    <div>
      <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full opacity-[0.15] animate-[spin_30s_linear_infinite]">
        <path
          d={SPIRAL_D}
          fill="none"
          stroke={fill === "gradient" ? "url(#ooc-logo-gradient)" : fill}
          strokeWidth="8"
          strokeLinecap="round"
          transform="rotate(60 60 60)"
          style={{ transition: "stroke 0.4s ease" }}
        />
      </svg>
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
            <stop offset="0%" stopColor="#283baa" />
            <stop offset="100%" stopColor="#b56933" />
          </linearGradient>
        </defs>
        <path d={STAR_PATH} fill={fill === "gradient" ? "url(#ooc-logo-gradient)" : fill} />
      </svg>
    </div>
  );
}

export function OocLogo({ size = "sm", px, color }: { size?: keyof typeof SIZES; px?: number; color?: string }) {
  const preset = SIZES[size];
  const dim = px ?? preset.px;
  const radius = dim < 40 ? "rounded-lg" : dim < 80 ? "rounded-xl" : "rounded-2xl";
  const fillColor = color ?? "#7f857d";

  const [prevColor, setPrevColor] = useState(fillColor);
  const [transitioning, setTransitioning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  }, [fillColor, prevColor]);

  return (
    <div className={`relative ${radius} flex items-center justify-center overflow-hidden`} style={{ width: dim, height: dim }}>
      <StarLayer fill={prevColor} opacity={transitioning ? 0 : 1} />
      <StarLayer fill={fillColor} opacity={1} />
    </div>
  );
}
