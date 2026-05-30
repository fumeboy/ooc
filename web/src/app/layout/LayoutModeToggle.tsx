/**
 * LayoutModeToggle —— 切换 web 布局的两栏 / 三栏模式。
 *
 * 三栏（默认）：sidebar + main + right
 * 两栏：隐藏 sidebar，main 与 right 各占 50%（更专注 chat ↔ 主视图，少打扰）
 *
 * 状态由 shell 持有 + localStorage 持久化；本组件只接受 `mode` + `onToggle`。
 * 同一组件会出现在 MainPanel breadcrumb-bar 最左 + RightPanel 顶部 header，
 * 让用户在两个常用视区都能切换。
 */

import { Columns2, Columns3 } from "lucide-react";

export type LayoutMode = "three-column" | "two-column";

export function LayoutModeToggle({
  mode,
  onToggle,
  className = "",
}: {
  mode: LayoutMode;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = mode === "three-column" ? Columns3 : Columns2;
  const next = mode === "three-column" ? "two-column" : "three-column";
  const title =
    mode === "three-column"
      ? "切换到两栏布局（隐藏左侧栏，主面板与右面板各占 50%）"
      : "切换到三栏布局（恢复左侧栏）";
  return (
    <button
      type="button"
      className={`layout-mode-toggle ${className}`.trim()}
      onClick={onToggle}
      title={title}
      aria-label={`切换到 ${next === "two-column" ? "两栏" : "三栏"}布局`}
      data-mode={mode}
    >
      <Icon size={13} strokeWidth={2} />
    </button>
  );
}

const STORAGE_KEY = "ooc:layoutMode";

/** 读 localStorage 里上次保存的模式；缺省回退三栏。 */
export function readPersistedLayoutMode(): LayoutMode {
  if (typeof window === "undefined") return "three-column";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "two-column" ? "two-column" : "three-column";
  } catch {
    return "three-column";
  }
}

/** 持久化布局模式；失败静默（隐私模式 / 配额）。 */
export function persistLayoutMode(mode: LayoutMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
