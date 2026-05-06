import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

export const relation_v20260506_1 = {
    parent: collaborable_v20260504_1,
    index: `
Relation 描述对象之间的有向连接。

对象通过 relation 连接成网络。但这不是一张"全局关系图"——
**每个对象只知道自己的 relation 列表**。

## 物理位置

每个 Object 在自己的 knowledge 目录下持有 relations：

\`\`\`
stones/{name}/knowledge/relations/
├── self.md                    向其他对象介绍自己的文档
├── {peer-name}.md             和某个具体 peer 的关系文档
└── ...
\`\`\`

Flow 级覆盖：

\`\`\`
flows/{sid}/objects/{name}/knowledge/relations/{peer}.md   按会话临时覆盖
\`\`\`

每个 \`relations/{peer}.md\` 是一篇普通的 knowledge 文档（带 frontmatter），自然吸收进
thinkable/knowledge 体系——relation 不需要单独的存储或激活机制。

## peer 文件的内容

\`\`\`yaml
---
namespace: self
name: relations/sophia
description: 与 sophia 的协作规约
summary: 哲学设计部，所有 G/E 编号变更必经
tags: [philosophy, design]
last_updated: 2026-04-23
---

# 与 sophia 的关系

## 协作规矩
- ...

## 历史关键事件
- ...
\`\`\`

字段语义：
- frontmatter 的 \`description\` / \`summary\` 是 LLM 理解关系含义的入口
- 正文写具体协作细节、历史、约定等

**所有权约定**：peer 文件归属本对象（self）私有——只有 self 可以写自己的
\`relations/\` 文件，别人最多通过 talk 发"提议"，由 self 决定是否接受。

## 关系是有向的

\`A → B\` 不蕴含 \`B → A\`。
Alan 的 \`relations/bruce.md\` 存在，不代表 Bruce 也写了 \`relations/alan.md\`。

要双向，A 与 B 各自登记一份。

## 关系是局部的

**没有任何 API 可以查"谁 relation 指向了我"**。
对象之间是松耦合的——A 不关心谁在引用它。

社交网络的"全景图"只能由系统级工具（扫描所有 stones/{name}/knowledge/relations/）
重建——不是任何对象的特权。

## 关系如何进入 Context

不是把所有 relations 全塞进 Context。Context 渲染时只关心**当前线程涉及到的 peers**：

\`\`\`
当前线程 events 中提到的 target + inbox 中的 from
   ↓
collect peer 名单
   ↓
读取每个 peer 对应的 relations/{peer}.md 的 frontmatter.summary
   ↓
作为 knowledge 字段的一部分（按命名空间分组）渲染到 Context
\`\`\`

LLM 想读完整 relation 文档时，可以 \`open(type=knowledge, name="self:relations/sophia")\`
显式拉入完整内容。

## 关系的动态性

### 自己编辑 peer 文件

owner（self）随时可编辑自己的 \`relations/{peer}.md\`：通过 program 调
file_ops 的 writeFile / editFile 实现。

### 提议对方登记关系（relation_update）

我想让 sophia 在她的 \`relations/kernel.md\` 里登记一条规矩——
**不能直接写**（关系文件归属 sophia 私有），只能发"提议"由对方决定：

\`\`\`
talk(target=sophia, context=continue, threadId=<...>,
     type="relation_update",
     msg="请在 relations/kernel.md 里登记：所有 G/E 编号变更必须先 talk 我确认")
\`\`\`

对方收到的 inbox 消息 \`kind="relation_update_request"\`，
其 talkable knowledge 会引导 LLM 给出明确态度（接受 / 部分接受 / 拒绝 / 推迟），
并 talk 回复发起方。

为什么 engine 不自动写：避免"A 塞文字 B 自动记"的信任漏洞——
关系刻写必须由 owner 的 LLM 判断。

## 发现新对象的路径

如果 A 想和 C 协作，但 \`stones/A/knowledge/relations/\` 里没有 C：

### 方式 1：通过共同邻居

A 已知 B，B 关系网里有 C → A talk B 让 B 介绍 / 转发。

### 方式 2：通过 supervisor

通常对象都关注 supervisor。A talk supervisor 询问"我需要 X 能力的对象，找谁"。

### 方式 3：直接 talk（已知名字）

通过历史消息或其他渠道知道 C 存在 → 直接 \`talk("C", ...)\`。
系统按 name 在 World.registry 中查 Stone，建立临时连接。
**但**：这不会自动在 A 的 relations 下建立 \`C.md\`——
A 想记住 C，需要主动写 \`relations/C.md\`（通过 super 分身或 program）。

## 关系 vs 其他引用形式

| 形式 | 存储位置 | 用途 |
|---|---|---|
| relation peer 文件 | knowledge/relations/{peer}.md | 长期、结构化的协作记录 |
| inbox 消息中的 from | thread.inbox | 此次消息涉及的对象（临时） |
| ooc:// 链接 | 正文 markdown 中 | 临时引用某对象 / 文件 |
| talk 时的 target | tool call 参数 | 此次行动的接收方 |

relation 是**持久的、结构化的**；其他都是**临时的、对话级别的**。

## 关系的演化

通过反思机制（详见 reflectable），对象可以：
- 新增 relations/{peer}.md（建立新关系）
- 改写 relations/{peer}.md（更新协作规约）
- 删除 relations/{peer}.md（结束关系）

但 Flow（运行态）不能直接改 Stone 的 relations——
必须通过 super 分身的 SuperFlow 通道沉淀。
`,
};
