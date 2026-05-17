import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as llmTypes from "@src/thinkable/llm/types";
import * as llmEnv from "@src/thinkable/llm/env";
import * as llmClient from "@src/thinkable/llm/client";
import * as llmIndex from "@src/thinkable/llm/index";
import * as openaiProvider from "@src/thinkable/llm/providers/openai";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import * as claudeTransport from "@src/thinkable/llm/providers/claude-transport";
import * as claudeSse from "@src/thinkable/llm/providers/claude-sse";

/**
 * LLM 概念：统一 client 门面 + provider 适配（OpenAI Responses / Claude Messages）。
 *
 * sources:
 *  - llmTypes        — LlmInputItem / LlmTool / LlmGenerateParams / LlmGenerateResult schema
 *  - llmEnv          — OOC_* 环境变量读取与默认配置
 *  - llmClient       — generate / stream 门面，按 provider 分发
 *  - llmIndex        — re-export 入口
 *  - openaiProvider  — OpenAI Responses API 实现（function_call / function_call_output 一等公民）
 *  - claudeProvider  — Claude Messages API 主入口
 *  - claudeTransport — Claude transport：messages 编码（system XML / inbox 抽出 / tool_use / tool_result）
 *  - claudeSse       — Claude SSE 解析器（代理强返 SSE 时的兜底）
 */
