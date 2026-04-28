/**
 * FlowData process compatibility helpers.
 *
 * ThreadTree is the live execution model. These helpers only keep the legacy
 * FlowData.process shape usable for HTTP responses and persisted historical data.
 */

import type { Action, Process, ProcessNode } from "../../shared/types/index.js";

export function createProcess(title: string, description?: string): Process {
  return {
    root: {
      id: "root",
      title,
      ...(description ? { description } : {}),
      status: "doing",
      children: [],
      events: [],
    },
    focusId: "root",
  };
}

export function collectAllEvents(root: ProcessNode): Action[] {
  const events: Action[] = [...(root.events ?? [])];
  for (const child of root.children ?? []) {
    events.push(...collectAllEvents(child));
  }
  return events;
}
