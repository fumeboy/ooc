import type { InputHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={twMerge("input ui-input", className)} {...props} />;
}
