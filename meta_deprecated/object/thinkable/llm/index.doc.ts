import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as llmTypes from "@src/thinkable/llm/types";
import * as llmEnv from "@src/thinkable/llm/env";
import * as llmClient from "@src/thinkable/llm/client";
import * as llmIndex from "@src/thinkable/llm/index";
import * as openaiProvider from "@src/thinkable/llm/providers/openai";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import * as claudeTransport from "@src/thinkable/llm/providers/claude-transport";
import * as claudeSse from "@src/thinkable/llm/providers/claude-sse";

/* ────────────────────────────────────────────────────────────────
 *  目录页：LLM 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * LLM 概念：统一 client 门面 + provider 适配（OpenAI Responses / Claude Messages）。
 *
 * sources:
 *  - types           — LlmInputItem / LlmTool / LlmGenerateParams / LlmGenerateResult schema
 *  - env             — OOC_* 环境变量读取与默认配置
 *  - client          — generate / stream 门面，按 provider 分发
 *  - index           — re-export 入口
 *  - openai          — OpenAI Responses API 实现（function_call / function_call_output 一等公民）
 *  - claude          — Claude Messages API 主入口
 *  - claudeTransport — Claude transport：messages 编码（system XML / inbox 抽出 / tool_use / tool_result）
 *  - claudeSse       — Claude SSE 解析器（代理强返 SSE 时的兜底）
 */
