import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const debug_v20260506_1 = {
  parent: observable_v20260504_1,
  index: `
Debug 模式用于“事后排查”：持续把每轮 ThinkLoop 的输入/输出/思考/元数据写到文件。

注意：Debug 不会暂停执行（与 pause 独立）。

## 开关与 API

- POST \/api\/debug\/enable
- POST \/api\/debug\/disable
- GET  \/api\/debug\/status

## 文件落盘格式

当 debug 开启，Engine 每轮执行后写入：

- \`threads/{threadId}/debug/loop_NNN.input.json\`
- \`threads/{threadId}/debug/loop_NNN.output.json\`（包含 tool_calls）
- \`threads/{threadId}/debug/loop_NNN.meta.json\`（结构化元数据）

其中 meta.json 会记录：model、latency、token 用量、Context 各区块字符统计、活跃 traits、解析出的 directives 等。

## 与 pause 的关系

debug 解决“看见发生过什么”；pause 解决“在关键点停住并允许改写”。

常见组合：

1) 先开 debug 跑一段，收集证据
2) 发现问题后 pause（或 global-pause），让线程停在 LLM 返回后
3) 人工改写 \`llm.output.json\`，再 resume，让系统执行修正后的工具调用
`,
};
