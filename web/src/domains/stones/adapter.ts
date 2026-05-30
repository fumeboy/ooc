import type { Stone } from "./model";

export function stoneDisplayName(stone: Stone): string {
  return stone.objectId;
}
