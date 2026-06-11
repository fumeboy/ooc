import { t } from "elysia";
import type { LlmLoopDebugMetaRecord } from "@ooc/core/persistable";

export const threadDebugParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
  threadId: t.String(),
});

export const loopDebugParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
  threadId: t.String(),
  loopIndex: t.Numeric(),
});

/**
 * list-loops endpoint response shape.
 *
 * LoopMeta 复用 persistable 落盘类型 LlmLoopDebugMetaRecord; 不复制定义避免漂移。
 * 前端组件可 import { LoopMeta } from runtime model 用同一份类型。
 */
export type LoopMeta = LlmLoopDebugMetaRecord;

/** list-loops 单条目: 描述某个 loopIndex 在 debug 目录下的 input/output/meta 三类文件存在性 + meta 内容回填。 */
export interface LoopListEntry {
  /** loop 序号 (从 1 起, 与 loop_NNNN 文件名解析一致). */
  loopIndex: number;
  hasInput: boolean;
  hasOutput: boolean;
  hasMeta: boolean;
  /**
   * 当 hasMeta=true 且 meta.json 内容是合法 JSON 时附带; meta.json 损坏 → omit (前端
   * 只能从 hasMeta=true & meta===undefined 区分 "存在但损坏").
   */
  meta?: LoopMeta;
}

export interface ListLoopsResponse {
  loops: LoopListEntry[];
}

export const RuntimeModel = {
  globalPauseResponse: t.Object({ enabled: t.Boolean() }),
  llmConfigResponse: t.Object({
    configured: t.Boolean(),
    provider: t.String(),
    baseUrl: t.String(),
    model: t.String(),
    error: t.Optional(t.String()),
  }),
} as const;
