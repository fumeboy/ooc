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
- knowledgeSources — knowledge 的三类来源（kernel / library / stone or flow）
- implementation — 当前实现的覆盖范围与边界
`,

  model_v20260517_1: {
    index: `
## 文档结构

每篇 knowledge = 一个 markdown 文档 + yaml frontmatter。详见子节点：
模板、字段语义、command 路径示例、filename 与 path 的二者关系。
`,

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
`,
    },

    fieldSemantics_v20260517_1: {
      index: `
### 字段语义

- filename — 文件名，与 knowledgeId 一致；用于在 Context 中引用该知识
  （例：open(type=knowledge, path=/path/xxx.md) 加载 xxx.md）
- title — 知识文档标题
- description — 一句话描述
- activates_on — 渐进式披露的核心：根据 form 中 command 路径决定何时进入 Context
`,
    },

    descriptionOnlyMode_v20260517_1: {
      index: `
### description-only 模式

knowledge 可见但未激活时，仅 description 出现在 Context；让 LLM 知道"有这篇知识，
需要时可 open 加载完整内容"。

这是 Context 体积控制的核心机制——大量长篇 knowledge 平时仅以一行描述出现，
点开才下沉到完整正文。
`,
    },

    activatesOnSemantics_v20260517_1: {
      index: `
### activates_on 二档

- show_description_when — 命中时仅注入 description（轻量提示）
- show_content_when — 命中时注入完整正文（重量加载）

两个集合可独立配置。同篇 knowledge 同时命中两档时，full 优先（见
activatorImpl_v20260517_1）。
`,
    },

    commandPathExamples_v20260517_1: {
      index: `
### command 路径示例

[program] / [talk, end] / [do, plan]

路径来自 form 在 thread.contextWindows 中的 commandPaths，匹配规则见 activation 子节点。
`,
    },

    filenameVsPath_v20260517_1: {
      index: `
### filename 字段与文件路径的关系

frontmatter.filename 仅作文档化字段——loader 实际以**文件路径**为 knowledgeId 真源
（详见 implementation.loaderImpl）。

不变量：filename 与文件名不一致时，path 胜出；不抛错（保持热重载温和性）。
`,
    },
  },

  layout_v20260517_1: {
    index: `
## 物理布局

详见子节点：stone 布局示意、flow 同构布局。
`,

    stoneLayout_v20260517_1: {
      index: `
### stone 下的物理布局

\`\`\`
stones/{name}/knowledge/
├── .knowledge.json           知识库配置（声明引用、外部源等）
├── memory/                   长期记忆（详见 reflectable 文档）
│   └── index.md              记忆索引页 + 最近记忆
├── relations/                关系文档
│   └── {objectId}.md         和某个其他 Object 的关系文档
└── **/*.md                   其他知识文档（任意子目录组织）
\`\`\`
`,
    },

    flowLayoutIsomorphic_v20260517_1: {
      index: `
### flow 同构布局

flow 目录下具有同构的 knowledge 目录结构（flows/{sessionId}/objects/{name}/knowledge/），
让 stone 与 flow 来源可以走同一套 loader 路径处理（详见 persistable 文档）。
`,
    },
  },

  activation_v20260517_1: {
    index: `
## 激活机制（与 form 联动）

分子节点：自动激活流程、手动 pin 通道、submit/close 自动卸载、手动 pin 与自动激活
的生命周期差异。
`,

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
\`\`\`
`,
    },

    autoUnload_v20260517_1: {
      index: `
### form 关闭自动卸载

submit / close 后，本次 form 引入的 knowledge 自动卸载（不再出现在下一轮 Context）。

设计原因：knowledge 渲染体积与 form 寿命挂钩——form 是一次性子任务，结束即清理，
避免 context 中堆积陈旧知识。
`,
    },

    manualPin_v20260517_1: {
      index: `
### 手动 pin 通道

LLM 可调 open(type=knowledge, path=...) 显式加载某篇 knowledge。
`,
    },

    manualPinLifecycle_v20260517_1: {
      index: `
### 手动 pin 的生命周期

"手动 pin"的 knowledge **不**随 form 关闭而卸载；需 close(type=knowledge, ...)
显式卸载。

这与 form 内自动激活的 knowledge 形成对比：
- 自动激活：form 关闭即随之卸载
- 手动 pin：与 form 解耦，跨 form 持续存在

适用场景：跨多个 form 都需要参考的长期知识（如某项目的总体架构文档）。
`,
    },
  },

  inheritance_v20260517_1: {
    index: `
## 子线程知识自动继承

分子节点：继承拓扑、设计意义、当前实现差距。
`,

    inheritanceTopology_v20260517_1: {
      index: `
### 继承拓扑

子线程的 Context 中可见的 knowledge = 沿线程树向上收集的"已激活 knowledge 文档"集合。

\`\`\`
根线程 (激活: A.md, B.md)
   ↓
子线程 (激活: C.md)
   ↓
孙线程 (激活: D.md)
\`\`\`

孙线程的 Context 中可见 knowledge = {A, B, C, D}。
`,
    },

    inheritanceRationale_v20260517_1: {
      index: `
### 设计意义

- 父线程的能力对子线程透明继承（不用每个子线程重新激活）
- 子线程的私有激活**不**污染父 / 兄线程
- 形成"知识从根向叶单向流动"的语义清洁性
`,
    },

    inheritanceImplGap_v20260517_1: {
      index: `
### 当前实现差距

inheritance 当前**未在 activator 实现**——子线程的 context 仅含本线程激活的 knowledge，
不沿父链继承（详见 implementation.uncovered 中"跨线程继承"条目）。

文档保留语义定义供后续 implementation 对齐。
`,
    },
  },

  specialKinds_v20260517_1: {
    index: `
## 特殊知识类型

两类：relations 与 memory。详见子节点。
`,

    relations_v20260517_1: {
      index: `
### relations/{objectId}.md

描述与某个具体其他 Object 的关系；由 talk 等协作过程自动维护或 Object 主动编辑。
详见 collaborable/relation。
`,
    },

    memory_v20260517_1: {
      index: `
### memory/index.md

长期记忆索引页，跨任务持久存在；通过 super 分身的 SuperFlow 写入（详见 reflectable）。
`,
    },

    memoryEntryControl_v20260517_1: {
      index: `
### memory 进入 Context 的入口控制

memory/index.md 进入 Context 由 context-builder 控制并加截尾上限保护。

设计原因：memory 会单调增长，无控制会撑爆 system prompt。截尾策略让"最近记忆"
优先保留，旧记忆压缩到 index 页摘要中（详见 reflectable）。
`,
    },
  },

  knowledgeSources_v20260517_1: {
    index: `
## knowledge 的来源

分子节点：三类来源、累积通道。
`,

    threeSources_v20260517_1: {
      index: `
### 三类来源

1. kernel/knowledge/ — 系统内置
2. stones/{name}/knowledge/ — Object 自己创建或沉淀
3. flows/{sessionId}/objects/{name}/knowledge/ — Object 在 flow 中创建或沉淀
`,
    },

    accumulationChannel_v20260517_1: {
      index: `
### 累积通道

Object 通过专门的反思通道持续累积自己的持久 knowledge（详见 reflectable）。

普通 Flow 内沉淀的 knowledge 落在 flows/ 路径（临时），反思通道沉淀的落在 stones/
路径（持久跨 Flow）。
`,
    },
  },

  implementation_v20260517_1: {
    index: `
## 实现覆盖与边界

按子节点展开：loader / activator / 上限 / 未覆盖范围。
`,

    loaderImpl_v20260517_1: {
      index: `
### 加载与解析

详见子节点：当前加载源、knowledgeId 规则、热重载缓存策略。
`,

      currentLoaderSource_v20260517_1: {
        index: `
#### 当前加载源

加载源仅 stones/{objectId}/knowledge/。kernel/knowledge/ 与 flow 第二来源未接入
（详见 uncovered_v20260517_1）。
`,
      },

      knowledgeIdRule_v20260517_1: {
        index: `
#### knowledgeId 规则

路径 ID = 相对 knowledge/ 的路径，**不带 .md 后缀**。
例：build-tools/file-ops / memory/index。

frontmatter.filename 仅作文档化字段，以文件路径为准（见
model.filenameVsPath_v20260517_1）。
`,
      },

      hotReloadCache_v20260517_1: {
        index: `
#### 热重载缓存

loader 按 "文件路径+mtime" 签名缓存；Agent 编辑 .md 后下一轮 think 立即生效。

不变量：mtime 不变 → 命中缓存，不重新 parse。这让大知识库下的每轮 think 仍能保持
低延迟。
`,
      },
    },

    activatorImpl_v20260517_1: {
      index: `
### 激活算法

详见子节点：求值时机、命中规则、排序与去重、20 项上限。
`,

      lazyEval_v20260517_1: {
        index: `
#### 求值时机：懒求值

每轮 buildContext 懒求值——不在 thread 上维持任何派生状态字段。
设计原因：activator 命中条件依赖 thread.contextWindows 当前快照，缓存反而易过期。
`,
      },

      hitRule_v20260517_1: {
        index: `
#### 命中规则

命中规则：activates_on.show_content_when 与 union(thread.contextWindows 中
type=command_exec 的 commandPaths) 交集非空 → full；show_description_when 命中 →
summary。
`,
      },

      fullPriorityOnConflict_v20260517_1: {
        index: `
#### 不变量：full 与 summary 同时命中时 full 优先

同篇 knowledge 同轮被 show_content_when 与 show_description_when 同时命中时，
取 full（完整正文），不再额外渲染 summary。

避免同一篇出现两份（一份描述 + 一份正文）的冗余。
`,
      },

      ordering_v20260517_1: {
        index: `
#### 顺序与去重

activator 先放 full 命中、再补 summary 命中，整体去重并执行 20 项上限。

不变量：顺序稳定（同输入产同输出），便于 snapshot 测试。
`,
      },
    },

    limits_v20260517_1: {
      index: `
### 上限

详见子节点：单篇正文截断、激活集合数量上限。
`,

      bodyTruncation8KB_v20260517_1: {
        index: `
#### 单篇 full 内容 8KB 截断

单篇 full 内容超 8KB 时被截断渲染。
（与 file window 32KB 截断对比：knowledge 通常是高频参考材料，更小阈值控制总体体积。）
`,
      },

      setSizeLimit20_v20260517_1: {
        index: `
#### 激活集合数量上限 20 项

激活集合超 20 项时截尾（保留排序靠前的 20 个，丢弃其余）。

设计原因：避免某轮 commandPath 命中大量 knowledge 时一次性塞爆 context。
20 是经验值——足以覆盖常规子任务，又能阻断异常激活。
`,
      },
    },

    uncovered_v20260517_1: {
      index: `
### 不在当前覆盖范围

按子节点列出各项未实现的能力。
`,

      crossThreadInheritance_v20260517_1: {
        index: `
#### 跨线程继承

子线程 context 不含父链激活的 knowledge（与 inheritance 子节点定义的语义存在差距）。
`,
      },

      secondarySources_v20260517_1: {
        index: `
#### kernel/ 与 flow/knowledge/ 第二来源

当前 loader 只扫 stones/ 路径，kernel/knowledge/ 与 flows/{sid}/objects/{name}/knowledge/
未接入。
`,
      },

      knowledgeJsonConfig_v20260517_1: {
        index: `
#### .knowledge.json 配置

声明引用、外部源等元配置当前不被消费。
`,
      },

      versioning_v20260517_1: {
        index: `
#### knowledge 版本化 / git 历史

不追踪 knowledge 的修改历史；Object 看到的永远是当前 mtime 下的内容。
`,
      },

      nonCommandPathActivation_v20260517_1: {
        index: `
#### 基于非 commandPath 的激活条件

不支持基于 thread.status、events 等其他维度的激活规则；当前仅 commandPath 维度。
`,
      },

      explicitPinEntry_v20260517_1: {
        index: `
#### 显式 pin 入口

pin 概念通过 knowledge_window 表达，目前不存在显式 pin 入口（activation.manualPin
子节点定义的入口尚未实装）。
`,
      },
    },
  },
};
