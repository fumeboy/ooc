/**
 * Badge — 统一的状态/类型标签组件
 *
 * 替代各处硬编码颜色的 StatusBadge 和 ActionBadge。
 * 使用语义化 CSS 变量，自动适配深色模式。
 */

import { cn } from "../../lib/utils";

type BadgeVariant = "blue" | "green" | "yellow" | "red" | "orange" | "purple" | "teal" | "gray";

const variantClasses: Record<BadgeVariant, string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  green:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  red:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  teal:   "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  gray:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

/** Flow 状态 → 颜色 */
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  running: "blue",
  waiting: "yellow",
  finished: "green",
  failed: "red",
  pausing: "orange",
};

/** Action 类型 → 颜色 */
const ACTION_VARIANT: Record<string, BadgeVariant> = {
  thought: "purple",
  program: "blue",
  message_in: "green",
  message_out: "teal",
  pause: "yellow",
  inject: "orange",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  mono?: boolean;
  className?: string;
}

export function Badge({ children, variant = "gray", mono, className }: BadgeProps) {
  return (
    <span className={cn(
      "text-xs px-1.5 py-0.5 rounded",
      mono && "font-mono",
      variantClasses[variant],
      className,
    )}>
      {children}
    </span>
  );
}

/** 快捷：Flow 状态 Badge */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "gray"}>{status}</Badge>;
}

/** 快捷：Action 类型 Badge */
export function ActionBadge({ type }: { type: string }) {
  return <Badge variant={ACTION_VARIANT[type] ?? "gray"} mono>{type}</Badge>;
}
