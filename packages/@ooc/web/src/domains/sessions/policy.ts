import type { Stone } from "../stones";

export function defaultSessionId() {
  return `web-${Date.now()}`;
}

export function defaultObjectId(stones: Stone[]) {
  return stones[0]?.objectId ?? "";
}

