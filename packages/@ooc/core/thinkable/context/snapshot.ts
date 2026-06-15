import type { OocObjectInstance } from "../../runtime/ooc-class.js";

export interface ContextSnapshot {
  thread: { id: string; status: string };
  self: { objectId: string };
  windows: OocObjectInstance[];
  overflow: Array<{
    id: string;
    title: string;
    relevance: number;
    reason: string;
  }>;
}
