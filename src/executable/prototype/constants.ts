// src/executable/prototype/constants.ts
import { STONES_MAIN_BRANCH } from "../../persistable";
import type { StoneObjectRef } from "../../persistable";

/** _builtin 原型对象的 canonical URI 前缀（D1）。 */
export const BUILTIN_PROTO_PREFIX = "ooc://stones/_builtin/objects/";

/** _builtin 分支专用名（物理 stones/_builtin/objects/<proto>）。 */
export const BUILTIN_BRANCH = "_builtin";

/** 由原型名拼 builtin canonical id：search → ooc://stones/_builtin/objects/search。 */
export function builtinProtoId(proto: string): string {
  return `${BUILTIN_PROTO_PREFIX}${proto}`;
}

/**
 * 由 StoneObjectRef 计算 canonical id（D1）：
 * - _builtin 分支 → ooc://stones/_builtin/objects/<objectId>
 * - 普通 branch  → ooc://stones/<branch>/objects/<objectId>（branch 缺省 main）
 */
export function canonicalObjectId(ref: StoneObjectRef): string {
  const branch = ref.stonesBranch ?? STONES_MAIN_BRANCH;
  return `ooc://stones/${branch}/objects/${ref.objectId}`;
}
