import type { Concept, DocNode } from "@meta/doc-types";
import * as knowledge from "@src/thinkable/knowledge/index";
import * as executable from "@src/executable/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：knowledge 按 commandPaths 渐进式激活
 * ──────────────────────────────────────────────────────────────── */

/**
 * KnowledgeActivation 概念：knowledge 如何按 commandPaths 与 window 类型动态激活进入 context。
 *
 * sources:
 *  - knowledge  — computeActivations / loadKnowledgeIndex
 *  - executable — collectExecutableKnowledgeEntries 合成 KnowledgeWindow 的入口
 */
export type KnowledgeActivationConcept = Concept & {
  sources: {
    knowledge: typeof knowledge;
    executable: typeof executable;
  };

  /** knowledge entries 的 3 类来源 */
  sourcesEntry: DocNode & {
    protocol: DocNode & {
      subSources: DocNode & {
        globalKnowledge: DocNode;
        rootCommandList: DocNode;
        commandExecForm: DocNode;
        windowBasicKnowledge: DocNode;
      };
    };
    activator: DocNode & {
      computeActivations: DocNode;
      presentation: DocNode;
    };
    explicit: DocNode;
  };

  /** collectExecutableKnowledgeEntries 的 5 步合成流程 */
  synthesisPipeline: DocNode & {
    step1ProtocolEntries: DocNode;
    step2WindowBasicKnowledge: DocNode;
    step3ProtocolWindows: DocNode;
    step4ActivatorWindows: DocNode;
    step5ExplicitMerge: DocNode;
  };

  /** 合成结果的持久化策略（仅 explicit 写回） */
  ephemeralVsPersisted: DocNode & {
    onlyExplicitPersisted: DocNode;
    schemaEvolutionFreedom: DocNode;
  };

  /** explicit 与 activator 同 path 的去重规则 */
  duplicateAvoidance: DocNode;

  /** protocol entries 的 3 类 key 前缀 */
  pathPrefixConvention: DocNode & {
    internalCommandsPrefix: DocNode;
    internalWindowsPrefix: DocNode;
    kernelPrefix: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const knowledge_activation_v20260515_1: KnowledgeActivationConcept = {
  name: "KnowledgeActivation",
  sources: { knowledge, executable },
  description: `
Knowledge 在 OOC 中按 commandPaths 与 window 类型动态激活，统一表示为
KnowledgeWindow（type=knowledge）出现在 context 里。
`.trim(),

  sourcesEntry: {
    title: "entries 来源",
    summary: "3 类来源：protocol / activator / explicit",

    protocol: {
      title: "protocol",
      summary: "固定下发的协议常量集合（4 个子来源）",
      content: "固定下发的协议常量集合。4 个子来源详见 subSources。",

      subSources: {
        title: "subSources",
        summary: "protocol 的 4 个子来源",

        globalKnowledge: {
          title: "globalKnowledge",
          summary: "模块级 KNOWLEDGE 常量；任何 thread 都看到",
          content: "模块级 KNOWLEDGE 常量；任何 thread 都看到。",
        },

        rootCommandList: {
          title: "rootCommandList",
          summary: "ROOT_KNOWLEDGE，描述 root window 上注册的全部顶层 command",
          content:
            "ROOT_KNOWLEDGE，描述 root window 上注册的全部顶层 command 与调用形态。",
        },

        commandExecForm: {
          title: "commandExecForm",
          summary: "entry.knowledge(args, formStatus) 派生条目；动态变化",
          content:
            "每个 command_exec 的 entry.knowledge(args, formStatus) 派生条目；按 form 当前 args / status 动态变化。",
        },

        windowBasicKnowledge: {
          title: "windowBasicKnowledge",
          summary: "registerWindowType 注入的 basicKnowledge",
          content:
            "每种 window type 在 registerWindowType 时注入的 basicKnowledge 字段；只要该 type 至少一个实例在场就合成。",
        },
      },
    },

    activator: {
      title: "activator",
      summary: "stones/{id}/knowledge/*.md 经 commandPaths 命中",
      content: `
stones/{id}/knowledge/*.md 经 commandPaths 命中。命中算法见 activator.computeActivations；
命中后 presentation（full / summary）决定渲染体积。
      `.trim(),

      computeActivations: {
        title: "computeActivations",
        summary: "按 thread commandPaths 并集与 front-matter 比对",
        content: `
按 thread 当前所有 command_exec 的 commandPaths 并集与 stones/{id}/knowledge/*.md 的 front-matter
匹配规则比对，命中即激活。loader 按 mtime 失效缓存（knowledge_window.reload 主要是语义提示）。
        `.trim(),
      },

      presentation: {
        title: "presentation",
        summary: "full | summary 对应不同体积截断",
        content: `"full" | "summary"，对应渲染层不同的体积截断（knowledge 8KB）。`,
      },
    },

    explicit: {
      title: "explicit",
      summary: "通过 root.open_knowledge 主动 pin 的 window；持久化",
      content: `
用户 / LLM 通过 root.open_knowledge 主动 pin 的 knowledge_window；
源自 stones/{id}/knowledge/{path}.md，持久化进 thread.json。
      `.trim(),
    },
  },

  synthesisPipeline: {
    title: "合成流程",
    summary: "collectExecutableKnowledgeEntries 的 5 步流程",
    content: `
collectExecutableKnowledgeEntries(thread.contextWindows, thread) 是合成入口；按顺序 5 步。
合成 window 仅在响应体里出现，不写回 thread.json 持久化字段。
    `.trim(),

    step1ProtocolEntries: {
      title: "step1 protocol entries",
      summary: "globalKnowledge + rootCommandList + form.knowledge() 派生",
      content: `
收集 protocol 来源 entries：globalKnowledge + rootCommandList + 当前所有 command_exec form
的 knowledge() 派生。
      `.trim(),
    },

    step2WindowBasicKnowledge: {
      title: "step2 window basicKnowledge",
      summary: "遍历实际出现的 window type，注入各自 basicKnowledge",
      content: `
遍历 thread.contextWindows 看实际出现哪些 window type；对每个出现的 type 调
getWindowTypeDefinition(type).basicKnowledge 注入到 entries。
      `.trim(),
    },

    step3ProtocolWindows: {
      title: "step3 protocol windows",
      summary: "step1 + step2 合成为 source='protocol' 的 KnowledgeWindow",
      content: "把 step1 + step2 的 entries 合成为 source=\"protocol\" 的 KnowledgeWindow。",
    },

    step4ActivatorWindows: {
      title: "step4 activator windows",
      summary: "按 commandPaths 并集计算 activator 命中并合成",
      content: `
计算 activator 命中（按 step1 中所有 commandPaths 并集查 stones/*/knowledge/*.md），
合成 source="activator" + 各自 presentation 的 KnowledgeWindow。
      `.trim(),
    },

    step5ExplicitMerge: {
      title: "step5 explicit merge",
      summary: "显式 knowledge_window 原样保留；activator 同 path 跳过",
      content: `
显式 knowledge_window（thread.contextWindows 里 source=explicit / source 缺省）原样保留；
activator 命中重复 path 时跳过（避免同 path 出现两份）。
      `.trim(),
    },
  },

  ephemeralVsPersisted: {
    title: "持久化策略",
    summary: "仅 explicit 写回 thread.json",

    onlyExplicitPersisted: {
      title: "onlyExplicitPersisted",
      summary: "protocol / activator 仅挂响应体，不写回",
      content: `
合成出的 protocol / activator KnowledgeWindow 只挂在响应体上传给 LLM，**不写回**
thread.contextWindows 持久化数组——thread.json 中只保留 source=explicit 的 KnowledgeWindow。
      `.trim(),
    },

    schemaEvolutionFreedom: {
      title: "schemaEvolutionFreedom",
      summary: "协议层 knowledge 可随源码 / 命令面变化随时调整",
      content: `
只持久化 explicit 来源让协议层 knowledge 可以随源码 / 命令面变化随时调整，
无需迁移持久化数据——新增 / 删除 / 重写一个 protocol knowledge 直接生效。
      `.trim(),
    },
  },

  duplicateAvoidance: {
    title: "去重规则",
    summary: "explicit 优先；activator 同 path 跳过",
    content: `
step5ExplicitMerge 阶段处理同 path 在 explicit 与 activator 都命中的情况：
explicit 优先级高，activator 同 path 跳过，避免 LLM context 中出现两份相同 knowledge 文本。
    `.trim(),
  },

  pathPrefixConvention: {
    title: "key 前缀约定",
    summary: "protocol entries 的 3 类 key 前缀",

    internalCommandsPrefix: {
      title: "internal/commands/<name>/...",
      summary: "各 command_exec 的 entry.knowledge() 派生",
      content: "各 command_exec 的 entry.knowledge() 派生 protocol entries。",
    },

    internalWindowsPrefix: {
      title: "internal/windows/<type>/...",
      summary: "basicKnowledge 与 form input knowledge",
      content: "basicKnowledge 与 form input knowledge。",
    },

    kernelPrefix: {
      title: "kernel/...",
      summary: "globalKnowledge（KNOWLEDGE 常量）",
      content: "globalKnowledge（KNOWLEDGE 常量）。",
    },
  },
};
