/**
 * method-description —— 从一个 ObjectMethod / WindowMethod 推导出"基础描述"。
 *
 * Phase C (2026-06-03) 起 method 不再有独立 description 字段，描述来自
 * `entry.onFormChange()` 返回的 GuidanceWindow：
 *   1. title 以 `/basic` 结尾的那条（约定；所有 method 在 open form 时登记）
 *   2. 兜底取 content 最长的那条（input hint 通常更短）
 *   3. onFormChange 未注册 / 调用抛错 → undefined（caller 退化为只显示 name/paths）
 *
 * 单一来源：UI 的 list-window-types 与 LLM input 的 methods 渲染（xml.ts）共用，
 * 避免两处各写一份推导逻辑而漂移。
 */
import type { ObjectMethod } from "../../../_shared/types/method.js";
import type { FormChangeEvent, Intent } from "../../../thinkable/context/intent.js";
import type { MethodExecWindow } from "./types.js";

/** object method 与 window method 都满足的最小结构（二者 onFormChange / intent 签名一致）。 */
type DescribableMethod = Pick<ObjectMethod, "onFormChange" | "intent">;

export function extractBasicDescription(entry: DescribableMethod): string | undefined {
  if (!entry.onFormChange) return undefined;
  const stubForm = {
    id: "__describe__",
    method: "describe",
    accumulatedArgs: {},
    status: "open",
  } as MethodExecWindow;
  const change: FormChangeEvent = {
    kind: "args_refined",
    added: [],
    removed: [],
    changed: [],
    args: {},
  };
  const defaultIntent: Intent = { name: "describe" };
  const intents = [defaultIntent, ...entry.intent({})];
  let windows;
  try {
    windows = entry.onFormChange(change, { form: stubForm, intents }) ?? [];
  } catch {
    return undefined;
  }
  const pairs = windows
    .filter((w) => w.type === "guidance")
    .map((w) => [w.title, (w as { content?: unknown }).content] as [string, unknown])
    .filter(([, c]) => typeof c === "string" && (c as string).length > 0) as [string, string][];
  if (pairs.length === 0) return undefined;
  const basic = pairs.find(([path]) => path.endsWith("/basic"));
  if (basic) return basic[1];
  return pairs.reduce((a, b) => (a[1].length >= b[1].length ? a : b))[1];
}

/** 把基础描述压成单行简述（折叠空白 + 截断），供 LLM input 的紧凑渲染用。 */
export function conciseDescription(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
