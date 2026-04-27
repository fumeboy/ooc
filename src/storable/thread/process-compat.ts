/**
 * FlowData process compatibility helpers.
 *
 * ThreadTree is the live execution model. These helpers only keep the legacy
 * FlowData.process shape usable for HTTP responses and persisted historical data.
 */

import type { Action, Process, ProcessNode } from "../../types/index.js";

export function createProcess(title: string, description?: string): Process {
  return {
    root: {
      id: "root",
      title,
      ...(description ? { description } : {}),
      status: "doing",
      children: [],
      actions: [],
    },
    focusId: "root",
  };
}

export function collectAllActions(root: ProcessNode): Action[] {
  const actions: Action[] = [...(root.actions ?? [])];
  for (const child of root.children ?? []) {
    actions.push(...collectAllActions(child));
  }
  return actions;
}
