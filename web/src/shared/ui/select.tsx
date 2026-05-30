import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="ui-select-shell">
      <select className={twMerge("input ui-input ui-select", className)} {...props} />
      <span className="ui-select-icon" aria-hidden="true">
        <ChevronDown size={16} strokeWidth={1.8} />
      </span>
    </div>
  );
}
