/**
 * Loop debug types for ooc-3 — matches the backend LlmLoopDebugMetaRecord shape.
 *
 * WindowsSnapshot is omitted (ooc-2 concept not applicable to ooc-3's message model).
 */

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
}

export interface LoopListEntry {
  loopIndex: number;
  hasInput: boolean;
  hasOutput: boolean;
  hasMeta: boolean;
  meta?: LoopMeta;
}

export interface LoopDebugRecord {
  loopIndex: number;
  input: { threadId: string; inputItems: unknown[] } | null;
  output: { threadId: string; outputItems: unknown[]; model?: string } | null;
  meta: LoopMeta | null;
}
