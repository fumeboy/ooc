import type { OocObjectRef } from "../../runtime/ooc-class.js";

export interface ContextSnapshot {
  thread: { id: string; status: string };
  self: { objectId: string };
  windows: OocObjectRef[];
  overflow: Array<{
    id: string;
    title: string;
    relevance: number;
    reason: string;
  }>;
}