export type LlmConcept = Concept & {
  sources: {
    types: typeof llmTypes;
    env: typeof llmEnv;
    client: typeof llmClient;
    index: typeof llmIndex;
    openai: typeof openaiProvider;
    claude: typeof claudeProvider;
    claudeTransport: typeof claudeTransport;
    claudeSse: typeof claudeSse;
  };

  /** input/output 数据模型（Responses-first） */
  shape: {
    title: string;
    summary?: string;
    itemTypeMessage: DocNode;
    itemTypeFunctionCall: DocNode;
    itemTypeFunctionCallOutput: DocNode;
    itemTypeReasoning: DocNode;
    /** reasoning 不复喂 */
    reasoningNotReplayed: InvariantNode;
    responsesFirstRationale: DocNode;
  };

  /** OpenAI Responses 与 Claude Messages 两条 transport */
  providers: {
    title: string;
    summary?: string;
    providerTable: DocNode;
    sharedTransportHelper: DocNode;
    sseFallback: DocNode;
  };

  /** OOC_* 环境变量与 provider 切换 */
  env: {
    title: string;
    summary?: string;
    envProvider: DocNode;
    envApiKey: DocNode;
    envBaseUrl: DocNode;
    envModel: DocNode;
    /** params.provider 优先于 env */
    dispatchRule: InvariantNode;
  };

  /** tool 调用历史在两边的不同 wire format */
  toolUseEncoding: {
    title: string;
    summary?: string;
    openaiDirect: DocNode;
    claudeTransform: {
      title: string;
      summary?: string;
      content?: string;
      functionCallRule: DocNode;
      functionCallOutputRule: DocNode;
      /** Claude 不需要 "Continue based on..." 兜底 */
      inboxPrefixExtraction: InvariantNode;
      systemMergeAndConcat: DocNode;
    };
    referenceDoc: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const llm_v20260508_1: LlmConcept = {
  name: "Llm",
  get parent() {
    return thinkable_v20260504_1;
  },
  sources: {
    types: llmTypes,
    env: llmEnv,
    client: llmClient,
    index: llmIndex,
    openai: openaiProvider,
    claude: claudeProvider,
    claudeTransport,
    claudeSse,
  },
  description: `
llm 描述 Object 如何与大语言模型交互。

OOC 内部统一用 LlmInputItem 数组（Responses-first）表达「喂给 LLM 的一切」；
Claude provider 通过 transport 层翻译成 Messages API 的 wire format。
`.trim(),

  shape: {
    title: "数据模型（Responses-first）",
    summary: "4 个 item 类型 + reasoning 不复喂",

    itemTypeMessage: {
      title: 'type: "message"',
      content: "role: system | user | assistant —— 普通文本消息。",
    },

    itemTypeFunctionCall: {
      title: 'type: "function_call"',
      content: `
历史 tool 调用（一等公民，不靠把文本拼回 transcript）。
字段：callId / toolName / arguments。
      `.trim(),
    },

    itemTypeFunctionCallOutput: {
      title: 'type: "function_call_output"',
      content: `
对应 tool 调用的输出。字段：callId / toolName / output / ok。
通过 callId 与 function_call 配对。
      `.trim(),
    },

    itemTypeReasoning: {
      title: 'type: "reasoning"',
      content: "模型 thinking（仅记录）。",
    },

    reasoningNotReplayed: {
      kind: "invariant",
      title: "reasoning 不复喂",
      summary: "reasoning 类型 item 仅记录，不在下一轮 LLM 输入中重新喂回",
      content: "reasoning 类型 item 仅记录，不在下一轮 LLM 输入中重新喂回。",
      rationale: "套娃 / 体积 / 价值低三条理由详见 thinkable.thinkloop.thinkingBehavior。",
    },

    responsesFirstRationale: {
      title: "为什么 Responses-first",
      content: `
OpenAI Responses API 原生吃 LlmInputItem 数组（一等公民语义）；Claude 由
claudeTransport 转换。

选 Responses-first 而不是 Messages-first 的原因：function_call /
function_call_output 作为一等结构而非文本拼接，下游可以做更可靠的 callId 关联与
debug 回看；Claude 那边只是适配层多一道翻译。
      `.trim(),
    },
  },

  providers: {
    title: "Provider 适配",
    summary: "OpenAI Responses / Claude Messages 双轨 + SSE fallback",

    providerTable: {
      title: "Provider 表",
      content: `
| Provider | 入口 | wire format |
|---|---|---|
| openai | openaiProvider | Responses API：input items 直接发送 |
| claude | claudeProvider → claudeTransport | Messages API：messages 数组 + system 字段 + tool_use/tool_result blocks |
      `.trim(),
    },

    sharedTransportHelper: {
      title: "generate / stream 共享 transport",
      content: `
generate() 路径与 stream() 路径共用 transport 层 fetch helper。

避免两条路径独立维护 retry / timeout / header 注入逻辑。
      `.trim(),
    },

    sseFallback: {
      title: "非流式响应的 SSE fallback",
      content: `
非流式响应若服务端返 SSE（代理常见行为），claudeProvider 自动 fallback 到 SSE 聚合器
（详见 sources.claudeSse）。

设计原因：实际部署中 LLM 代理常常把 non-stream 请求也用 SSE 返回（出于复用同一上游
连接），如果不兼容会导致大量「看起来超时但其实有数据」的诡异错误。
      `.trim(),
    },
  },

  env: {
    title: "环境变量",
    summary: "OOC_PROVIDER / OOC_API_KEY / OOC_BASE_URL / OOC_MODEL + 分发规则",

    envProvider: {
      title: "OOC_PROVIDER",
      content: "取值：openai | claude。默认走 sources.env 中的 fallback。",
    },

    envApiKey: {
      title: "OOC_API_KEY",
      content: `
提供商凭证。两个 provider 都从该变量读，避免 OPENAI_API_KEY / ANTHROPIC_API_KEY
两套环境变量管理。
      `.trim(),
    },

    envBaseUrl: {
      title: "OOC_BASE_URL",
      content: "自定义 endpoint（代理 / 自托管推理）。",
    },

    envModel: {
      title: "OOC_MODEL",
      content: "模型名。provider 不再硬编码模型 ID，全部由环境注入。",
    },

    dispatchRule: {
      kind: "invariant",
      title: "params.provider 优先于 env",
      summary: "单次调用可临时覆盖 provider（测试 / A/B 用）",
      content:
        "client.ts 在 generate / stream 入口按 `params.provider ?? config.provider` 分发；params.provider 优先于 env。",
      rationale: "让测试 / A-B 实验可以在不改环境的情况下切 provider，不引入持久副作用。",
    },
  },

  toolUseEncoding: {
    title: "Tool 调用历史的两种 wire format",
    summary: "OpenAI 直吃 input items；Claude 经 transport 翻译",

    openaiDirect: {
      title: "OpenAI 直吃 LlmInputItem 数组",
      content: `
OpenAI Responses API 直接吃 LlmInputItem 数组（function_call /
function_call_output 一等公民）。无需 transport 转换。
      `.trim(),
    },

    claudeTransform: {
      title: "Claude 转换概览",
      summary: "4 条规则：tool_use / tool_result / inbox 抽出 / system 合并",
      content:
        "Claude Messages API 不接受 OOC 内部 schema，由 claudeTransport 转换。共 4 条规则，各自独立子节点。",

      functionCallRule: {
        title: "function_call → assistant tool_use block",
        content:
          '`function_call` → assistant content block `{type: "tool_use", id, name, input}`。',
      },

      functionCallOutputRule: {
        title: "function_call_output → user tool_result block",
        content:
          '`function_call_output` → user content block `{type: "tool_result", tool_use_id, content}`。',
      },

      inboxPrefixExtraction: {
        kind: "invariant",
        title: "inbox 标记前缀抽出为 user 文本块",
        summary: "让 Claude 看到对话起点，不需要 Continue based on... 兜底",
        content:
          'system role message 中 inbox 标记前缀 `[context_change:inbox_message_arrived]` 被抽出来作 user 文本块。让 Claude 看到对话起点，不需要 "Continue based on..." 兜底。',
        rationale:
          "避免人造的 user prompt 污染对话——Claude 没有原生 user 文本时若被注入兜底「请基于…继续」，会让 LLM 误以为这是真实指令。",
      },

      systemMergeAndConcat: {
        title: "其余 system 进 system 字段 + 同 role 连续合并",
        content: `
其余 system role 进 system 字段；同 role 连续 items 合并到一条 message 的
content blocks。

设计原因：Claude Messages API 要求 message 严格 user/assistant 交替——同 role 连
续会被 reject；合并是必要适配。
        `.trim(),
      },
    },

    referenceDoc: {
      title: "参考文档",
      content: `
详见 docs/solutions/conventions/llm-perception-as-api-contract-2026-05-17.md
Checklist #2 「LLM 必须看见自己的历史」一节。
      `.trim(),
    },
  },
};
