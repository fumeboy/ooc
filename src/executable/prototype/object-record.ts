// src/executable/prototype/object-record.ts
import {
  readSelf,
  readExecutableSource,
  readReadable,
  readStoneClientSource,
  type StoneObjectRef,
} from "../../persistable";
import { canonicalObjectId } from "./constants";
import { parseSelfMeta } from "./self-meta";

/** 原型链 registry 的链节点（D3）。 */
export interface ObjectRecord {
  /** canonical id（D1），registry 链接 key。 */
  id: string;
  /** 规范化父节点 canonical id；null = 链终点。 */
  extends: string | null;
  /** 物理位置，供 L3+ probe lazy 读 payload。 */
  ref: StoneObjectRef;
  /** slot 存在性（内容非空才算存在；空占位 ≡ 缺失）。 */
  has: { executable: boolean; readable: boolean; visible: boolean };
}

/** 内容非空判定：空字符串 / undefined / 纯空白 ≡ 缺失。 */
function nonEmpty(s: string | undefined): boolean {
  return (s ?? "").trim().length > 0;
}

/**
 * 从磁盘读 self.md → 解析 extends → 探测 slot 存在性，组装 ObjectRecord。
 *
 * - self.md 缺失 = 该目录不是一个 Object → 抛错（fail-loud）。空 self.md 合法（默认 extends root）。
 * - slot 存在性按"内容非空"判定：createStoneObject 预创建空 self.md / readable.md，
 *   fileExists 会假阳性，故必须读内容。executable/index.ts 与 client/index.tsx 为 lazy 创建。
 * - readable.ts（动态 readable）L2 不探测，待 L1 后半/L8。
 *
 * 该函数是 L3 builtin scanner 的复用单元；L2 仅单测它本身。
 */
export async function loadObjectRecord(ref: StoneObjectRef): Promise<ObjectRecord> {
  const selfText = await readSelf(ref);
  if (selfText === undefined) {
    throw new Error(`loadObjectRecord: self.md 不存在，${ref.objectId} 不是一个 Object`);
  }
  const meta = parseSelfMeta(selfText);
  const [exe, rdb, vis] = await Promise.all([
    readExecutableSource(ref),
    readReadable(ref),
    readStoneClientSource(ref),
  ]);
  return {
    id: canonicalObjectId(ref),
    extends: meta.extends,
    ref,
    has: { executable: nonEmpty(exe), readable: nonEmpty(rdb), visible: nonEmpty(vis) },
  };
}
