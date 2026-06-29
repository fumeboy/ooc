/**
 * Window diff renderer 的共享 props 类型。
 *
 * 线 C 后,diff 派发已迁到 object 自有 visible/diff.tsx + resolveWindowDiff
 * (见 window-diff/),原 registry 的运行时(register/get/reset Map)已删。此处只保留
 * `WindowDiffRendererProps` 类型——仍被保留的兜底件 FallbackJsonDiff / ErrorBoundary 复用。
 *
 *   - previous: 上一 loop 该 window 的完整对象(added 时 undefined)
 *   - current : 本 loop 该 window 的完整对象(removed 时 undefined)
 */
export interface WindowDiffRendererProps {
  /** 上一 loop 该 window 的完整对象（added 时 undefined）。 */
  previous: unknown;
  /** 本 loop 该 window 的完整对象（removed 时 undefined）。 */
  current: unknown;
  /** Window type 字面量。 */
  windowType: string;
  /** Window id（renderer 内可用作 anchor / tooltip）。 */
  windowId: string;
}
