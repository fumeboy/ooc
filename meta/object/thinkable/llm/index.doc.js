import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as llmTypesSource from "../../../../src/thinkable/llm/types.ts";
import * as llmEnvSource from "../../../../src/thinkable/llm/env.ts";
import * as llmOpenAiSource from "../../../../src/thinkable/llm/providers/openai.ts";
import * as llmClaudeSource from "../../../../src/thinkable/llm/providers/claude.ts";
import * as llmClientSource from "../../../../src/thinkable/llm/client.ts";
import * as llmIndexSource from "../../../../src/thinkable/llm/index.ts";

export const llm_v20260508_1 = {
  get parent() { return thinkable_v20260504_1; },
  // sources 显式引用对应源码模块，确保 meta 与实现保持真实连接。
  sources: {
    types: llmTypesSource,
    env: llmEnvSource,
    openai: llmOpenAiSource,
    claude: llmClaudeSource,
    client: llmClientSource,
    index: llmIndexSource
  },
  index: `
llm 描述 Object 如何与大语言模型交互。

当前第一批实现覆盖：

- 统一 LLM client 门面
- OpenAI / Claude 两种协议适配
- 非流式文本输出
- 流式文本输出
- 原生 tool call
- 从 OOC_* 环境变量读取默认配置

对应源码位置：

- src/thinkable/llm/types.ts
- src/thinkable/llm/env.ts
- src/thinkable/llm/providers/openai.ts
- src/thinkable/llm/providers/claude.ts
- src/thinkable/llm/client.ts
- src/thinkable/llm/index.ts

当前不新增 chat()，统一通过 generate() / stream() 暴露文本与 tool call 能力。
`,
};
