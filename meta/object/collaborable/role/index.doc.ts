import type { Concept, DocNode } from "@meta/doc-types";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Role 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Role 概念：协作网络中不同 Object 的职责定位。
 *
 * sources（role 不是单独的运行时类型，而是 stone / flow object 上的语义角色）:
 *  - stoneObject — Object 的静态身份目录
 *  - flowObject  — Object 在某 session 内的运行态目录
 */
export type RoleConcept = Concept & {
  sources: {
    stoneObject: typeof stoneObject;
    flowObject: typeof flowObject;
  };

  /** 同构基础——所有 Object 目录结构平等 */
  homogeneousBase: {
    title: string;
    summary?: string;
    directoryEquality: DocNode;
    noTypeField: DocNode;
  };

  /** 角色作为语义叠加层 */
  semanticOverlay: {
    title: string;
    summary?: string;
    knowledgeAsRole: DocNode;
    pluralRoles: DocNode;
  };

  /** supervisor 作为特化角色 */
  supervisorSpecialization: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const role_v20260506_1: RoleConcept = {
  name: "Role",
  get parent() {
    return collaborable_v20260504_1;
  },
  sources: { stoneObject, flowObject },
  description: `
Role 描述协作网络中不同 Object 的职责定位。角色不是声明出来的——它是 Object
持有的 knowledge + server 方法集体现出来的语义叠加层。
`.trim(),

  homogeneousBase: {
    title: "homogeneousBase",
    summary: "所有 Object 在持久化层都是同构的（stone + flow 目录），角色差异不体现在目录上",

    directoryEquality: {
      title: "目录结构平等",
      content: `
普通 Object 与 supervisor 在 \`stones/\` 与 \`flows/\` 下的目录骨架完全一致——
不存在"特殊目录"。任何 Object 都可以原地升级为 supervisor 角色。
      `.trim(),
    },

    noTypeField: {
      title: "无 type 字段",
      content: `
\`.stone.json\` / \`.flow.json\` 不带 \`role\` / \`type\` 字段。区别全靠 knowledge / server 内容。
      `.trim(),
    },
  },

  semanticOverlay: {
    title: "semanticOverlay",
    summary: "角色是叠加在同构对象之上的语义层",

    knowledgeAsRole: {
      title: "knowledge 即角色",
      content: `
某 Object 持有 session-kanban 这类 knowledge → 它就是 supervisor 角色。
角色不是声明出来的，是其知识 + server 方法集体现出来的。
      `.trim(),
    },

    pluralRoles: {
      title: "一个对象可担多角色",
      content: `
同一 Object 可同时持有"开发者 knowledge"+"评审 knowledge"，由 LLM 自行
在合适 context 中调用对应能力。系统不强制单一角色。
      `.trim(),
    },
  },

  supervisorSpecialization: {
    title: "supervisorSpecialization",
    summary: "supervisor 是其中一个特化角色，承担 user 接入与任务派发",
    content: "详见 collaborable.concepts.supervisor。",
  },
};
