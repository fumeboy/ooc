import { object_v20260504_1 } from "@meta";
import { talk_v20260506_1 } from "@meta/object/collaborable/talk/index.doc";
import { relation_v20260506_1 } from "@meta/object/collaborable/relation/index.doc";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";

export const collaborable_v20260504_1 = {
  parent: object_v20260504_1,
  index: `
Collaborable 描述 Object 的协作与社交能力。

四个子领域：

talk      ── 一对一通信：消息投递、inbox、跨对象语义、wait 同步
relation  ── 对象的有向连接：peer 文件、局部关系网、有向 / 局部知识原则
kanban    ── Session 级结构化协作：Issue / Task / Comment + 并发写入 （TODO 待进一步 review 这个设计）
supervisor ── 合作中的特殊主体

## 子文档

- [talk](../executable/actions/commands/talk.doc.js)         一对一通信原语
- [kanban](./kanban/index.doc.js)     Session 级结构化协作（Issue / Task / Comment）
- [supervisor](./supervisor.doc.js)         supervisor 等特殊角色

## 核心概念

### talk 是合作基础

### 对象之间通过 relation 文档记录与对方相关的知识、经验

### kanban 把 Session 内的多方协作结构化

talk 是点对点；kanban 是结构化、多方可见。
当一个话题需要多轮讨论 / 多人参与 / 长期跟踪时，需要 Issue + Task。

### supervisor 是默认协调者

supervisor 是 OOC 系统的超级对象，也是 系统用户 user 的默认对话的对象
supervisor 了解 OOC 系统的运行原理，并能够帮助 user 代理 OOC 系统的所有操作
`,
  talk: talk_v20260506_1,
  relation: relation_v20260506_1,
  kanban: kanban_v20260506_1,
  role: role_v20260506_1,
};
