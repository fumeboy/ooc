import type { ContextWindow } from "../../executable/windows/_shared/types.js";

export interface ContextSnapshot {
  thread: { id: string; status: string };
  self: { objectId: string };
  windows: ContextWindow[];
  overflow: Array<{
    id: string;
    title: string;
    relevance: number;
    reason: string;
  }>;
}
