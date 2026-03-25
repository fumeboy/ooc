/**
 * CodeBlock — 统一的代码/预格式化文本块
 */

import { cn } from "../../lib/utils";

interface CodeBlockProps {
  children: React.ReactNode;
  maxHeight?: string;
  muted?: boolean;
  className?: string;
}

export function CodeBlock({ children, maxHeight = "max-h-40", muted, className }: CodeBlockProps) {
  return (
    <pre className={cn(
      "text-xs whitespace-pre-wrap font-mono rounded p-2 overflow-auto",
      "bg-[var(--muted)]",
      muted && "text-[var(--muted-foreground)]",
      maxHeight,
      className,
    )}>
      {children}
    </pre>
  );
}
