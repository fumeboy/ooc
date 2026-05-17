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
`.trim(),

  shape_v20260517_1: {
    index: `
## 数据模型（Responses-first）

OOC 内部统一用 \`LlmInputItem\` 数组表达"喂给 LLM 的一切"：

- \`type: "message"\` (role: system | user | assistant) — 文本消息
- \`type: "function_call"\` — 历史 tool 调用（一等公民，不靠把文本拼回 transcript）
- \`type: "function_call_output"\` — 对应 tool 调用的输出
- \`type: "reasoning"\` — 模型 thinking（仅记录，不复喂）

OpenAI Responses API 原生吃这个数组；Claude 由 claudeTransport 转换成 tool_use /
tool_result content blocks。
`.trim(),
  },

  providers_v20260517_1: {
    index: `
## Provider 适配

| Provider | 入口 | wire format |
|---|---|---|
| openai | openaiProvider | Responses API：input items 直接发送 |
| claude | claudeProvider → claudeTransport | Messages API：messages 数组 + system 字段 + tool_use/tool_result blocks |

generate() 路径与 stream() 路径共用 transport 层 fetch helper；非流式响应若服务端
返 SSE（代理常见行为），claudeProvider 自动 fallback 到 SSE 聚合器。
`.trim(),
  },

  env_v20260517_1: {
    index: `
## 环境变量

\`OOC_PROVIDER\` (openai | claude) — provider 切换
\`OOC_API_KEY\` — 提供商凭证
\`OOC_BASE_URL\` — 自定义 endpoint（代理）
\`OOC_MODEL\` — 模型名

client.ts 在 generate / stream 入口按 \`params.provider ?? config.provider\` 分发。
`.trim(),
  },

  toolUseEncoding_v20260517_1: {
    index: `
## Tool 调用历史的两种 wire format

OpenAI Responses API 直接吃 LlmInputItem 数组（function_call /
function_call_output 一等公民）。

Claude Messages API 不接受 OOC 内部 schema，由 claudeTransport 转换：

- \`function_call\` → assistant content block \`{type: "tool_use", id, name, input}\`
- \`function_call_output\` → user content block \`{type: "tool_result", tool_use_id, content}\`
- system role message 中 inbox 标记前缀 \`[context_change:inbox_message_arrived]\` 被抽出来
  作 user 文本块（让 Claude 看到对话起点，不需要 "Continue based on..." 兜底）
- 其余 system role 进 \`system\` 字段；同 role 连续 items 合并到一条 message 的
  content blocks

详见 docs/solutions/conventions/llm-perception-as-api-contract-2026-05-17.md
\`Checklist #2 LLM 必须看见自己的历史\` 一节。
`.trim(),
  },
};
