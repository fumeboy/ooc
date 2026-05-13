import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const debug_v20260506_1 = {
  get parent() { return observable_v20260504_1; },
  index: `
Debug 模式用于“事后排查”：持续把每轮 ThinkLoop 的输入/输出/元数据写到文件。

注意：Debug 不会暂停执行（与 pause 独立）。

## 开关与 API

当前实现先提供进程内 API：

- \`enableDebug()\`
- \`disableDebug()\`
- \`getDebugStatus()\`

同时 app server 已把它们包装成控制面 HTTP API：

- \`GET /api/runtime/debug/status\`
- \`POST /api/runtime/debug/enable\`
- \`POST /api/runtime/debug/disable\`

这样 debug 不再只是测试或本地脚本里的函数调用，而是可以被 web/MainLogo 直接切换与确认的运行时状态。

## 文件落盘格式

当 debug 开启，Engine 每轮执行后写入：

- \`threads/{threadId}/debug/loop_NNN.input.json\`
- \`threads/{threadId}/debug/loop_NNN.output.json\`（包含 tool_calls）
- \`threads/{threadId}/debug/loop_NNN.meta.json\`（结构化元数据）

其中 meta.json 当前记录：model、provider、latency、messageCount、toolCount、toolCallCount、contextBytes、resultTextBytes、status、error。

## Web 调试查看方式

当前 app web 在浏览 debug 文件时，已经对 `llm.input.json` 提供专门 viewer：

- 先按 `inputItems` 分组显示本轮送入 provider 的 message / function_call / function_call_output / reasoning。
- 对 role=system 的 message，会继续解析其中的 XML context，展开为树形节点与详情面板。
- 这样排查时不必先手工复制 JSON，再去脑内还原 system prompt 的 XML 层级。

另外，web 的 MainLogo 也已经接入 debug status / enable / disable 接口：

- 默认灰：未开启 debug；
- 蓝色：debug 开启；
- 若同时叠加全局 pause，则 Logo 进入蓝橙渐变。

这里传达的思想是：**debug 不只是“文件会多写一点东西”，它应该成为人工操作面上的一等状态。**

## 与 pause 的关系

debug 解决“看见发生过什么”；pause 解决“在关键点停住并允许改写”。

常见组合：

1) 先开 debug 跑一段，收集证据
2) 观察 \`loop_NNN.*.json\` 还原每轮输入输出
3) 若需要人工干预，再配合 pause 能力处理
`,
};
