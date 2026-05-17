import * as openaiProvider from "@src/thinkable/llm/providers/openai";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import * as claudeTransport from "@src/thinkable/llm/providers/claude-transport";
import * as claudeSse from "@src/thinkable/llm/providers/claude-sse";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";

/**
 * LLM Provider 对接的可复用排查知识：schema 子集限制 / SSE 回退 / tool use 编码等。
 *
 * sources（本规范沉淀自这几个 provider transport 的踩坑历史）:
 *  - openaiProvider   — OpenAI Responses API 实现，schema 子集教训来源
 *  - claudeProvider   — Claude Messages 主入口
 *  - claudeTransport  — Claude transport：messages 编码、tool_use/tool_result 块
 *  - claudeSse        — Claude SSE 解析器
 */
export const llm_provider_debugging_v20260513_1 = {
  name: "LlmProviderDebugging",
  get parent() { return engineering_v20260506_1; },
  sources: { openaiProvider, claudeProvider, claudeTransport, claudeSse },
  description: `
# LLM Provider Debugging

本文件记录 OOC 与 LLM Provider 对接时的可复用排查知识。目标是把真实链路中出现过的 400、schema、协议回放问题沉淀为工程知识，避免重复依赖临时经验。

## OpenAI Responses Tool Schema

OpenAI 兼容服务对 function tool 的 JSON Schema 支持通常是子集，不应假设完整 JSON Schema 都可用。

已确认约束：
- tool parameters 顶层必须是 type: "object"
- tool parameters 顶层不要使用 oneOf / anyOf / allOf / enum / not
- array 字段必须提供 items
- 条件必填语义不要依赖 if/then/allOf，应放到 handler 层做强校验

推荐模式：
- schema 负责让模型知道字段形状和使用说明
- handler 负责强制校验业务不变量
- provider error 必须保留服务端返回的 message / code / param

## 2026-05-13: open tool schema 400

现象：
- debug session 进入 failed
- thread 只看到 OpenAI 请求失败: 400
- llm.input.json 只含 inputItems，无法直接看到 runtime tools schema

真实根因：
- open tool schema 顶层使用了 allOf / if / then
- args.lines / args.columns 是 array 但缺少 items

本地兼容服务返回：
json
{
  "error": {
    "message": "code: invalid_function_parameters; message: Invalid schema for function 'open': schema must have type 'object' and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'not' at the top level.",
    "type": "invalid_request_error",
    "param": "tools[0].parameters",
    "code": "-4003"
  }
}


处理原则：
- 移除顶层 allOf
- 给 array 字段补 items
- 保留 open(type=file|knowledge) 的 args.path handler 层强校验
- 改进 provider 错误记录，不再只写状态码
`,
};
