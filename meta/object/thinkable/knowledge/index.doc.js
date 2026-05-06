import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const knowledge_v20260505_1 = {
    parent: thinkable_v20260504_1,
    index: `
Knowledge 描述 Object 拥有什么知识，以及这些知识如何进入思考。

Knowledge 是 Object 的"知识库" —— 所有可能进入 Context 的非过程性信息。
它统一了原本散落在 trait readme / relations / memory 等多个位置的概念。

核心模型：每篇 knowledge = 一个 markdown 文档 + frontmatter 元数据

物理位置：
\`\`\`
stones/{name}/knowledge/
├── .knowledge.json           知识库配置（声明引用、外部源等）
├── memory/                   长期记忆（详见 reflectable/super-flow）
│   └── index.md              记忆索引页 + 最近记忆
├── relations/                关系文档
│   ├── self.md               向其他对象介绍自己的文档
│   └── {objectId}.md         和某个其他 Object 的关系文档
└── **/*.md                   其他知识文档（任意子目录组织）
\`\`\`

每篇 knowledge md 文档头部携带 yaml frontmatter:

\`\`\`yaml
---
namespace: kernel | library | self
name: relative/name/under/namespace
description: 这篇知识在做什么的一句话描述
activates_on:
  show_description_when: [command_path_1, ...]
  show_content_when: [command_path_2, ...]
---

正文 markdown ...
\`\`\`

字段语义：

- namespace
    - kernel: 系统内置（kernel 仓库自带的基础知识）
    - library: 公共资源库（library/ 提供的可复用知识）
    - self: 该 Object 自己的知识
    - 同一 (namespace, name) 同名时，self 覆盖 library，library 覆盖 kernel

- name
    - 该 namespace 下的相对名（含子目录），如 "computable/file_ops"
    - knowledgeId = \`\${namespace}:\${name}\` 是全局唯一键

- description
    - 一句话描述本篇知识的用途
    - 当此 knowledge "可见但未激活"时，仅 description 出现在 Context 中
    - 让 LLM 知道"有这篇知识，需要时可 open 加载完整内容"

- activates_on
    - 渐进式披露的核心：根据 form 中的 command 路径决定本篇知识何时进入 Context
    - show_description_when: 命中时，仅注入 description（轻量提示）
    - show_content_when: 命中时，注入完整正文（重量加载）
    - command 路径示例：[program] / [talk, return] / [do, plan]

激活机制（与 form 联动）：

\`\`\`
LLM open(type=command, command=program)
  ↓
form 进入 program 路径
  ↓
扫描所有 knowledge 的 activates_on:
  - show_content_when 含 "program" → 完整加载，进入 Context
  - show_description_when 含 "program" → 仅描述出现
  ↓
LLM 看到激活的知识，进行下一步思考
  ↓
submit / close 后，本次 form 引入的 knowledge 卸载
\`\`\`

也可以手动激活：
- LLM 调用 open(type=knowledge, name=...) 显式加载某篇 knowledge
- 这种"手动 pin"的 knowledge 不随 form 关闭而卸载，需 close(type=knowledge, ...) 显式卸载

Scope Chain（作用域链）：

子线程的 Context 中可见的 knowledge = 沿线程树向上收集的"已激活 knowledge 文档"集合。

\`\`\`
根线程 (激活: A.md, B.md)
   ↓
子线程 (激活: C.md)
   ↓
孙线程 (激活: D.md)
\`\`\`

孙线程的 Context 中可见 knowledge = {A, B, C, D}。

意义：父线程的能力对子线程透明继承；子线程的私有激活不污染父/兄。

特殊知识类型：

- relations/{objectId}.md
    - 描述与某个具体其他 Object 的关系
    - 由 talk 等协作过程自动维护或 Object 主动编辑
    - 详见 collaborable/relation

- memory/index.md
    - 长期记忆索引页，跨任务持久存在
    - 通过 super 分身的 SuperFlow 写入（详见 reflectable/super-flow）
    - 进入 Context 的入口由 context-builder 控制（截尾上限保护）

knowledge 的来源：

1. kernel/knowledge/ — 系统内置
2. library/knowledge/ — 公共资源库分享
3. stones/{name}/knowledge/ — Object 自己创建或沉淀

Object 通过反思持续往 self 命名空间累积自己的 knowledge——
这是"经验沉淀为可重用知识"的工程通道（详见 reflectable）。
`,
};
