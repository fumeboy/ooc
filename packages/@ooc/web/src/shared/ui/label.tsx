import type { LabelHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={twMerge("ui-label", className)} {...props} />;
}
