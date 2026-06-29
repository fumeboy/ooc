/**
 * Object 的 visible/diff.tsx default export 契约(线 C,对称 visible/index.tsx 的 {window})。
 * previous/current = 相邻两 loop 的同 id window 快照;added→previous 缺省,removed→current 缺省。
 * 类型为 unknown:实际形态可能是精简 WindowSnapshotEntry 或 fetch 来的完整 window,
 * diff 组件按需防御性 probe(与现有 window-diff-renderers 一致)。current 可携带后端 payload(如 fileDiff)。
 */
export interface WindowDiffProps {
  previous?: unknown;
  current?: unknown;
}
