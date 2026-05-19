import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";
import * as openaiProvider from "@src/thinkable/llm/providers/openai";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import * as claudeTransport from "@src/thinkable/llm/providers/claude-transport";
import * as claudeSse from "@src/thinkable/llm/providers/claude-sse";

/* ────────────────────────────────────────────────────────────────
 *  目录页：LLM Provider 排查知识骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * LlmProviderDebugging 概念：OOC 与 LLM Provider 对接时可复用的排查知识。
 *
 * sources（本规范沉淀自这几个 provider transport 的踩坑历史）:
 *  - openaiProvider   — OpenAI Responses API 实现，schema 子集教训来源
 *  - claudeProvider   — Claude Messages 主入口
 *  - claudeTransport  — Claude transport：messages 编码、tool_use/tool_result 块
 *  - claudeSse        — Claude SSE 解析器
 */
export type LlmProviderDebuggingConcept = Concept & {
  sources: {
    openaiProvider: typeof openaiProvider;
    claudeProvider: typeof claudeProvider;
    claudeTransport: typeof claudeTransport;
    claudeSse: typeof claudeSse;
  };

  /** OpenAI Responses tool schema 子集约束 */
  openaiSchemaSubset: {
    title: string;
    summary?: string;
    /** 顶层禁止 oneOf / anyOf / allOf / enum / not */
    topLevelObjectOnly: InvariantNode;
    /** array 字段必须提供 items */
    arrayItemsRequired: InvariantNode;
    /** schema vs handler 分工原则 */
    schemaVsHandler: DocNode;
  };

  /** 2026-05-13 open tool schema 400 案例 */
  openSchema400Case: {
    title: string;
    summary?: string;
    /** 现象与可见信息 */
    symptom: DocNode;
    /** 真实根因 */
    rootCause: DocNode;
    /** 服务端返回原文 */
    serverResponse: ExampleNode;
    /** 处理原则 */
    fix: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const llm_provider_debugging_v20260513_1: LlmProviderDebuggingConcept = {
  name: "LlmProviderDebugging",
  get parent() {
    return engineering_v20260506_1;
  },
  sources: { openaiProvider, claudeProvider, claudeTransport, claudeSse },
  description: `
LLM Provider 对接的可复用排查知识。

把真实链路中出现过的 400、schema、协议回放问题沉淀为工程知识，避免重复依赖
临时经验。
`.trim(),

  openaiSchemaSubset: {
    title: "OpenAI Responses tool schema 子集",
    summary: "function tool 的 JSON Schema 支持是子集，不应假设完整 schema 都可用",

    topLevelObjectOnly: {
      kind: "invariant",
      title: "顶层 type 必须是 object 且禁用组合关键字",
      summary: "tool parameters 顶层不要使用 oneOf / anyOf / allOf / enum / not",
      content: `
tool parameters 顶层必须是 \`type: "object"\`，且不要出现 oneOf / anyOf /
allOf / enum / not。条件必填语义不要依赖 if/then/allOf 表达。
      `.trim(),
      rationale:
        "OpenAI 兼容服务对 schema 子集做了严格校验，任何顶层组合关键字会直接 400；条件必填应放到 handler 层做强校验。",
    },

    arrayItemsRequired: {
      kind: "invariant",
      title: "array 字段必须提供 items",
      summary: "缺 items 会被 OpenAI 兼容服务直接 400 拒收",
      content: "schema 中任何 array 字段都必须显式声明 items。",
      rationale:
        "无 items 的 array 在 OpenAI 兼容服务里属于无效 schema，会带来与顶层组合关键字同级别的硬错误。",
    },

    schemaVsHandler: {
      title: "schema 与 handler 的分工",
      content: `
- schema 负责让模型知道字段形状和使用说明
- handler 负责强制校验业务不变量
- provider error 必须保留服务端返回的 message / code / param
      `.trim(),
    },
  },

  openSchema400Case: {
    title: "2026-05-13: open tool schema 400 案例",
    summary: "顶层 allOf + array 缺 items 触发的 invalid_function_parameters",

    symptom: {
      title: "现象",
      content: `
- debug session 进入 failed
- thread 只看到 \`OpenAI 请求失败: 400\`
- llm.input.json 只含 inputItems，无法直接看到 runtime tools schema
      `.trim(),
    },

    rootCause: {
      title: "真实根因",
      content: `
- open tool schema 顶层使用了 allOf / if / then
- args.lines / args.columns 是 array 但缺少 items
      `.trim(),
    },

    serverResponse: {
      kind: "example",
      title: "本地兼容服务返回",
      content: `
\`\`\`json
{
  "error": {
    "message": "code: invalid_function_parameters; message: Invalid schema for function 'open': schema must have type 'object' and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'not' at the top level.",
    "type": "invalid_request_error",
    "param": "tools[0].parameters",
    "code": "-4003"
  }
}
\`\`\`
      `.trim(),
    },

    fix: {
      title: "处理原则",
      content: `
- 移除顶层 allOf
- 给 array 字段补 items
- 保留 \`open(type=file|knowledge)\` 的 args.path handler 层强校验
- 改进 provider 错误记录，不再只写状态码
      `.trim(),
    },
  },
};
