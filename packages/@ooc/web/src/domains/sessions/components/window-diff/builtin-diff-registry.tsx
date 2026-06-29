/**
 * builtin-diff-registry — builtin class 的 window diff 组件静态注册表 (线 C)。
 *
 * **2026-06-29 重构 (A1+A2 web build fix)**:
 * ooc-6 时代各 builtin 自带 `visible/diff.tsx`,main 当前 builtin 命名空间已改,
 * 旧路径全 MISSING。设计后续: 走 `client-source-url?file=diff` endpoint 动态加载;
 * 本表降级为占位 fallback。
 */
import type { ComponentType, ReactElement } from "react";
import type { WindowDiffProps } from "./window-diff-props";

// 无 builtin 目录,web 本地:
import TalkDiff from "./TalkDiff";
import MethodExecDiff from "./MethodExecDiff";

/** 占位 diff 组件 — builtin diff.tsx 未实装时使用。 */
function PlaceholderDiff(_: WindowDiffProps): ReactElement {
  return (
    <div style={{ padding: 12, color: "var(--muted-foreground, #666)", fontSize: 12, opacity: 0.7 }}>
      [builtin diff 待实装]
    </div>
  );
}

/** builtin window type → diff 组件。 */
export const BUILTIN_DIFF: Record<string, ComponentType<WindowDiffProps>> = {
  // ⏳ 待 builtin 实装 visible/diff.tsx 后切到 ObjectClientRenderer + ?file=diff 路径
  file: PlaceholderDiff,
  knowledge: PlaceholderDiff,
  search: PlaceholderDiff,
  program: PlaceholderDiff,
  plan: PlaceholderDiff,
  // ✅ 本目录自有组件 — 保留
  talk: TalkDiff as ComponentType<WindowDiffProps>,
  method_exec: MethodExecDiff as ComponentType<WindowDiffProps>,
  // do_window 已退役 (issue B 合并入 talk), 2026-06-29 删
};
