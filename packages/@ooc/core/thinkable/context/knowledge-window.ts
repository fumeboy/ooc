/**
 * 合成 knowledge window 的共享构造器。
 *
 * protocol（buildRootKnowledgeWindows / creator-reply）与 activator
 * （buildActivatorKnowledgeWindows）都把命中的知识篇目转成同形 KnowledgeWindow：
 * id 为进程内自增合成 id，class=KNOWLEDGE_CLASS_ID（注册 class id，使 resolveReadable
 * 命中 knowledge readable），data={ path, source, body, ...extra }。
 */
import { ROOT_WINDOW_ID } from "../../_shared/types/context-window.js";
import { KNOWLEDGE_CLASS_ID } from "../../_shared/types/constants.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { Data as KnowledgeData } from "@ooc/builtins/knowledge_base/knowledge/types.js";

let syntheticIdCounter = 0;

/** 进程内自增的合成 knowledge window id（kn_<base36 ts>_<base36 seq>）。 */
export function nextSyntheticId(): string {
  syntheticIdCounter += 1;
  return `kn_${Date.now().toString(36)}_${syntheticIdCounter.toString(36)}`;
}

/** 一次性构造 KnowledgeWindow（不可变：data 一次成型，不做后置 mutation）。 */
export function makeKnowledgeWindow(
  path: string,
  body: string,
  source: NonNullable<KnowledgeData["source"]>,
  extra?: Partial<KnowledgeData>,
): OocObjectInstance<KnowledgeData> {
  return {
    id: nextSyntheticId(),
    // 注册 class id（非投影名 "knowledge"）——使 resolveReadable 命中 knowledge readable。
    class: KNOWLEDGE_CLASS_ID,
    parentObjectId: ROOT_WINDOW_ID,
    title: path,
    status: "open",
    createdAt: Date.now(),
    data: { path, source, body, ...extra },
  };
}
