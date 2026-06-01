import type { TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={twMerge("textarea ui-textarea", className)} {...props} />;
}
