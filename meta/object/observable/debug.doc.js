import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const debug_v20260506_1 = {
  parent: observable_v20260504_1,
  index: `
Debug 模式用于“事后排查”：持续把每轮 ThinkLoop 的输入/输出/元数据写到文件。

注意：Debug 不会暂停执行（与 pause 独立）。

## 开关与 API

当前实现先提供进程内 API：

- \`enableDebug()\`
- \`disableDebug()\`
- \`getDebugStatus()\`

## 文件落盘格式

当 debug 开启，Engine 每轮执行后写入：

- \`threads/{threadId}/debug/loop_NNN.input.json\`
- \`threads/{threadId}/debug/loop_NNN.output.json\`（包含 tool_calls）
- \`threads/{threadId}/debug/loop_NNN.meta.json\`（结构化元数据）

其中 meta.json 当前记录：model、provider、latency、messageCount、toolCount、toolCallCount、contextBytes、resultTextBytes、status、error。

## 与 pause 的关系

debug 解决“看见发生过什么”；pause 解决“在关键点停住并允许改写”。

常见组合：

1) 先开 debug 跑一段，收集证据
2) 观察 \`loop_NNN.*.json\` 还原每轮输入输出
3) 若需要人工干预，再配合 pause 能力处理
`,
};
