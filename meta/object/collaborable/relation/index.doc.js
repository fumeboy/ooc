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
`,

  peerFile_v20260517_1: {
    title: "peerFile — 关系文件物理位置",
    content: `
每个对象在自己的 stone 目录下维护 knowledge/relations/{peerId}.md，
记录与对方相关的知识、经验、协作历史。详见两个子节点。
    `,

    pathConvention_v20260517_1: {
      title: "路径约定",
      content: `
stones/{selfId}/knowledge/relations/{peerId}.md——文件名 = peer 的 objectId。
没有 peer 文件时即代表"无关系记录"，不需要预创建空文件。
      `,
    },

    activationAsKnowledge_v20260517_1: {
      title: "作为 knowledge 激活",
      content: `
relations/{peer}.md 是普通 knowledge，按 activates_on 在与 peer 的 talk 上下文中
自动加载。LLM 看到的不是"关系表"，而是与对方对话时浮现的相关知识页。
      `,
    },
  },

  directedLocal_v20260517_1: {
    title: "directedLocal — 关系的有向 / 局部原则",
    content: `
关系是有向的、局部的——每个对象只维护自己看到的关系。详见三个子节点。
    `,

    directedness_v20260517_1: {
      title: "有向性",
      content: `
A 对 B 的关系文件与 B 对 A 的关系文件互不约束。A 说"B 是合作伙伴"不要求 B 也
持有对应文件，反之亦然。
      `,
    },

    locality_v20260517_1: {
      title: "局部性",
      content: `
每个对象只持有自己视角下的关系——没有全局对称性约束。这与社交网络的"好友
关系"不同，更接近现实中的"我对你的印象"。
      `,
    },

    asymmetryAllowed_v20260517_1: {
      title: "允许不对称",
      content: `
A 对 B 的评价与 B 对 A 的评价可以完全不同；系统不强行对齐两端内容。这条
约束让对象保有真实的个体视角。
      `,
    },
  },

  globalNote_v20260517_1: {
    title: "globalNote — 不存在全局关系表",
    content: `
不存在中心化的全局 relation 索引。详见两个子节点。
    `,

    noGlobalIndex_v20260517_1: {
      title: "没有共享 relation 表",
      content: `
任何对象都不能"查询所有关系"——这条规则等同于"对象不能拥有全局世界视角"。
      `,
    },

    onDemandAggregation_v20260517_1: {
      title: "按需聚合",
      content: `
需要"跨对象的关系全貌"时，由调用方按需聚合各对象 relations/*.md，
而不是查一张共享表。聚合行为本身是独立 use case 而非数据原语。
      `,
    },
  },
};
