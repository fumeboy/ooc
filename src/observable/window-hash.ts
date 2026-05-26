/**
 * Window content hash + snapshot helpers — debug-only.
 *
 * 设计依据: docs/2026-05-26-loop-time-machine-with-window-diff-design.md § 3.1-3.3
 * 文档锚点:
 *   - meta/object.doc.ts:observable.children.debug_files.patches.windows_snapshot
 *   - meta/object.doc.ts:visible.children.loop_timeline.patches.windows_snapshot_data_source
 *
 * 不变量:
 *   - contentHash **不进** thread.json，只在 loop_NNNN.meta.json 的 windowsSnapshot 里
 *   - 算法 type-agnostic（统一 JSON hash），不为每个 window type 注册 hashContent
 *   - stripVolatile 与 src/persistable/thread-json.ts:stripVolatileForPersist 单 window 段保持一致：
 *     剥 _decayMeta；剥 compressLevel === 0/undefined
 *   - hash 稳定性靠 Object.keys(stripped).sort() 保证；字段插入顺序不影响 hash
 */

import type { ContextWindow } from "@src/executable/windows/_shared/types";

/**
 * 剥离 in-process volatile 字段后的 window snapshot；用于 hash 计算。
 *
 * 规则（与 stripVolatileForPersist 同款，单 window 范围）：
 * - 删 _decayMeta（applyNaturalDecay 的运行时计数器）
 * - 删 compressLevel === 0 或 undefined（默认值不参与 hash，避免与历史 window 漂移）
 * - 其余字段（含 sharing / windowKnowledgePaths / status / type-specific 字段）原样保留
 */
export function stripVolatileWindow(window: ContextWindow): Record<string, unknown> {
  // shallow clone 后剥字段；保证调用方传入对象不被改动（immutability）
  const rest: Record<string, unknown> = { ...(window as unknown as Record<string, unknown>) };
  if ("_decayMeta" in rest) delete rest._decayMeta;
  if (!rest.compressLevel) {
    // undefined / 0 都视为默认值
    delete rest.compressLevel;
  }
  return rest;
}

/**
 * 计算 ContextWindow 的 content hash。
 *
 * - type-agnostic：不依赖 window type；统一对剥 volatile 后的对象做 JSON.stringify
 * - 用 Bun.hash（64-bit）+ toString(36) 编码（短）
 * - JSON.stringify 第 2 参数传 sorted keys 数组，保证字段序稳定
 *
 * 同 content（剥 volatile 后）→ 同 hash；
 * 不同 content → 不同 hash（高概率；hash 冲突非安全需求）。
 */
export function computeWindowContentHash(window: ContextWindow): string {
  const stripped = stripVolatileWindow(window);
  const sortedKeys = Object.keys(stripped).sort();
  const json = JSON.stringify(stripped, sortedKeys);
  return Bun.hash(json).toString(36);
}

/**
 * 单条 windowsSnapshot entry（落 loop_NNNN.meta.json）。
 *
 * shape 锚点:
 *   - docs/2026-05-26-loop-time-machine-with-window-diff-design.md § 3.2
 *   - meta/object.doc.ts:observable.children.debug_files.patches.windows_snapshot
 *
 * 字段语义：
 * - id / type：等同源 window
 * - contentHash：computeWindowContentHash 结果
 * - parentWindowId / status / compressLevel：optional，便于前端不再 fetch 完整 window 也能渲染基本 row
 */
export type WindowSnapshotEntry = {
  id: string;
  type: string;
  contentHash: string;
  parentWindowId?: string;
  status?: string;
  compressLevel?: 0 | 1 | 2;
};

/**
 * 给一组 ContextWindow 算 snapshot 数组。
 *
 * 输出顺序与输入顺序一致（前端按数组顺序渲染 diff row）。
 */
export function buildWindowsSnapshot(windows: ContextWindow[]): WindowSnapshotEntry[] {
  return windows.map((w) => {
    const entry: WindowSnapshotEntry = {
      id: w.id,
      type: w.type,
      contentHash: computeWindowContentHash(w),
    };
    if (w.parentWindowId) entry.parentWindowId = w.parentWindowId;
    if (w.status) entry.status = w.status;
    if (w.compressLevel !== undefined && w.compressLevel !== 0) {
      entry.compressLevel = w.compressLevel;
    }
    return entry;
  });
}