export const llm_v20260508_1 = {
  name: "Llm",
  get parent() { return thinkable_v20260504_1; },
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

按子字段展开：

- shape — input/output 数据模型
- providers — OpenAI Responses 与 Claude Messages 两条 transport
- env — OOC_* 环境变量与 provider 切换
- toolUseEncoding — tool 调用历史在两边的不同 wire format
`,

  shape_v20260517_1: {
    index: `
## 数据模型（Responses-first）

OOC 内部统一用 LlmInputItem 数组表达"喂给 LLM 的一切"。详见子节点：4 个 item 类型、
为什么 Responses-first、reasoning 不复喂的不变量。
`,

    itemTypeMessage_v20260517_1: {
      index: `
### type: "message"

role: system | user | assistant —— 普通文本消息。
`,
    },

    itemTypeFunctionCall_v20260517_1: {
      index: `
### type: "function_call"

历史 tool 调用（一等公民，不靠把文本拼回 transcript）。
字段：callId / toolName / arguments。
`,
    },

    itemTypeFunctionCallOutput_v20260517_1: {
      index: `
### type: "function_call_output"

对应 tool 调用的输出。字段：callId / toolName / output / ok。
通过 callId 与 function_call 配对。
`,
    },

    itemTypeReasoning_v20260517_1: {
      index: `
### type: "reasoning"

模型 thinking（仅记录）。
`,
    },

    reasoningNotReplayed_v20260517_1: {
      index: `
### 不变量：reasoning 不复喂

reasoning 类型 item 仅记录，**不**在下一轮 LLM 输入中重新喂回。

设计原因详见 thinkable.thinkloop.thinkingBehavior（套娃 / 体积 / 价值低三条理由）。
`,
    },

    responsesFirstRationale_v20260517_1: {
      index: `
### 为什么 Responses-first

OpenAI Responses API 原生吃 LlmInputItem 数组（一等公民语义）；Claude 由
claudeTransport 转换。

选 Responses-first 而不是 Messages-first 的原因：function_call /
function_call_output 作为一等结构而非文本拼接，下游可以做更可靠的 callId 关联与
debug 回看；Claude 那边只是适配层多一道翻译。
`,
    },
  },

  providers_v20260517_1: {
    index: `
## Provider 适配

详见子节点：provider 表、共享 transport、SSE fallback 不变量。
`,

    providerTable_v20260517_1: {
      index: `
### Provider 表

| Provider | 入口 | wire format |
|---|---|---|
| openai | openaiProvider | Responses API：input items 直接发送 |
| claude | claudeProvider → claudeTransport | Messages API：messages 数组 + system 字段 + tool_use/tool_result blocks |
`,
    },

    sharedTransportHelper_v20260517_1: {
      index: `
### generate / stream 共享 transport

generate() 路径与 stream() 路径共用 transport 层 fetch helper。

避免两条路径独立维护 retry / timeout / header 注入逻辑。
`,
    },

    sseFallback_v20260517_1: {
      index: `
### 非流式响应的 SSE fallback

非流式响应若服务端返 SSE（代理常见行为），claudeProvider 自动 fallback 到 SSE 聚合器
（详见 sources.claudeSse）。

设计原因：实际部署中 LLM 代理常常把 non-stream 请求也用 SSE 返回（出于复用同一上游
连接），如果不兼容会导致大量"看起来超时但其实有数据"的诡异错误。
`,
    },
  },

  env_v20260517_1: {
    index: `
## 环境变量

按子节点列出每个 OOC_* 与分发规则。
`,

    envProvider_v20260517_1: {
      index: `
### OOC_PROVIDER

取值：openai | claude。默认走 sources.env 中的 fallback。
`,
    },

    envApiKey_v20260517_1: {
      index: `
### OOC_API_KEY

提供商凭证。两个 provider 都从该变量读，避免 OPENAI_API_KEY / ANTHROPIC_API_KEY
两套环境变量管理。
`,
    },

    envBaseUrl_v20260517_1: {
      index: `
### OOC_BASE_URL

自定义 endpoint（代理 / 自托管推理）。
`,
    },

    envModel_v20260517_1: {
      index: `
### OOC_MODEL

模型名。provider 不再硬编码模型 ID，全部由环境注入。
`,
    },

    dispatchRule_v20260517_1: {
      index: `
### 分发规则

client.ts 在 generate / stream 入口按 \`params.provider ?? config.provider\` 分发。

不变量：params.provider 优先于 env，让单次调用可临时覆盖 provider（测试 / A/B 用）。
`,
    },
  },

  toolUseEncoding_v20260517_1: {
    index: `
## Tool 调用历史的两种 wire format

详见子节点：OpenAI 直吃、Claude 转换的 4 条规则、对外参考文档。
`,

    openaiDirect_v20260517_1: {
      index: `
### OpenAI 直吃 LlmInputItem 数组

OpenAI Responses API 直接吃 LlmInputItem 数组（function_call /
function_call_output 一等公民）。无需 transport 转换。
`,
    },

    claudeTransform_v20260517_1: {
      index: `
### Claude 转换概览

Claude Messages API 不接受 OOC 内部 schema，由 claudeTransport 转换。
共 4 条规则，各自独立子节点。
`,

      functionCallRule_v20260517_1: {
        index: `
#### function_call → assistant tool_use block

\`function_call\` → assistant content block \`{type: "tool_use", id, name, input}\`。
`,
      },

      functionCallOutputRule_v20260517_1: {
        index: `
#### function_call_output → user tool_result block

\`function_call_output\` → user content block \`{type: "tool_result", tool_use_id, content}\`。
`,
      },

      inboxPrefixExtraction_v20260517_1: {
        index: `
#### inbox 标记前缀抽出为 user 文本块

system role message 中 inbox 标记前缀
\`[context_change:inbox_message_arrived]\` 被抽出来作 user 文本块。

不变量：让 Claude 看到对话起点，**不需要** "Continue based on..." 兜底
（避免人造的 user prompt 污染对话）。
`,
      },

      systemMergeAndConcat_v20260517_1: {
        index: `
#### 其余 system 进 system 字段 + 同 role 连续合并

其余 system role 进 system 字段；同 role 连续 items 合并到一条 message 的
content blocks。

设计原因：Claude Messages API 要求 message 严格 user/assistant 交替——同 role 连
续会被 reject；合并是必要适配。
`,
      },
    },

    referenceDoc_v20260517_1: {
      index: `
### 参考文档

详见 docs/solutions/conventions/llm-perception-as-api-contract-2026-05-17.md
Checklist #2 LLM 必须看见自己的历史 一节。
`,
    },
  },
};
