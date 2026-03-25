/**
 * ObjectAvatar — 为每个 Object 生成确定性头像
 *
 * 基于名称 hash 选择颜色和首字母，无需后端数据。
 */
import { cn } from "../../lib/utils";

const AVATAR_COLORS = [
  "var(--avatar-1)",
  "var(--avatar-2)",
  "var(--avatar-3)",
  "var(--avatar-4)",
  "var(--avatar-5)",
  "var(--avatar-6)",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface ObjectAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  sm: "w-5 h-5 text-[9px]",
  md: "w-7 h-7 text-[11px]",
  lg: "w-9 h-9 text-sm",
};

export function ObjectAvatar({ name, size = "md", className }: ObjectAvatarProps) {
  const h = hashName(name);
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length]!;
  const initial = name.charAt(0).toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium shrink-0 select-none",
        SIZE_MAP[size],
        className,
      )}
      style={{ backgroundColor: color, color: "var(--foreground)" }}
      title={name}
    >
      {initial}
    </span>
  );
}
