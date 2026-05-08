import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const llm_v20260508_1 = {
  parent: thinkable_v20260504_1,
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
