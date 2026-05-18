import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as knowledgeTypes from "@src/thinkable/knowledge/types";
import * as knowledgeParser from "@src/thinkable/knowledge/parser";
import * as knowledgeLoader from "@src/thinkable/knowledge/loader";
import * as knowledgeActivator from "@src/thinkable/knowledge/activator";
import * as knowledgeIndex from "@src/thinkable/knowledge/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Knowledge 概念骨架
 * ──────────────────────────────────────────────────────────────── */

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
export type KnowledgeConcept = Concept & {
  sources: {
    types: typeof knowledgeTypes;
    parser: typeof knowledgeParser;
    loader: typeof knowledgeLoader;
    activator: typeof knowledgeActivator;
    index: typeof knowledgeIndex;
  };

  /** 单篇 knowledge 的文档结构（frontmatter + body） */
  model: {
    title: string;
    summary?: string;
    /** 模板示例 */
    template: ExampleNode;
    fieldSemantics: DocNode;
    descriptionOnlyMode: DocNode;
    activatesOnSemantics: DocNode;
    commandPathExamples: DocNode;
    /** filename 字段与文件名不一致时 path 胜出 */
    filenameVsPath: InvariantNode;
  };

  /** knowledge 在文件系统中的物理布局 */
  layout: {
    title: string;
    summary?: string;
    stoneLayout: ExampleNode;
    flowLayoutIsomorphic: DocNode;
  };

  /** 渐进式披露规则与与 form 的联动 */
  activation: {
    title: string;
    summary?: string;
    autoFlow: ExampleNode;
    autoUnload: DocNode;
    manualPin: DocNode;
    manualPinLifecycle: DocNode;
  };

  /** 子线程沿线程树继承父链激活集合 */
  inheritance: {
    title: string;
    summary?: string;
    inheritanceTopology: ExampleNode;
    inheritanceRationale: DocNode;
    inheritanceImplGap: DocNode;
  };

  /** relations / memory 两种特殊知识 */
  specialKinds: {
    title: string;
    summary?: string;
    relations: DocNode;
    memory: DocNode;
    memoryEntryControl: DocNode;
  };

  /** knowledge 的三类来源 */
  knowledgeSources: {
    title: string;
    summary?: string;
    threeSources: DocNode;
    accumulationChannel: DocNode;
  };

  /** 当前实现的覆盖范围与边界 */
  implementation: {
    title: string;
    summary?: string;
    loaderImpl: {
      title: string;
      summary?: string;
      currentLoaderSource: DocNode;
      knowledgeIdRule: DocNode;
      /** mtime 不变即命中缓存 */
      hotReloadCache: InvariantNode;
    };
    activatorImpl: {
      title: string;
      summary?: string;
      lazyEval: DocNode;
      hitRule: DocNode;
      /** full 与 summary 同时命中时 full 优先 */
      fullPriorityOnConflict: InvariantNode;
      /** 排序稳定 */
      ordering: InvariantNode;
    };
    limits: {
      title: string;
      summary?: string;
      /** 单篇正文 8KB 截断 */
      bodyTruncation8KB: InvariantNode;
      /** 激活集合 20 项上限 */
      setSizeLimit20: InvariantNode;
    };
    uncovered: {
      title: string;
      summary?: string;
      crossThreadInheritance: DocNode;
      secondarySources: DocNode;
      knowledgeJsonConfig: DocNode;
      versioning: DocNode;
      nonCommandPathActivation: DocNode;
      explicitPinEntry: DocNode;
    };
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const knowledge_v20260505_1: KnowledgeConcept = {
  name: "Knowledge",
  get parent() {
    return thinkable_v20260504_1;
  },
  sources: {
    types: knowledgeTypes,
    parser: knowledgeParser,
    loader: knowledgeLoader,
    activator: knowledgeActivator,
    index: knowledgeIndex,
  },
  description: `
Knowledge 是 Object 拥有的 markdown 知识文档，按 command 路径渐进式激活进入 Context。

每篇 knowledge = 一份 markdown 正文 + yaml frontmatter；frontmatter 中的
\`activates_on\` 决定何时仅以 description 出现、何时展开完整正文。
`.trim(),

  model: {
    title: "文档结构",
    summary: "frontmatter + body，按 activates_on 渐进披露",

    template: {
      kind: "example",
      title: "模板",
      content: `
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

    fieldSemantics: {
      title: "字段语义",
      content: `
- filename — 文件名，与 knowledgeId 一致；用于在 Context 中引用该知识
  （例：open(type=knowledge, path=/path/xxx.md) 加载 xxx.md）
- title — 知识文档标题
- description — 一句话描述
- activates_on — 渐进式披露的核心：根据 form 中 command 路径决定何时进入 Context
      `.trim(),
    },

    descriptionOnlyMode: {
      title: "description-only 模式",
      content: `
knowledge 可见但未激活时，仅 description 出现在 Context；让 LLM 知道「有这篇知识，
需要时可 open 加载完整内容」。

这是 Context 体积控制的核心机制——大量长篇 knowledge 平时仅以一行描述出现，
点开才下沉到完整正文。
      `.trim(),
    },

    activatesOnSemantics: {
      title: "activates_on 二档",
      content: `
- show_description_when — 命中时仅注入 description（轻量提示）
- show_content_when — 命中时注入完整正文（重量加载）

两个集合可独立配置。同篇 knowledge 同时命中两档时，full 优先
（见 implementation.activatorImpl.fullPriorityOnConflict）。
      `.trim(),
    },

    commandPathExamples: {
      title: "command 路径示例",
      content: `
[program] / [talk, end] / [do, plan]

路径来自 form 在 thread.contextWindows 中的 commandPaths，匹配规则见 activation 子节点。
      `.trim(),
    },

    filenameVsPath: {
      kind: "invariant",
      title: "filename 与文件名不一致时 path 胜出",
      summary: "loader 以文件路径为 knowledgeId 真源；filename 仅文档化",
      content:
        "frontmatter.filename 仅作文档化字段——loader 实际以文件路径为 knowledgeId 真源（详见 implementation.loaderImpl）。filename 与文件名不一致时不抛错，path 胜出。",
      rationale:
        "保持热重载温和性——文件移动 / 改名常见，强校验会让 reload 频繁失败；以路径为真源避免 frontmatter 漂移污染 ID。",
    },
  },

  layout: {
    title: "物理布局",
    summary: "stones/{name}/knowledge/ 与 flows/{sid}/objects/{name}/knowledge/ 同构",

    stoneLayout: {
      kind: "example",
      title: "stone 下的物理布局",
      content: `
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

    flowLayoutIsomorphic: {
      title: "flow 同构布局",
      content: `
flow 目录下具有同构的 knowledge 目录结构（flows/{sessionId}/objects/{name}/knowledge/），
让 stone 与 flow 来源可以走同一套 loader 路径处理（详见 persistable 文档）。
      `.trim(),
    },
  },

  activation: {
    title: "激活机制（与 form 联动）",
    summary: "自动激活随 form 寿命，手动 pin 跨 form 持续",

    autoFlow: {
      kind: "example",
      title: "自动激活流程",
      content: `
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
      `.trim(),
    },

    autoUnload: {
      title: "form 关闭自动卸载",
      content: `
submit / close 后，本次 form 引入的 knowledge 自动卸载（不再出现在下一轮 Context）。

设计原因：knowledge 渲染体积与 form 寿命挂钩——form 是一次性子任务，结束即清理，
避免 context 中堆积陈旧知识。
      `.trim(),
    },

    manualPin: {
      title: "手动 pin 通道",
      content: "LLM 可调 open(type=knowledge, path=...) 显式加载某篇 knowledge。",
    },

    manualPinLifecycle: {
      title: "手动 pin 的生命周期",
      content: `
「手动 pin」的 knowledge **不**随 form 关闭而卸载；需 close(type=knowledge, ...)
显式卸载。

这与 form 内自动激活的 knowledge 形成对比：
- 自动激活：form 关闭即随之卸载
- 手动 pin：与 form 解耦，跨 form 持续存在

适用场景：跨多个 form 都需要参考的长期知识（如某项目的总体架构文档）。
      `.trim(),
    },
  },

  inheritance: {
    title: "子线程知识自动继承",
    summary: "孙线程 = 沿线程树向上收集的「已激活 knowledge」并集",

    inheritanceTopology: {
      kind: "example",
      title: "继承拓扑",
      content: `
\`\`\`
根线程 (激活: A.md, B.md)
   ↓
子线程 (激活: C.md)
   ↓
孙线程 (激活: D.md)
\`\`\`

孙线程的 Context 中可见 knowledge = {A, B, C, D}。
      `.trim(),
    },

    inheritanceRationale: {
      title: "设计意义",
      content: `
- 父线程的能力对子线程透明继承（不用每个子线程重新激活）
- 子线程的私有激活**不**污染父 / 兄线程
- 形成「知识从根向叶单向流动」的语义清洁性
      `.trim(),
    },

    inheritanceImplGap: {
      title: "当前实现差距",
      content: `
inheritance 当前**未在 activator 实现**——子线程的 context 仅含本线程激活的 knowledge，
不沿父链继承（详见 implementation.uncovered 中「跨线程继承」条目）。

文档保留语义定义供后续 implementation 对齐。
      `.trim(),
    },
  },

  specialKinds: {
    title: "特殊知识类型",
    summary: "relations 描述协作关系，memory/index 承载长期记忆",

    relations: {
      title: "relations/{objectId}.md",
      content: `
描述与某个具体其他 Object 的关系；由 talk 等协作过程自动维护或 Object 主动编辑。
详见 collaborable/relation。
      `.trim(),
    },

    memory: {
      title: "memory/index.md",
      content:
        "长期记忆索引页，跨任务持久存在；通过 super 分身的 SuperFlow 写入（详见 reflectable）。",
    },

    memoryEntryControl: {
      title: "memory 进入 Context 的入口控制",
      content: `
memory/index.md 进入 Context 由 context-builder 控制并加截尾上限保护。

设计原因：memory 会单调增长，无控制会撑爆 system prompt。截尾策略让「最近记忆」
优先保留，旧记忆压缩到 index 页摘要中（详见 reflectable）。
      `.trim(),
    },
  },

  knowledgeSources: {
    title: "knowledge 的来源",
    summary: "kernel 内置 / stone 沉淀 / flow 临时三类",

    threeSources: {
      title: "三类来源",
      content: `
1. kernel/knowledge/ — 系统内置
2. stones/{name}/knowledge/ — Object 自己创建或沉淀
3. flows/{sessionId}/objects/{name}/knowledge/ — Object 在 flow 中创建或沉淀
      `.trim(),
    },

    accumulationChannel: {
      title: "累积通道",
      content: `
Object 通过专门的反思通道持续累积自己的持久 knowledge（详见 reflectable）。

普通 Flow 内沉淀的 knowledge 落在 flows/ 路径（临时），反思通道沉淀的落在 stones/
路径（持久跨 Flow）。
      `.trim(),
    },
  },

  implementation: {
    title: "实现覆盖与边界",
    summary: "loader / activator / 上限 / 未覆盖范围四块",

    loaderImpl: {
      title: "加载与解析",
      summary: "stones/{id}/knowledge 单源 + path 为 ID + mtime 缓存",

      currentLoaderSource: {
        title: "当前加载源",
        content: `
加载源仅 stones/{objectId}/knowledge/。kernel/knowledge/ 与 flow 第二来源未接入
（详见 uncovered.secondarySources）。
        `.trim(),
      },

      knowledgeIdRule: {
        title: "knowledgeId 规则",
        content: `
路径 ID = 相对 knowledge/ 的路径，**不带 .md 后缀**。
例：build-tools/file-ops / memory/index。

frontmatter.filename 仅作文档化字段，以文件路径为准（见 model.filenameVsPath）。
        `.trim(),
      },

      hotReloadCache: {
        kind: "invariant",
        title: "mtime 不变即命中缓存",
        summary: "loader 按「文件路径+mtime」签名缓存，避免重复 parse",
        content:
          "loader 按「文件路径+mtime」签名缓存；Agent 编辑 .md 后下一轮 think 立即生效。mtime 不变 → 命中缓存，不重新 parse。",
        rationale: "让大知识库下的每轮 think 仍能保持低延迟；mtime 已足够检测变更。",
      },
    },

    activatorImpl: {
      title: "激活算法",
      summary: "懒求值 + 集合命中 + 排序稳定 + 20 项上限",

      lazyEval: {
        title: "求值时机：懒求值",
        content: `
每轮 buildContext 懒求值——不在 thread 上维持任何派生状态字段。
设计原因：activator 命中条件依赖 thread.contextWindows 当前快照，缓存反而易过期。
        `.trim(),
      },

      hitRule: {
        title: "命中规则",
        content: `
命中规则：activates_on.show_content_when 与 union(thread.contextWindows 中
type=command_exec 的 commandPaths) 交集非空 → full；show_description_when 命中 →
summary。
        `.trim(),
      },

      fullPriorityOnConflict: {
        kind: "invariant",
        title: "full 与 summary 同时命中时 full 优先",
        summary: "不再额外渲染 summary，避免一篇出两份",
        content:
          "同篇 knowledge 同轮被 show_content_when 与 show_description_when 同时命中时，取 full（完整正文），不再额外渲染 summary。",
        rationale: "避免同一篇出现两份（一份描述 + 一份正文）的冗余渲染。",
      },

      ordering: {
        kind: "invariant",
        title: "顺序稳定",
        summary: "同输入产同输出，便于 snapshot 测试",
        content:
          "activator 先放 full 命中、再补 summary 命中，整体去重并执行 20 项上限。同输入产同输出。",
        rationale: "snapshot 测试可复现；避免随机顺序导致难追踪的回归。",
      },
    },

    limits: {
      title: "上限",
      summary: "单篇 8KB / 集合 20 项两条硬上限",

      bodyTruncation8KB: {
        kind: "invariant",
        title: "单篇 full 内容 8KB 截断",
        summary: "超 8KB 时截断渲染",
        content:
          "单篇 full 内容超 8KB 时被截断渲染。（与 file window 32KB 截断对比：knowledge 通常是高频参考材料，更小阈值控制总体体积。）",
        rationale:
          "激活集合最多 20 项，单篇必须有上限避免 system prompt 总体积爆炸；8KB 足够承载典型说明文档。",
      },

      setSizeLimit20: {
        kind: "invariant",
        title: "激活集合数量上限 20 项",
        summary: "超 20 项时截尾保留排序靠前的",
        content:
          "激活集合超 20 项时截尾（保留排序靠前的 20 个，丢弃其余）。",
        rationale:
          "避免某轮 commandPath 命中大量 knowledge 时一次性塞爆 context。20 是经验值——足以覆盖常规子任务，又能阻断异常激活。",
      },
    },

    uncovered: {
      title: "不在当前覆盖范围",
      summary: "6 条未实现能力的留档",

      crossThreadInheritance: {
        title: "跨线程继承",
        content:
          "子线程 context 不含父链激活的 knowledge（与 inheritance 子节点定义的语义存在差距）。",
      },

      secondarySources: {
        title: "kernel/ 与 flow/knowledge/ 第二来源",
        content: `
当前 loader 只扫 stones/ 路径，kernel/knowledge/ 与 flows/{sid}/objects/{name}/knowledge/
未接入。
        `.trim(),
      },

      knowledgeJsonConfig: {
        title: ".knowledge.json 配置",
        content: "声明引用、外部源等元配置当前不被消费。",
      },

      versioning: {
        title: "knowledge 版本化 / git 历史",
        content: "不追踪 knowledge 的修改历史；Object 看到的永远是当前 mtime 下的内容。",
      },

      nonCommandPathActivation: {
        title: "基于非 commandPath 的激活条件",
        content:
          "不支持基于 thread.status、events 等其他维度的激活规则；当前仅 commandPath 维度。",
      },

      explicitPinEntry: {
        title: "显式 pin 入口",
        content: `
pin 概念通过 knowledge_window 表达，目前不存在显式 pin 入口（activation.manualPin
子节点定义的入口尚未实装）。
        `.trim(),
      },
    },
  },
};
