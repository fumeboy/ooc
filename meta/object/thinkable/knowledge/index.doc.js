import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as knowledgeTypes from "@src/thinkable/knowledge/types";
import * as knowledgeParser from "@src/thinkable/knowledge/parser";
import * as knowledgeLoader from "@src/thinkable/knowledge/loader";
import * as knowledgeActivator from "@src/thinkable/knowledge/activator";

export const knowledge_v20260505_1 = {
  get parent() { return thinkable_v20260504_1; },
  sources: {
    types: knowledgeTypes,
    parser: knowledgeParser,
    loader: knowledgeLoader,
    activator: knowledgeActivator,
  },
  index: `
Knowledge 描述 Object 拥有什么知识，以及这些知识如何进入思考。

# 核心模型：
每篇 knowledge = 一个 markdown 文档 + frontmatter 元数据

# 物理位置
（以 stone 为例， flow 目录下也具有 knowledge 目录， 具体结构见 persistable 文档）：
\`\`\`
stones/{name}/knowledge/
├── .knowledge.json           知识库配置（声明引用、外部源等）
├── memory/                   长期记忆（详见 reflectable 文档）
│   └── index.md              记忆索引页 + 最近记忆
├── relations/                关系文档
│   └── {objectId}.md         和某个其他 Object 的关系文档
└── **/*.md                   其他知识文档（任意子目录组织）
\`\`\`

# 文档结构：
每篇 knowledge md 文档头部携带 yaml frontmatter:

\`\`\`yaml
---
filename: xxx
title: 这篇知识的标题
description: 这篇知识在做什么的一句话描述
activates_on:
  show_description_when: [command_path_1, ...]
  show_content_when: [command_path_2, ...]
---

正文 markdown ...
\`\`\`

字段语义：

- filename
    - 知识文档的文件名，与 knowledgeId 一致
    - 用于在 Context 中引用该知识
    - 例如：open(type=knowledge, path=/path/xxx.md) 会加载 xxx.md 这个知识

- title
    - 知识文档的标题

- description
    - 一句话描述本篇知识的内容
    - 当此 knowledge "可见但未激活"时，仅 description 出现在 Context 中
    - 让 LLM 知道"有这篇知识，需要时可 open 加载完整内容"

- activates_on
    - 渐进式披露的核心：根据 form 中的 command 路径决定本篇知识何时进入 Context
    - show_description_when: 命中时，仅注入 description（轻量提示）
    - show_content_when: 命中时，注入完整正文（重量加载）

- command 路径示例：[program] / [talk, end] / [do, plan]

# 激活机制（与 form 联动）：

\`\`\`
LLM open(type=command, command=program)
  ↓
open 打开一个 form 进入，匹配 program 路径
  ↓
扫描所有 knowledge 的 activates_on:
  - show_content_when 含 "program" → 完整加载，进入 Context
  - show_description_when 含 "program" → 仅描述出现
  ↓
LLM 看到激活的知识，进行下一步思考
  ↓
submit / close 后，本次 form 引入的 knowledge 自动卸载
\`\`\`

也可以手动激活：
- LLM 调用 open(type=knowledge, path=...) 显式加载某篇 knowledge
- 这种"手动 pin"的 knowledge 不随 form 关闭而卸载，需 close(type=knowledge, ...) 显式卸载

# 子线程知识自动继承：

子线程的 Context 中可见的 knowledge = 沿线程树向上收集的"已激活 knowledge 文档" 集合。

\`\`\`
根线程 (激活: A.md, B.md)
   ↓
子线程 (激活: C.md)
   ↓
孙线程 (激活: D.md)
\`\`\`

孙线程的 Context 中可见 knowledge = {A, B, C, D}。

意义：父线程的能力对子线程透明继承；子线程的私有激活不污染父/兄。

# 特殊知识类型：

- relations/{objectId}.md
    - 描述与某个具体其他 Object 的关系
    - 由 talk 等协作过程自动维护或 Object 主动编辑
    - 详见 collaborable/relation

- memory/index.md
    - 长期记忆索引页，跨任务持久存在
    - 通过 super 分身的 SuperFlow 写入（详见 reflectable 文档）
    - 进入 Context 的入口由 context-builder 控制（截尾上限保护）

# knowledge 的来源：

1. kernel/knowledge/ — 系统内置
2. stones/{name}/knowledge/ — Object 自己创建或沉淀
3. flows/{sessionId}/objects/{name}/knowledge/ — Object 在 flow 中创建或沉淀

Object 通过专门的反思通道持续累积自己的持久 knowledge （详见 reflectable）。

# 当前实现阶段

当前实现覆盖：

- **加载源**：仅 stones/{objectId}/knowledge/（kernel/knowledge/ 与 flow 第二来源未接入）
- **路径 ID**：相对 knowledge/ 的路径，不带 .md 后缀（例：build-tools/file-ops、memory/index）。frontmatter 的 filename 字段作文档化字段，以文件路径为准
- **激活时机**：每轮 buildContext 懒求值（无 thread 上的派生状态字段）
- **激活规则**：activates_on.show_content_when 与 union(所有 activeForms.commandPaths) ∩ ≠ ∅ → full；show_description_when 命中 → summary；同时命中 full 优先
- **手动 pin**：open(type=knowledge, path=X) 写到 thread.pinnedKnowledge，永远 full 渲染；当前 executable 里的 close 只支持关闭 form，不支持按 knowledge path 卸载 pin
- **热重载**：loader 按 "文件路径+mtime" 签名缓存，Agent 编辑 .md 后下一轮 think 立即生效
- **上限**：单篇 full 内容 8KB 截断；激活集合超 20 项截尾

补充当前实现细节：

- pinned knowledge 的优先级高于 command path 自动激活；同一篇知识若已被 pin，就不会再以 summary/full 自动激活覆盖它。
- 当前 activator 的顺序可以理解为：先放 pinned(full)，再根据 activeForms.commandPaths 追加 command-path 命中的 full，最后补 summary，并整体做去重与数量上限控制。

当前不实现：

- 跨线程继承（子线程 context 不含父链激活的 knowledge）
- kernel/ 与 flow/knowledge/ 第二来源
- .knowledge.json 配置（声明引用、外部源等）
- knowledge 版本化 / git 历史
- 基于 thread.status、events 等非 commandPath 的激活条件
`,
};
