import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { context_v20260505_1 } from "@meta/object/thinkable/context/index.doc";
import * as contextSource from "@src/thinkable/context";

/* ────────────────────────────────────────────────────────────────
 *  目录页：ProcessEvents 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * ProcessEvents 概念：线程内部稳定的过程事件流（ProcessEvent union schema）。
 *
 * sources:
 *  - context — ProcessEvent type 定义（union re-export 入口）+ buildInputItems
 *              transcript 转换 + renderContextXml
 */
export type ProcessEventsConcept = Concept & {
  sources: {
    context: typeof contextSource;
  };

  /** 三类消费方及各自从事件流取什么 */
  consumers: {
    title: string;
    summary?: string;
    /** thinkloop 作为写入方 */
    thinkloop: DocNode;
    /** contextBuilder 把事件转 transcript items */
    contextBuilder: DocNode;
    /** observable / persistable / web timeline 三方异步消费 */
    observerStack: {
      title: string;
      summary?: string;
      observable: DocNode;
      persistable: DocNode;
      webTimeline: DocNode;
    };
  };

  /** 事件 3 大类与各 kind 的 narrow 分支 */
  categories: {
    title: string;
    summary?: string;
    /** thinkloop 写入：text / tool_use / function_call / thinking */
    llmInteraction: {
      title: string;
      summary?: string;
      text: DocNode;
      toolUse: DocNode;
      functionCall: DocNode;
      thinking: DocNode;
      /** toolName 枚举固定为 6 个原语 */
      toolNameEnumeration: InvariantNode;
      /** thinking 仅回看不复喂 */
      thinkingNotReplayed: InvariantNode;
    };
    /** 非 LLM 路径写入：inject / inbox_message_arrived */
    contextChange: {
      title: string;
      summary?: string;
      inject: DocNode;
      inboxMessageArrived: DocNode;
      /** 仅错误型 inject 进入 transcript */
      injectTranscriptFateRule: InvariantNode;
    };
    /** dispatchToolCall 写入：function_call_output */
    toolRuntime: {
      title: string;
      summary?: string;
      functionCallOutput: DocNode;
    };
  };

  /** buildInputItems 把事件转 transcript items 的逐类规则 */
  transcriptMapping: {
    title: string;
    summary?: string;
    /** inbox_message_arrived 渲染规则 */
    inboxMessageArrivedMapping: {
      title: string;
      summary?: string;
      content?: string;
      fromFieldDerivation: DocNode;
      optionalTextAppend: DocNode;
      providerInboxExtraction: DocNode;
    };
    /** inject 仅错误型进入 transcript */
    injectMapping: {
      title: string;
      summary?: string;
      content?: string;
      /** isErrorInject 启发式分类 */
      errorClassification: {
        title: string;
        summary?: string;
        rulePrefixBracket: DocNode;
        ruleChineseFailureWord: DocNode;
        ruleErrorCapitalized: DocNode;
        ruleErrorLowercase: DocNode;
        /** 任一命中即 error inject */
        anyHitWins: InvariantNode;
      };
    };
    functionCallMapping: DocNode;
    functionCallOutputMapping: DocNode;
    thinkingMapping: DocNode;
    textMapping: DocNode;
    toolUseMapping: DocNode;
  };

  /** 与 XML system context 的两层分工 */
  layeringWithContext: {
    title: string;
    summary?: string;
    /** XML system prompt（稳定状态层） */
    xmlSystemPrompt: {
      title: string;
      summary?: string;
      renderEntry: DocNode;
      responsibility: DocNode;
      sizeControl: DocNode;
      /** knowledge 8KB 截断 */
      knowledgeTruncation8KB: InvariantNode;
      /** file 32KB 截断 */
      fileTruncation32KB: InvariantNode;
    };
    /** transcript history（过程历史层） */
    transcriptHistory: {
      title: string;
      summary?: string;
      composition: DocNode;
      responsibility: DocNode;
      /** 两层互不混用 */
      noMixingBoundary: InvariantNode;
    };
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const process_events_v20260514_1: ProcessEventsConcept = {
  name: "ProcessEvents",
  get parent() {
    return context_v20260505_1;
  },
  sources: {
    context: contextSource,
  },
  description: `
ProcessEvents 是线程内部稳定的过程事件流，被 thinkloop / context builder /
observable+persistable+timeline 三方共同消费。

事件按来源分 3 大类（llm_interaction / context_change / tool_runtime），
每类下若干 kind 是 ProcessEvent union 的 narrow 分支。
`.trim(),

  consumers: {
    title: "事件流消费方",
    summary: "thinkloop 写、contextBuilder 转 transcript、observer stack 三方回看",

    thinkloop: {
      title: "thinkloop（写入方）",
      summary: "单轮 LLM 输出 + tool 执行结果写回线程的入口",
      content: `
单轮 LLM 调用结束时，thinkloop 把 LLM 输出（text / function_call /
thinking）与每个 function_call 的执行结果（function_call_output）依次 push 到
thread.events。读侧不直接消费——它只是写入方。
      `.trim(),
    },

    contextBuilder: {
      title: "contextBuilder",
      summary: "把可进入 transcript 的事件转换成下一轮 LLM input items",
      content: `
buildInputItems(thread) 在每轮调 LLM 前遍历 thread.events，按 transcriptMapping
的转换规则产出下一轮的 transcript items（system / user / assistant messages +
function_call / function_call_output 一等 items）。
      `.trim(),
    },

    observerStack: {
      title: "observerStack",
      summary: "observable / persistable / web timeline 三方异步消费",

      observable: {
        title: "observable",
        content:
          "debug 模式下把 events 与 inputItems 一起落盘到 llm.input.json / loop_NNNN.* 文件。",
      },

      persistable: {
        title: "persistable",
        content: "thread.json 持久化时事件流是 thread state 的核心字段之一。",
      },

      webTimeline: {
        title: "web timeline",
        content: "前端 ContextSnapshotViewer 把事件按时间顺序展示给开发者。",
      },
    },
  },

  categories: {
    title: "事件类别",
    summary: "3 大类（llm_interaction / context_change / tool_runtime）的 narrow 分支",

    llmInteraction: {
      title: "llm_interaction",
      summary: "thinkloop 在 LLM 响应结束后写入",

      text: {
        title: "text",
        content: `
- 字段：text: string
- 含义：assistant 对外可见的自然语言输出
- 写入：thinkloop 收到 LLM 返回的纯文本时
        `.trim(),
      },

      toolUse: {
        title: "tool_use",
        content: `
- 字段：toolName / arguments
- 含义：工具调用记录，保留 LLM 当时的原始调用意图
- 用途：与 function_call 互补——tool_use 用于事件流 / debug 时间线的回看，
  function_call 用于 transcript 回喂
        `.trim(),
      },

      functionCall: {
        title: "function_call",
        content: `
- 字段：callId: string / toolName / arguments: Record<string, unknown>
- 含义：Responses-first 语义下的一等 tool 调用记录
- 用途：transcript items 直接复用，让 LLM 看到自己上一轮的 tool 调用历史；与
  对应 function_call_output 通过 callId 关联
        `.trim(),
      },

      thinking: {
        title: "thinking",
        content: `
- 字段：text: string
- 含义：provider 返回的思考文本（Claude / Anthropic-compatible models 的 reasoning block）
- 写入：thinkloop 检测到响应含 thinking block 时记录
        `.trim(),
      },

      toolNameEnumeration: {
        kind: "invariant",
        title: "toolName 枚举值固定 6 个",
        summary: "open / refine / submit / close / wait / compress",
        content:
          "llm_interaction 类事件的 toolName 取值范围统一为 open / refine / submit / close / wait / compress，与 thinkloop 的固定 tool 集合一一对应。",
        rationale:
          "让事件流的 toolName 与 LLM 看到的 tool 表严格同源；扩展能力时走 command 而非新增 tool，避免事件 schema 持续漂移。",
      },

      thinkingNotReplayed: {
        kind: "invariant",
        title: "thinking 仅回看不复喂",
        summary: "thinking 事件进入 transcript 时不作为推理上下文复喂",
        content:
          "thinking 事件仅用于回看 / debug；进入 transcript 时不作为推理上下文复喂。",
        rationale:
          "套娃风险（看自己思考引发 meta-thinking）+ 体积爆炸（thinking 通常 2-5 倍于 content）+ 价值低（结论应走 content / tool_use）。详见 thinkloop.thinkingBehavior。",
      },
    },

    contextChange: {
      title: "context_change",
      summary: "control plane / scheduler / executable tool 等非 LLM 路径写入",

      inject: {
        title: "inject",
        content: `
- 字段：text: string
- 含义：系统补充给线程的提示文本（错误 / 状态变化 / 人工补充）
- 写入侧：tool handler 校验失败 / scheduler 检测异常 / manual debug 注入
        `.trim(),
      },

      inboxMessageArrived: {
        title: "inbox_message_arrived",
        content: `
- 字段：msgId: string / 可选 text: string
- 含义：inbox 中有一条新消息到达，可与 thread.inbox 中对应 msgId 的实体 message 关联
- 写入侧：talk-delivery 派送消息 / scheduler.emitChildEndNotifications / control plane
  user reply 路径
        `.trim(),
      },

      injectTranscriptFateRule: {
        kind: "invariant",
        title: "仅错误型 inject 进入 transcript",
        summary: "普通 inject 视作过期上下文丢弃，仅错误型进入下一轮 LLM 输入",
        content:
          "普通 inject 视作过期上下文丢弃；只有错误型 inject 进入下一轮 transcript。判定见 transcriptMapping.injectMapping.errorClassification。",
        rationale:
          "错误信息必须让 LLM 在下一轮看见以便修复；状态提示型 inject 过了就过了，保留会污染 transcript。",
      },
    },

    toolRuntime: {
      title: "tool_runtime",
      summary: "dispatchToolCall 在每次 tool handler 返回后写入",

      functionCallOutput: {
        title: "function_call_output",
        content: `
- 字段：callId / toolName / output: string / ok: boolean
- 含义：某次 function_call 的序列化输出
- 关联：通过 callId 与对应 function_call 配对
- transcript 命运：作为一等 function_call_output input item 进入下一轮 LLM 输入
        `.trim(),
      },
    },
  },

  transcriptMapping: {
    title: "transcript 映射",
    summary: "buildInputItems 逐 event kind 的转换规则",

    inboxMessageArrivedMapping: {
      title: "inbox_message_arrived → system message",
      summary: "前缀含 msg_id / from / 可选文本",
      content: `
\`\`\`
[context_change:inbox_message_arrived] msg_id=<id> from=<fromThreadId>
<可选附加 text>
\`\`\`
      `.trim(),

      fromFieldDerivation: {
        title: "from=... 字段来源",
        content: `
\`from=...\` 来自 thread.inbox 中按 msgId 找到的真实消息 fromThreadId。

设计原因：让 transcript 中的"通知"与 inbox 中的实体消息可被同一个 msgId 关联，
不依赖隐式上下文。
        `.trim(),
      },

      optionalTextAppend: {
        title: "事件自带 text 时附加",
        content: "事件自带 text 时附加到这条 message 后面（不替换前缀，只追加正文）。",
      },

      providerInboxExtraction: {
        title: "provider 适配层识别该前缀",
        content: `
provider 适配层（如 Claude）会识别该前缀，把真实正文抽出来作 user 文本块。

详见 llm.toolUseEncoding.claudeTransform.inboxPrefixExtraction。
        `.trim(),
      },
    },

    injectMapping: {
      title: "context_change.inject → 仅错误型进入 transcript",
      summary: "isErrorInject 启发式分类",
      content: `
\`\`\`
[context_change:error]
<text>
\`\`\`

普通 inject 不进入 transcript（视作"过期上下文"）。
      `.trim(),

      errorClassification: {
        title: "errorClassification",
        summary: "4 条命中规则，任一命中即 error",

        rulePrefixBracket: {
          title: "规则 1：以 [错误] 开头",
          content: "前缀匹配，最严格的人工标注命中。",
        },

        ruleChineseFailureWord: {
          title: "规则 2：包含中文「失败」",
          content: "包含中文「失败」字样视为错误。",
        },

        ruleErrorCapitalized: {
          title: "规则 3：包含 Error",
          content: "包含 PascalCase Error 视为错误（多见 stack trace）。",
        },

        ruleErrorLowercase: {
          title: "规则 4：包含 error",
          content: "包含小写 error 视为错误（多见 log 行）。",
        },

        anyHitWins: {
          kind: "invariant",
          title: "任一命中即 error inject",
          summary: "未命中的 inject 仅留事件流供 observer 回看",
          content:
            "任一命中视作 error inject，进入 transcript 作为 system message。未命中的 inject 仅留在事件流供 observer 回看。",
          rationale:
            "错误判定故意宽松——漏掉错误成本（LLM 看不到失败原因）高于误判普通 inject 为错误（多一条 system 消息）的成本。",
        },
      },
    },

    functionCallMapping: {
      title: "function_call → function_call input item",
      content: `
转换成 Responses-first function_call input item，保留 call_id / name /
arguments。

OpenAI Responses API 直接吃这种 item；Claude 由 transport 层翻成
{type: "tool_use", id, name, input} content block（详见 llm.toolUseEncoding）。
      `.trim(),
    },

    functionCallOutputMapping: {
      title: "function_call_output → function_call_output input item",
      content: `
转换成 Responses-first function_call_output input item，保留 call_id /
name / output。

Claude transport 翻成 {type: "tool_result", tool_use_id, content} content block。
      `.trim(),
    },

    thinkingMapping: {
      title: "thinking → assistant message",
      content: `
\`\`\`
[thinking]
<text>
\`\`\`

仅用于 transcript 完整性 / debug 回看；LLM 看到自己上一轮的思考但不作为推理上下文重新参与。
      `.trim(),
    },

    textMapping: {
      title: "text → assistant message",
      content: "内容直接使用 event.text，role=assistant。",
    },

    toolUseMapping: {
      title: "tool_use → 不进入 transcript",
      content: `
tool_use 事件保留在 thread.events 供时间线 / 调试 / 压缩策略使用；
transcript 中的 tool 协议以 function_call / function_call_output 为主，
不复用 tool_use。
      `.trim(),
    },
  },

  layeringWithContext: {
    title: "与 XML system context 的两层分工",
    summary: "system = 状态快照层，transcript = 历史层",

    xmlSystemPrompt: {
      title: "XML system context（稳定状态层）",
      summary: "renderContextXml 入口、体积控制、knowledge / file 截断",

      renderEntry: {
        title: "renderContextXml 入口",
        content:
          "renderContextXml(...) 把所有结构化字段（contextWindows / inbox / outbox / status / ...）按 XML 子标签序列渲染成 system message。",
      },

      responsibility: {
        title: "职责：表达当前所有状态",
        content:
          "表达「我现在拥有什么」——当前所有 window、当前 inbox / outbox、当前激活的 knowledge 等。",
      },

      sizeControl: {
        title: "体积控制",
        content: "XML 转义、CDATA 包装、comment 清洗与体积截断由 render 层负责。",
      },

      knowledgeTruncation8KB: {
        kind: "invariant",
        title: "knowledge 8KB 截断",
        summary: "system prompt 层单篇 knowledge 体积上限",
        content: "knowledge window 正文按 8KB 截断。",
        rationale:
          "knowledge 是高频参考材料，激活集合最多 20 项，单篇必须有上限避免 system prompt 爆炸。",
      },

      fileTruncation32KB: {
        kind: "invariant",
        title: "file 32KB 截断",
        summary: "system prompt 层单文件 inspect 体积上限",
        content: "file window 正文按 32KB 截断。",
        rationale:
          "file 通常是单文件 inspect 场景，阈值大于 knowledge——既保留可读性，又对单轮 token 消耗设上限。",
      },
    },

    transcriptHistory: {
      title: "transcript history（过程历史层）",
      summary: "events 转 user/assistant/tool 三 role + function_call/output 一等 items",

      composition: {
        title: "组成",
        content:
          "由 process events 转换出来的 transcript items（user / assistant / tool 三种 role + function_call / function_call_output 一等 items）。",
      },

      responsibility: {
        title: "职责：表达过程历史",
        content:
          "表达「上一轮到当前轮之间发生过什么」——LLM 看到自己上轮的 tool 调用、function 结果、回信等历史。",
      },

      noMixingBoundary: {
        kind: "invariant",
        title: "两层互不混用",
        summary: "稳定信息走 system，历史交互走 messages",
        content: "稳定信息走 system，历史交互走 messages。",
        rationale:
          "让 system 在长跑线程里仍保持可控大小，并让 LLM 不在 transcript 中复述自己已经在 system 里看到的状态。详见 thinkable.context.llmInput.layerBoundary。",
      },
    },
  },
};
