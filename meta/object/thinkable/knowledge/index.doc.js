import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as knowledgeTypes from "@src/thinkable/knowledge/types";
import * as knowledgeParser from "@src/thinkable/knowledge/parser";
import * as knowledgeLoader from "@src/thinkable/knowledge/loader";
import * as knowledgeActivator from "@src/thinkable/knowledge/activator";
import * as knowledgeIndex from "@src/thinkable/knowledge/index";

/**
 * Knowledge 概念：Object 持有的 markdown 知识文档与按 command 路径的渐进式激活。
 *
 * sources:
 *  - types     — Knowledge / KnowledgeFrontmatter schema 与 activates_on 字段
 *  - parser    — frontmatter + body 解析
 *  - loader    — 文件系统扫描 + 按 mtime 签名的热重载缓存
 *  - activator — 根据 thread.contextWindows 计算激活集合
 *  - index     — re-export 入口
 */
export const knowledge_v20260505_1 = {
  name: "Knowledge",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    types: knowledgeTypes,
    parser: knowledgeParser,
    loader: knowledgeLoader,
    activator: knowledgeActivator,
    index: knowledgeIndex,
  },
  description: `
Knowledge 是 Object 拥有的 markdown 知识文档，按 command 路径渐进式激活进入 Context。

按子字段展开：

- model — 单篇 knowledge 的文档结构（frontmatter + body）
- layout — knowledge 在文件系统中的物理布局
- activation — 渐进式披露规则与与 form 的联动
- inheritance — 子线程沿线程树继承父链激活集合
- specialKinds — relations / memory 两种特殊知识
- sources — knowledge 的三类来源（kernel / library / stone or flow）
- implementation — 当前实现的覆盖范围与边界
`.trim(),

  model_v20260517_1: {
    index: `
## 文档结构

每篇 knowledge = 一个 markdown 文档 + yaml frontmatter。详见三个子节点：
模板、字段语义、command 路径示例。
`.trim(),

    template_v20260517_1: {
      index: `
### 模板

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
`.trim(),
    },

    fieldSemantics_v20260517_1: {
      index: `
### 字段语义

- \`filename\` — 文件名，与 knowledgeId 一致；用于在 Context 中引用该知识
  （例：\`open(type=knowledge, path=/path/xxx.md)\` 加载 xxx.md）
- \`title\` — 知识文档标题
- \`description\` — 一句话描述；可见但未激活时仅 description 出现在 Context，让 LLM 知道
  "有这篇知识，需要时可 open 加载完整内容"
- \`activates_on\` — 渐进式披露的核心：根据 form 中 command 路径决定何时进入 Context
  - \`show_description_when\` — 命中时仅注入 description（轻量提示）
  - \`show_content_when\` — 命中时注入完整正文（重量加载）
`.trim(),
    },

    commandPathExamples_v20260517_1: {
      index: `
### command 路径示例

\`[program]\` / \`[talk, end]\` / \`[do, plan]\`

路径来自 form 在 thread.contextWindows 中的 \`commandPaths\`，
匹配规则见 activation 子节点。
`.trim(),
    },
  },

  layout_v20260517_1: {
    index: `
## 物理布局

以 stone 为例（flow 目录下也具有同构的 knowledge 目录，详见 persistable 文档）：

\`\`\`
stones/{name}/knowledge/
├── .knowledge.json           知识库配置（声明引用、外部源等）
├── memory/                   长期记忆（详见 reflectable 文档）
│   └── index.md              记忆索引页 + 最近记忆
├── relations/                关系文档
│   └── {objectId}.md         和某个其他 Object 的关系文档
└── **/*.md                   其他知识文档（任意子目录组织）
\`\`\`
`.trim(),
  },

  activation_v20260517_1: {
    index: `
## 激活机制（与 form 联动）

分两个子节点：自动激活流程、手动 pin 通道。
`.trim(),

    autoFlow_v20260517_1: {
      index: `
### 自动激活流程

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
`.trim(),
    },

    manualPin_v20260517_1: {
      index: `
### 手动 pin 通道

LLM 可调 \`open(type=knowledge, path=...)\` 显式加载某篇 knowledge。
这种"手动 pin"的 knowledge 不随 form 关闭而卸载，
需 \`close(type=knowledge, ...)\` 显式卸载。
`.trim(),
    },
  },

  inheritance_v20260517_1: {
    index: `
## 子线程知识自动继承

子线程的 Context 中可见的 knowledge = 沿线程树向上收集的"已激活 knowledge 文档"集合。

\`\`\`
根线程 (激活: A.md, B.md)
   ↓
子线程 (激活: C.md)
   ↓
孙线程 (激活: D.md)
\`\`\`

孙线程的 Context 中可见 knowledge = {A, B, C, D}。

意义：父线程的能力对子线程透明继承；子线程的私有激活不污染父 / 兄。
`.trim(),
  },

  specialKinds_v20260517_1: {
    index: `
## 特殊知识类型

两类：relations 与 memory。详见子节点。
`.trim(),

    relations_v20260517_1: {
      index: `
### relations/{objectId}.md

描述与某个具体其他 Object 的关系；由 talk 等协作过程自动维护或 Object 主动编辑。
详见 collaborable/relation。
`.trim(),
    },

    memory_v20260517_1: {
      index: `
### memory/index.md

长期记忆索引页，跨任务持久存在；通过 super 分身的 SuperFlow 写入
（详见 reflectable）。进入 Context 的入口由 context-builder 控制
（截尾上限保护）。
`.trim(),
    },
  },

  sources_v20260517_1: {
    index: `
## knowledge 的来源

1. \`kernel/knowledge/\` — 系统内置
2. \`stones/{name}/knowledge/\` — Object 自己创建或沉淀
3. \`flows/{sessionId}/objects/{name}/knowledge/\` — Object 在 flow 中创建或沉淀

Object 通过专门的反思通道持续累积自己的持久 knowledge（详见 reflectable）。
`.trim(),
  },

  implementation_v20260517_1: {
    index: `
## 实现覆盖与边界

按子节点展开：loader / activator / 上限 / 未覆盖范围。
`.trim(),

    loaderImpl_v20260517_1: {
      index: `
### 加载与解析

- 加载源仅 \`stones/{objectId}/knowledge/\`（kernel/knowledge/ 与 flow 第二来源未接入）
- 路径 ID = 相对 knowledge/ 的路径，不带 .md 后缀
  （例：\`build-tools/file-ops\` / \`memory/index\`）；frontmatter \`filename\` 字段作
  文档化字段，以文件路径为准
- 热重载：loader 按 "文件路径+mtime" 签名缓存；Agent 编辑 .md 后下一轮 think 立即生效
`.trim(),
    },

    activatorImpl_v20260517_1: {
      index: `
### 激活算法

- 每轮 buildContext 懒求值（无 thread 上的派生状态字段）
- 命中规则：\`activates_on.show_content_when\` 与 \`union(thread.contextWindows 中
  type=command_exec 的 commandPaths)\` 交集非空 → full；\`show_description_when\` 命中 →
  summary；同时命中时 full 优先
- 顺序：activator 先放 full 命中、再补 summary 命中，整体去重并执行 20 项上限
`.trim(),
    },

    limits_v20260517_1: {
      index: `
### 上限

- 单篇 full 内容 8KB 截断
- 激活集合超 20 项截尾
`.trim(),
    },

    uncovered_v20260517_1: {
      index: `
### 不在当前覆盖范围

- 跨线程继承（子线程 context 不含父链激活的 knowledge）
- kernel/ 与 flow/knowledge/ 第二来源
- \`.knowledge.json\` 配置（声明引用、外部源等）
- knowledge 版本化 / git 历史
- 基于 thread.status、events 等非 commandPath 的激活条件
- 显式 pin 通道（pin 概念通过 knowledge_window 表达，目前不存在显式 pin 入口）
`.trim(),
    },
  },
};
