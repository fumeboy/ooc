import * as observable from "@src/observable/index";
import * as debugFile from "@src/persistable/debug-file";
import * as enableDebugApi from "@src/app/server/modules/runtime/api.enable-debug";
import * as disableDebugApi from "@src/app/server/modules/runtime/api.disable-debug";
import * as getDebugStatusApi from "@src/app/server/modules/runtime/api.get-debug-status";
import * as getLatestDebugApi from "@src/app/server/modules/runtime/api.get-latest-debug";
import * as getLoopDebugApi from "@src/app/server/modules/runtime/api.get-loop-debug";

/**
 * Debug 概念：把每轮 ThinkLoop 的输入/输出/元数据落盘，用于事后排查。
 *
 * sources:
 *  - observable          — `enableDebug` / `disableDebug` / `getDebugStatus` /
 *                          `beginLlmLoop` / `finishLlmLoop` / latest snapshot 状态
 *  - debugFile           — llm.input/output.json + loop_NNNN.{input,output,meta}.json
 *                          的归一化 record schema、文件路径 helper、写入函数
 *  - enableDebugApi      — POST /api/runtime/debug/enable
 *  - disableDebugApi     — POST /api/runtime/debug/disable
 *  - getDebugStatusApi   — GET  /api/runtime/debug/status
 *  - getLatestDebugApi   — GET  /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug
 *  - getLoopDebugApi     — GET  /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex
 */
export const debug_v20260517_1 = {
  name: "Debug",
  sources: {
    observable,
    debugFile,
    enableDebugApi,
    disableDebugApi,
    getDebugStatusApi,
    getLatestDebugApi,
    getLoopDebugApi,
  },
  description: `
Debug 模式把每轮 ThinkLoop 的输入/输出/元数据写到文件，用于事后排查。
debug 与 pause 互相独立：debug 不暂停执行，pause 也不要求写 debug。
`.trim(),

  switch_v20260517_1: {
    index: `
## 开关

进程内 API（\`observable\` 暴露）：

- \`enableDebug()\`
- \`disableDebug()\`
- \`getDebugStatus()\`

app server 把它们包装成控制面 HTTP：

- POST /api/runtime/debug/enable
- POST /api/runtime/debug/disable
- GET  /api/runtime/debug/status

\`debugEnabled\` 是进程内布尔，server 重启不保留——属于控制面状态，不是 world 持久化配置。
`.trim(),
  },

  layout_v20260517_1: {
    index: `
## 文件落盘布局

线程只要带 persistence ref，每轮就覆盖写最近一次快照：

- \`threads/{threadId}/debug/llm.input.json\`
- \`threads/{threadId}/debug/llm.output.json\`

debug 开启后，每轮额外写留档文件：

- \`threads/{threadId}/debug/loop_NNNN.input.json\`
- \`threads/{threadId}/debug/loop_NNNN.output.json\`
- \`threads/{threadId}/debug/loop_NNNN.meta.json\`

轮次编号固定 4 位 zero-pad（\`0001 / 0002 / ...\`），由 \`debugFile\` helper 统一生成；
loop 计数 key 为 \`baseDir:sessionId:objectId:threadId\`，纯内存线程退化到 \`ephemeral:\${id}\`。
`.trim(),
  },

  recordSchema_v20260517_1: {
    index: `
## 盘面 record schema

落盘不是 provider 原始 payload，而是归一化后的调试记录：

- input：\`{ threadId, inputItems, contextSnapshot }\`
  - 不包含 provider 请求里的 \`tools\` / \`instructions\`
- output：\`{ threadId, outputItems, provider, model }\`
  - \`outputItems\` 从 \`thinking / text / toolCalls\` 投影出
- meta：\`threadId / loopIndex / model / provider / startedAt / finishedAt / latencyMs /
  messageCount / toolCount / toolCallCount / contextBytes / resultTextBytes /
  status (ok | paused | error) / error\`

边界：若本轮在拿到 provider result 之前失败，debug 模式仍会写 \`loop_NNNN.meta.json\`
（status=error），但不保证存在对应 \`loop_NNNN.output.json\`。
`.trim(),
  },

  controlPlaneReads_v20260517_1: {
    index: `
## 控制面读取接口

- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug
  返回最近一次快照（\`llm.input.json\` + \`llm.output.json\`）
- GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex
  返回指定轮次留档（\`loop_NNNN.input/output/meta.json\`）

两条 API 允许通过 query \`baseDir\` 覆盖世界根目录；未传时回退 \`process.cwd()\`。
缺文件返回 404；JSON 损坏返回 500。
`.trim(),
  },

  webViewer_v20260517_1: {
    index: `
## Web 调试视图

debug 不只是"文件会多写一点东西"，它是人工操作面上的一等状态：

- \`llm.input.json\` / \`loop_*.input.json\` 有专门 viewer：按 \`inputItems\` 分组展示
  本轮送入 provider 的 message / function_call / function_call_output / reasoning。
- role=system 的 message 进一步解析其中的 XML context，展开为树形节点与详情面板。
- viewer 同时展示 XML attrs / comments、字符数与粗略 token 估算；JSON 结构异常时
  回退原始只读视图。
- MainLogo 接入 \`/api/runtime/debug/{status,enable,disable}\`：未开启灰、开启蓝；
  叠加全局 pause 时进入蓝橙渐变。
`.trim(),
  },
};
