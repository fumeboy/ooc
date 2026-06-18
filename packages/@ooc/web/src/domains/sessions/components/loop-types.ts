/**
 * Loop 类型镜像 — 与 src/observable/debug-file.ts:LlmLoopDebugMetaRecord 对齐。
 *
 * 之前这两个 type 住在 LoopEntry.tsx；LoopEntry 已废弃，类型独立成
 * 文件让 LoopTimeline / LoopNavigator / LoopDiffView / 测试都能干净 import。
 */

import type { WindowSnapshotEntry } from "./window-diff.helpers";

export interface LoopMeta {
  threadId: string;
  loopIndex: number;
  provider?: string;
  model?: string;
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  messageCount: number;
  toolCount: number;
  toolCallCount: number;
  contextBytes: number;
  resultTextBytes: number;
  status: "ok" | "paused" | "error";
  error?: string;
  /**
   * 每个 ContextWindow 在该 loop 结束时的 snapshot + hash。
   * 后端 E2 sub agent 写入；E2 数据未到时此字段缺失 → 前端退化为 "no snapshot data"。
   */
  windowsSnapshot?: WindowSnapshotEntry[];
}

export interface LoopListEntry {
  loopIndex: number;
  hasInput: boolean;
  hasOutput: boolean;
  hasMeta: boolean;
  meta?: LoopMeta;
}
