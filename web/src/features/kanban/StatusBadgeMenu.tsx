/**
 * StatusBadgeMenu — Kanban Issue/Task 状态可点切换徽标
 *
 * 视觉上与原 status badge 完全一致（圆角彩色 pill），但是 <button>：
 * - 点击展开下拉菜单列出所有候选状态
 * - 选中某项 → 调用 onSelect（父组件负责乐观更新 + 调 API）
 * - 外部点击关闭菜单
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_kanban状态切换.md
 */

import { useEffect, useRef, useState } from "react";

export interface StatusOption<T extends string> {
  value: T;
  label: string;
  /** Tailwind 背景色类，例如 "bg-emerald-500" */
  color: string;
}

interface Props<T extends string> {
  /** 当前状态值 */
  current: T;
  /** 候选状态列表（按显示顺序） */
  options: StatusOption<T>[];
  /** 选择回调 */
  onSelect: (next: T) => void;
  /** 是否禁用（如切换中） */
  disabled?: boolean;
}

export function StatusBadgeMenu<T extends string>({ current, options, onSelect, disabled }: Props<T>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* 点击外部关闭 */
  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClickAway);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClickAway);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const currentOpt = options.find((o) => o.value === current);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="status-badge-button"
        data-current={current}
        className={`px-2 py-0.5 rounded-full text-xs text-white transition-opacity ${currentOpt?.color ?? "bg-gray-500"} ${disabled ? "opacity-50 cursor-wait" : "hover:opacity-80 cursor-pointer"}`}
        title="点击切换状态"
      >
        {currentOpt?.label ?? current}
        <span aria-hidden className="ml-1 opacity-70">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="status-badge-menu"
          className="absolute left-0 mt-1 z-50 min-w-[10rem] rounded-md border border-border bg-popover shadow-md py-1"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                if (opt.value !== current) onSelect(opt.value);
              }}
              data-status-option={opt.value}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent/50 ${opt.value === current ? "font-semibold" : ""}`}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${opt.color}`} />
              <span className="flex-1">{opt.label}</span>
              {opt.value === current && <span className="text-primary">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
