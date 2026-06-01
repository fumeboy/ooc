import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge("panel ui-card", className)} {...props} />;
}
