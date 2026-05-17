import * as talkWindow from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";
import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";
import { object_v20260504_1 } from "@meta/object/index.doc";
import { talk_v20260506_1 } from "@meta/object/collaborable/talk/index.doc";
import { relation_v20260506_1 } from "@meta/object/collaborable/relation/index.doc";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";
import { supervisor_v20260506_1 } from "@meta/object/collaborable/supervisor.doc";

/**
 * Collaborable 概念：Object 的协作与社交能力总览。
 *
 * sources（聚合层 sources 选取 collaborable 各子领域的主干模块）:
 *  - talkWindow    — 一对一会话窗口（talk 子领域核心）
 *  - talkDelivery  — 跨对象消息派送
 *  - stoneObject   — 关系 / 角色等长期信息的持久化基底
 *  - flowObject    — kanban / session 协作数据的持久化基底
 */
export const collaborable_v20260504_1 = {
  name: "Collaborable",
  get parent() { return object_v20260504_1; },
  sources: {
    talkWindow,
    talkDelivery,
    stoneObject,
    flowObject,
  },
  description: `
Collaborable 描述 Object 的协作与社交能力。

四个子领域：

- talk      — 一对一通信：消息投递、inbox、跨对象语义、wait 同步
- relation  — 对象的有向连接：peer 文件、局部关系网、有向 / 局部知识原则
- kanban    — Session 级结构化协作：Issue / Task / Comment + 并发写入
- role      — 协作网络中的角色定位，supervisor 是其中一个特化角色

talk 是点对点；kanban 把 Session 内的多方协作结构化。
当一个话题需要多轮讨论 / 多人参与 / 长期跟踪时，需要 Issue + Task。
supervisor 是 OOC 系统的默认协调对象，是 user 的默认对话目标，
了解 OOC 系统的运行原理并能代理 user 操作系统。
`.trim(),

  concepts: {
    talk: talk_v20260506_1,
    relation: relation_v20260506_1,
    kanban: kanban_v20260506_1,
    role: role_v20260506_1,
    supervisor: supervisor_v20260506_1,
  },
};
