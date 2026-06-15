/**
 * method-description —— 从一个 ObjectMethod / WindowMethod 拿描述。
 *
 * ObjectMethod now has a required `description` field directly; this helper
 * simply returns it (kept for call-site ergonomics and single source of truth).
 */
import type { ObjectMethod } from "../_shared/types/method.js";

type DescribableMethod = Pick<ObjectMethod, "description">;

export function extractBasicDescription(entry: DescribableMethod): string | undefined {
  return entry.description;
}

/** 把描述压成单行简述（折叠空白 + 截断），供 LLM input 的紧凑渲染用。 */
export function conciseDescription(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
