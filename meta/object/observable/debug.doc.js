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

线程只要带 persistence ref，就会覆盖写入最近一次：

- \`threads/{threadId}/debug/llm.input.json\`
- \`threads/{threadId}/debug/llm.output.json\`

当 debug 开启，Engine 每轮执行后还会额外写入：

- \`threads/{threadId}/debug/loop_0001.input.json\`
- \`threads/{threadId}/debug/loop_0001.output.json\`
- \`threads/{threadId}/debug/loop_0001.meta.json\`

其中轮次编号当前固定使用 **4 位 zero-pad**（\`0001 / 0002 / ...\`），由 persistable helper 统一生成。

其中 meta.json 当前记录：threadId、loopIndex、model、provider、startedAt、finishedAt、latency、messageCount、toolCount、toolCallCount、contextBytes、resultTextBytes、status、error。

当前盘面 schema 还有几个实现细节：

- \`llm.input.json\` 与 \`loop_XXXX.input.json\` 保存的是归一化后的 \`inputItems\`；不会把 provider 请求里的 \`tools\` / \`instructions\` 一并原样落盘。
- \`llm.output.json\` 与 \`loop_XXXX.output.json\` 保存的是从 \`thinking / text / toolCalls\` 投影出的 \`outputItems\`，外加 \`provider / model\`。
- 若一轮在拿到 provider result 之前就失败，debug 模式仍会写对应的 \`loop_XXXX.meta.json(status=error)\`，但未必存在 \`loop_XXXX.output.json\`。

注意：\`debugEnabled\` 本身是进程内布尔开关，server 重启后不会自动保留；因此它是“控制面状态”，不是 world 持久化配置。

## 控制面读取接口

除了 status / enable / disable，app server 还提供 debug 文件读取接口：

- \`GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug\`
- \`GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex\`

这让 web 与人工脚本都能基于同一 HTTP 契约读取最新快照和指定轮次的留档，而不必绕过 server 直接摸磁盘。

补充当前接口语义：

- 这两条 API 允许通过 query \`baseDir\` 覆盖世界根目录；未传时回退 \`process.cwd()\`。
- 缺失调试文件时返回 404；JSON 损坏时返回 500。

## Web 调试查看方式

当前 app web 在浏览 debug 文件时，已经对 \`llm.input.json\` 与 \`loop_*.input.json\` 提供专门 viewer：

- 先按 \`inputItems\` 分组显示本轮送入 provider 的 message / function_call / function_call_output / reasoning。
- 对 role=system 的 message，会继续解析其中的 XML context，展开为树形节点与详情面板。
- viewer 还会展示 XML attrs / comments、字符数与粗略 token 估算；如果 JSON 结构异常，则回退原始只读视图。
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
