import { object_v20260504_1 } from "@meta";
import { talk_v20260506_1 } from "@meta/object/collaborable/talk/index.doc";
import { relation_v20260506_1 } from "@meta/object/collaborable/relation/index.doc";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";

export const collaborable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Collaborable 描述 Object 的协作与社交能力。

四个子领域（按抽象度递增）：

\`\`\`
talk      ── 一对一通信：消息投递、inbox、跨对象语义、wait 同步
  ↓
relation  ── 对象的有向连接：peer 文件、局部关系网、有向 / 局部知识原则
  ↓
kanban    ── Session 级结构化协作：Issue / Task / Comment + 并发写入
  ↓
role      ── 合作中的特殊主体：supervisor 全局代理
\`\`\`

## 子文档

- [talk](./talk/index.doc.js)         一对一通信原语
- [relation](./relation/index.doc.js) 对象之间的有向连接
- [kanban](./kanban/index.doc.js)     Session 级结构化协作（Issue / Task / Comment）
- [role](./role/index.doc.js)         supervisor 等特殊角色

## 核心主张

### talk 是合作原语

\`talk(target, msg, context, threadId?, wait?)\` 是 Object 间通信的基础。
任何更高级的协作（kanban / 跨对象函数调用 / 反思机制）最终都通过 talk 投递消息实现。

详见 talk。

### 关系是局部的

每个 Object 只知道自己的 relation 列表，不存在全局关系图。
"谁 relation 指向了我"没有 API 可查——对象之间是松耦合的。

详见 relation。

### kanban 把 Session 内的多方协作结构化

talk 是点对点；kanban 是结构化、多方可见。
当一个话题需要多轮讨论 / 多人参与 / 长期跟踪时，需要 Issue + Task。

详见 kanban。

### supervisor 是默认协调者

为了让"用户进来不用先选对象"，supervisor 拥有默认路由 + 看板专属能力。
但 supervisor 本质上仍是普通 Stone——特殊性写在数据里，不写在内核里。

详见 role/supervisor。

## 与其他维度的边界

- 消息**发送侧**（如何 open(command=talk)）— 在 executable/actions/commands/talk
- 消息**接收侧**（inbox 如何进 Context）— 关键机制在本维度的 talk；Context 字段说明在 thinkable/context
- 跨 session 的 super 通道 — 详见 reflectable/super-flow
`,
    talk: talk_v20260506_1,
    relation: relation_v20260506_1,
    kanban: kanban_v20260506_1,
    role: role_v20260506_1,
};
