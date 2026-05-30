/**
 * Loop debug types for ooc-3 — matches the backend LlmLoopDebugMetaRecord shape.
 *
 * WindowsSnapshot is omitted (ooc-2 concept not applicable to ooc-3's message model).
 * contextSlices replaces it: the structured defaultContext slices the LLM received this loop.
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

/** A single defaultContext slice as captured from the backend. */
export interface ContextSlice {
  kind: string;
  payload: unknown;
}

export interface LoopDebugRecord {
  loopIndex: number;
  input: { threadId: string; inputItems: unknown[] } | null;
  output: { threadId: string; outputItems: unknown[]; model?: string } | null;
  meta: LoopMeta | null;
  /** Structured defaultContext slices the LLM received this loop. Null if debug wasn't capturing or slices were empty. */
  contextSlices: ContextSlice[] | null;
}
