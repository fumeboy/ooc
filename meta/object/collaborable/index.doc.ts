import type { Concept, DocNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import {
  talk_v20260506_1,
  type TalkConcept,
} from "@meta/object/collaborable/talk/index.doc";
import {
  relation_v20260506_1,
  type RelationConcept,
} from "@meta/object/collaborable/relation/index.doc";
import {
  kanban_v20260506_1,
  type KanbanConcept,
} from "@meta/object/collaborable/kanban/index.doc";
import {
  role_v20260506_1,
  type RoleConcept,
} from "@meta/object/collaborable/role/index.doc";
import {
  supervisor_v20260506_1,
  type SupervisorConcept,
} from "@meta/object/collaborable/supervisor.doc";
import * as talkWindow from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";
import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Collaborable 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Collaborable 概念：Object 的协作与社交能力总览。
 *
 * sources（聚合层 sources 选取 collaborable 各子领域的主干模块）:
 *  - talkWindow    — 一对一会话窗口（talk 子领域核心）
 *  - talkDelivery  — 跨对象消息派送
 *  - stoneObject   — 关系 / 角色等长期信息的持久化基底
 *  - flowObject    — kanban / session 协作数据的持久化基底
 *
 * 子概念（通过 concepts 暴露给 walker）：
 *  - talk        — 一对一通信
 *  - relation    — 对象的有向连接
 *  - kanban      — Session 级结构化协作（Issue / Task / Comment / ConcurrentWrite）
 *  - role        — 协作网络中的角色定位
 *  - supervisor  — supervisor 特化角色
 */
export type CollaborableConcept = Concept & {
  sources: {
    talkWindow: typeof talkWindow;
    talkDelivery: typeof talkDelivery;
    stoneObject: typeof stoneObject;
    flowObject: typeof flowObject;
  };

  /** 四个子领域 */
  subdomains: {
    title: string;
    summary?: string;
    talkDomain: DocNode;
    relationDomain: DocNode;
    kanbanDomain: DocNode;
    roleDomain: DocNode;
  };

  /** talk 与 kanban 在使用边界上的分工 */
  layering: DocNode;

  /** supervisor 在协作网络中的特殊角色 */
  supervisor: DocNode;

  /** 子概念集合（被 walker 识别） */
  concepts: {
    talk: TalkConcept;
    relation: RelationConcept;
    kanban: KanbanConcept;
    role: RoleConcept;
    supervisor: SupervisorConcept;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const collaborable_v20260504_1: CollaborableConcept = {
  name: "Collaborable",
  get parent() {
    return object_v20260504_1;
  },
  sources: { talkWindow, talkDelivery, stoneObject, flowObject },
  description: `
Collaborable 描述 Object 的协作与社交能力——按"实时一对一 → 长期结构化"递进
组织：talk（点对点）→ relation（局部连接）→ kanban（多方结构化协作）→ role
（角色定位，supervisor 是其特化）。
`.trim(),

  subdomains: {
    title: "四个子领域",
    summary: "talk / relation / kanban / role 按粒度递进",

    talkDomain: {
      title: "talk",
      content: `
一对一通信：消息投递、inbox、跨对象语义、wait 同步。详见 concepts.talk。
      `.trim(),
    },

    relationDomain: {
      title: "relation",
      content: `
对象的有向连接：peer 文件、局部关系网、有向 / 局部知识原则。详见 concepts.relation。
      `.trim(),
    },

    kanbanDomain: {
      title: "kanban",
      content: `
Session 级结构化协作：Issue / Task / Comment + 并发写入。详见 concepts.kanban。
      `.trim(),
    },

    roleDomain: {
      title: "role",
      content: `
协作网络中的角色定位，supervisor 是其中一个特化角色。
详见 concepts.role 与 concepts.supervisor。
      `.trim(),
    },
  },

  layering: {
    title: "talk 与 kanban 的分工",
    summary: "talk 点对点；kanban 把 Session 内的多方协作结构化",
    content: `
当一个话题需要多轮讨论 / 多人参与 / 长期跟踪时，需要 Issue + Task。
详细对照见 concepts.kanban.vsTalk。
    `.trim(),
  },

  supervisor: {
    title: "supervisor 在协作网络中",
    summary: "OOC 系统的默认协调对象，user 的默认对话目标",
    content: `
supervisor 是 OOC 系统的默认协调对象，是 user 的默认对话目标，
了解 OOC 系统的运行原理并能代理 user 操作系统。详见 concepts.supervisor。
    `.trim(),
  },

  concepts: {
    talk: talk_v20260506_1,
    relation: relation_v20260506_1,
    kanban: kanban_v20260506_1,
    role: role_v20260506_1,
    supervisor: supervisor_v20260506_1,
  },
};
