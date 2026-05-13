const STAR_PATH = `M 98 36 L 98 02 A 2 2 0 0 1 102 02 L 102 36 A 62 62 0 0 0 164 98 L 178 98 A 2 2 0 0 1 178 102 L 164 102 A 62 62 0 0 0 102 164 L 102 198 A 2 2 0 0 1 98 198 L 98 164 A 62 62 0 0 0 36 102 L 22 102 A 2 2 0 0 1 22 98 L 36 98 A 62 62 0 0 0 98 36 Z`;

export function OocLogo({ px = 36 }: { px?: number }) {
  return (
    <div style={{ width: px, height: px, position: "relative" }}>
      <svg viewBox="0 0 200 200" width={px} height={px} style={{ transform: "rotate(95deg)" }}>
        <defs>
          <linearGradient id="ooc-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#283baa" />
            <stop offset="100%" stopColor="#b56933" />
          </linearGradient>
        </defs>
        <path d={STAR_PATH} fill="url(#ooc-logo-gradient)" />
      </svg>
    </div>
  );
}

