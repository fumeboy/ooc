import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { Intent } from "./intent.js";

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
  trace: {
    intents: Record<string, Intent[]>;
    perWindow: Record<string, {
      matchedIntent?: string;
      producedBy: string;
    }>;
  };
}
