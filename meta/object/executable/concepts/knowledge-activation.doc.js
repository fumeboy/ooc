import * as knowledge from "@src/thinkable/knowledge/index";
import * as executable from "@src/executable/index";

/**
 * Knowledge activation 概念：knowledge 如何按 commandPaths 渐进式激活进入 context。
 *
 * sources:
 *  - knowledge — computeActivations / loadKnowledgeIndex
 *  - executable — collectExecutableKnowledgeEntries 合成 KnowledgeWindow 的入口
 */
export const knowledge_activation_v20260515_1 = {
  name: "KnowledgeActivation",
  description: `Knowledge 在 OOC 中按 commandPaths 与 window 类型动态激活，统一表示为 KnowledgeWindow（type=knowledge）出现在 context 里。`,
  sources: { knowledge, executable },

  sources_v20260517_1: {
    index: `knowledge entries 的 3 类来源；详见各子节点。`,

    protocol_v20260517_1: {
      index: `
#### protocol

固定下发的协议常量集合。4 个子来源详见 protocol.subSources。
`,

      subSources_v20260517_1: {
        index: `protocol 的 4 个子来源。`,

        globalKnowledge_v20260517_1: {
          index: `##### globalKnowledge — 模块级 KNOWLEDGE 常量；任何 thread 都看到。`,
        },

        rootCommandList_v20260517_1: {
          index: `##### rootCommandList — ROOT_KNOWLEDGE，描述 root window 上注册的全部顶层 command 与调用形态。`,
        },

        commandExecForm_v20260517_1: {
          index: `##### commandExecForm — 每个 command_exec 的 entry.knowledge(args, formStatus) 派生条目；按 form 当前 args / status 动态变化。`,
        },

        windowBasicKnowledge_v20260517_1: {
          index: `##### windowBasicKnowledge — 每种 window type 在 registerWindowType 时注入的 basicKnowledge 字段；只要该 type 至少一个实例在场就合成。`,
        },
      },
    },

    activator_v20260517_1: {
      index: `
#### activator

stones/{id}/knowledge/*.md 经 commandPaths 命中。命中算法见 activator.computeActivations；
命中后 presentation（full / summary）决定渲染体积。
`,

      computeActivations_v20260517_1: {
        index: `
##### computeActivations

按 thread 当前所有 command_exec 的 commandPaths 并集与 stones/{id}/knowledge/*.md 的 front-matter
匹配规则比对，命中即激活。loader 按 mtime 失效缓存（knowledge_window.reload 主要是语义提示）。
`,
      },

      presentation_v20260517_1: {
        index: `##### presentation — "full" | "summary"，对应渲染层不同的体积截断（knowledge 8KB）。`,
      },
    },

    explicit_v20260517_1: {
      index: `
#### explicit

用户 / LLM 通过 root.open_knowledge 主动 pin 的 knowledge_window；
源自 stones/{id}/knowledge/{path}.md，持久化进 thread.json。
`,
    },
  },

  synthesisPipeline_v20260517_1: {
    index: `
collectExecutableKnowledgeEntries(thread.contextWindows, thread) 是合成入口；按顺序 5 步。
合成 window 仅在响应体里出现，不写回 thread.json 持久化字段。
`,

    step1ProtocolEntries_v20260517_1: {
      index: `
##### step1ProtocolEntries

收集 protocol 来源 entries：globalKnowledge + rootCommandList + 当前所有 command_exec form
的 knowledge() 派生。
`,
    },

    step2WindowBasicKnowledge_v20260517_1: {
      index: `
##### step2WindowBasicKnowledge

遍历 thread.contextWindows 看实际出现哪些 window type；对每个出现的 type 调
getWindowTypeDefinition(type).basicKnowledge 注入到 entries。
`,
    },

    step3ProtocolWindows_v20260517_1: {
      index: `##### step3ProtocolWindows — 把 step1 + step2 的 entries 合成为 source="protocol" 的 KnowledgeWindow。`,
    },

    step4ActivatorWindows_v20260517_1: {
      index: `
##### step4ActivatorWindows

计算 activator 命中（按 step1 中所有 commandPaths 并集查 stones/*/knowledge/*.md），
合成 source="activator" + 各自 presentation 的 KnowledgeWindow。
`,
    },

    step5ExplicitMerge_v20260517_1: {
      index: `
##### step5ExplicitMerge

显式 knowledge_window（thread.contextWindows 里 source=explicit / source 缺省）原样保留；
activator 命中重复 path 时跳过（避免同 path 出现两份）。
`,
    },
  },

  ephemeralVsPersisted_v20260517_1: {
    index: `合成结果的持久化策略；2 条子规则详见各子节点。`,

    onlyExplicitPersisted_v20260517_1: {
      index: `
##### onlyExplicitPersisted

合成出的 protocol / activator KnowledgeWindow 只挂在响应体上传给 LLM，**不写回**
thread.contextWindows 持久化数组——thread.json 中只保留 source=explicit 的 KnowledgeWindow。
`,
    },

    schemaEvolutionFreedom_v20260517_1: {
      index: `
##### schemaEvolutionFreedom

只持久化 explicit 来源让协议层 knowledge 可以随源码 / 命令面变化随时调整，
无需迁移持久化数据——新增 / 删除 / 重写一个 protocol knowledge 直接生效。
`,
    },
  },

  duplicateAvoidance_v20260517_1: {
    index: `
step5ExplicitMerge 阶段处理同 path 在 explicit 与 activator 都命中的情况：
explicit 优先级高，activator 同 path 跳过，避免 LLM context 中出现两份相同 knowledge 文本。
`,
  },

  pathPrefixConvention_v20260517_1: {
    index: `protocol entries 的 key 用约定前缀区分来源（便于 debug 与去重）；3 类前缀详见各子节点。`,

    internalCommandsPrefix_v20260517_1: {
      index: `##### internal/commands/<name>/... — 各 command_exec 的 entry.knowledge() 派生 protocol entries。`,
    },

    internalWindowsPrefix_v20260517_1: {
      index: `##### internal/windows/<type>/... — basicKnowledge 与 form input knowledge。`,
    },

    kernelPrefix_v20260517_1: {
      index: `##### kernel/... — globalKnowledge（KNOWLEDGE 常量）。`,
    },
  },
};
