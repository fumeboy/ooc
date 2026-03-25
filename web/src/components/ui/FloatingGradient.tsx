/**
 * FloatingGradient — 浮动渐变背景装饰
 *
 * 纯 CSS 动画实现，无需 framer-motion 依赖。
 * 三个渐变光球以不同速度和轨迹缓慢移动，营造层次感。
 */
export function FloatingGradient() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
      <div
        className="absolute h-[500px] w-[500px] rounded-full opacity-[0.25] blur-[100px]"
        style={{
          background: "linear-gradient(135deg, #6366f1, #64748b)",
          top: "5%",
          left: "10%",
          animation: "fg-drift-1 20s ease-in-out infinite",
        }}
      />
      <div
        className="absolute h-[400px] w-[400px] rounded-full opacity-[0.20] blur-[100px]"
        style={{
          background: "linear-gradient(135deg, #ec4899, #f97316)",
          bottom: "10%",
          right: "5%",
          animation: "fg-drift-2 25s ease-in-out infinite",
        }}
      />
      <div
        className="absolute h-[350px] w-[350px] rounded-full opacity-[0.15] blur-[100px]"
        style={{
          background: "linear-gradient(135deg, #10b981, #06b6d4)",
          top: "40%",
          left: "50%",
          animation: "fg-drift-3 30s ease-in-out infinite",
        }}
      />
    </div>
  );
}
