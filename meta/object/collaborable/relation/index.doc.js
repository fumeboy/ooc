import * as stoneObject from "@src/persistable/stone-object";
import * as stoneData from "@src/persistable/stone-data";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

/**
 * Relation 概念：Object 与其他 Object 之间的长期关系信息。
 *
 * sources（关系数据落在 stone 持久化层的 knowledge/relations/ 目录）:
 *  - stoneObject — stones/{id}/ 目录骨架，承载 knowledge/relations/ 子树
 *  - stoneData   — stone 数据读写入口
 */
export const relation_v20260506_1 = {
  name: "Relation",
  get parent() { return collaborable_v20260504_1; },
  sources: {
    stoneObject,
    stoneData,
  },
  description: `
Relation 描述 Object 之间长期关系信息的形成、更新与使用。
按子字段展开：peerFile / directedLocal / globalNote。
`.trim(),

  peerFile_v20260517_1: {
    index: `
## peerFile — 关系文件物理位置

每个对象在自己的 stone 目录下维护 \`knowledge/relations/{peerId}.md\`，
记录与对方相关的知识、经验、协作历史。
`.trim(),
  },

  directedLocal_v20260517_1: {
    index: `
## directedLocal — 关系的有向 / 局部原则

关系是有向的、局部的——每个对象只维护自己看到的关系；
A 对 B 的关系文件与 B 对 A 的关系文件互不约束。
`.trim(),
  },

  globalNote_v20260517_1: {
    index: `
## globalNote — 不存在全局关系表

不存在中心化的全局 relation 索引。需要"跨对象的关系全貌"时，
由调用方按需聚合各对象 \`relations/*.md\`，而不是查一张共享表。
`.trim(),
  },
};
