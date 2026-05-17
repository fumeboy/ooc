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
`,

  switch: {
    title: "开关",
    content: `
分三层：进程内 API、HTTP 控制面、状态生命周期。详见子节点。
    `,

    processApi: {
      title: "进程内 API（observable 暴露）",
      content: `
- enableDebug()
- disableDebug()
- getDebugStatus()
      `,
    },

    httpControlPlane: {
      title: "HTTP 控制面",
      content: `
- POST /api/runtime/debug/enable
- POST /api/runtime/debug/disable
- GET  /api/runtime/debug/status
      `,
    },

    stateLifecycle: {
      title: "状态生命周期",
      content: `
debugEnabled 是进程内布尔，server 重启不保留——属于控制面状态，
不是 world 持久化配置。
      `,
    },
  },

  layout: {
    title: "文件落盘布局",
    content: `
分三组：最近一次快照、debug 留档、轮次编号规则。
    `,

    latestSnapshot: {
      title: "最近一次快照",
      content: `
线程只要带 persistence ref，每轮就覆盖写：

- threads/{threadId}/debug/llm.input.json
- threads/{threadId}/debug/llm.output.json

与 debug 开关无关。
      `,
    },

    loopArchive: {
      title: "debug 留档（每轮）",
      content: `
debug 开启后，每轮额外写：

- threads/{threadId}/debug/loop_NNNN.input.json
- threads/{threadId}/debug/loop_NNNN.output.json
- threads/{threadId}/debug/loop_NNNN.meta.json
      `,
    },

    loopNumbering: {
      title: "轮次编号规则",
      content: `
轮次编号固定 4 位 zero-pad（0001 / 0002 / ...），由 debugFile helper 统一生成；
loop 计数 key 为 baseDir:sessionId:objectId:threadId，纯内存线程退化到 ephemeral:\${id}。
      `,
    },
  },

  recordSchema: {
    title: "盘面 record schema",
    content: `
落盘不是 provider 原始 payload，而是归一化后的调试记录。
分 input / output / meta 三种 record，加上失败时的部分写入边界。
    `,

    inputRecord: {
      title: "input record",
      content: `
{ threadId, inputItems, contextSnapshot }

- 不包含 provider 请求里的 tools / instructions
- inputItems 与 ContextVisibility 概念中所述同源
      `,
    },

    outputRecord: {
      title: "output record",
      content: `
{ threadId, outputItems, provider, model }

- outputItems 从 thinking / text / toolCalls 投影出
- provider / model 字段固定为本轮使用的 LLM 通道与具体模型名
      `,
    },

    metaRecord: {
      title: "meta record",
      content: `
包含本轮元信息字段。详见两个子节点。
      `,

      metaFields: {
        title: "字段清单",
        content: `
threadId / loopIndex / model / provider / startedAt / finishedAt / latencyMs /
messageCount / toolCount / toolCallCount / contextBytes / resultTextBytes /
status (ok | paused | error) / error
        `,
      },

      statusEnum: {
        title: "status 三态语义",
        content: `
- ok — 本轮正常完成
- paused — 本轮在 finishLlmLoop 后被 pause 拦截，未执行 tool calls
- error — 本轮中途异常退出（含拿到 result 前后两种情形）
        `,
      },
    },

    partialWriteBoundary: {
      title: "失败时的边界",
      content: `
若本轮在拿到 provider result 之前失败，debug 模式仍会写 loop_NNNN.meta.json
（status=error），但不保证存在对应 loop_NNNN.output.json。viewer 必须容忍
meta 存在而 output 缺失的状态，不能 join-fail 整轮。
      `,
    },
  },

  controlPlaneReads: {
    title: "控制面读取接口",
    content: `
两个 endpoint + 一组共同约定。详见子节点。
    `,

    latestEndpoint: {
      title: "GET .../debug",
      content: `
GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug

返回最近一次快照（llm.input.json + llm.output.json）。
      `,
    },

    loopEndpoint: {
      title: "GET .../debug/loops/:loopIndex",
      content: `
GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex

返回指定轮次留档（loop_NNNN.input/output/meta.json）。
      `,
    },

    conventions: {
      title: "共同约定",
      content: `
三条共享约定，每条独立子节点。
      `,

      baseDirOverride: {
        title: "baseDir 覆盖规则",
        content: `
两条 API 允许通过 query baseDir 覆盖世界根目录；未传时回退 process.cwd()。
让 viewer 可调试任意工作目录的 debug 文件，而不绑死在 server 启动目录。
        `,
      },

      notFoundIs404: {
        title: "缺文件返回 404",
        content: `
文件不存在时返回 HTTP 404，让前端区分"线程没跑过"与"服务错误"。
        `,
      },

      brokenJsonIs500: {
        title: "JSON 损坏返回 500",
        content: `
JSON 解析失败返回 500——这意味着 debugFile 写入逻辑有 bug 或被外部破坏，
应进入告警而不是被前端静默吞掉。
        `,
      },
    },
  },

  webViewer: {
    title: "Web 调试视图",
    content: `
debug 不只是"文件会多写一点东西"，它是人工操作面上的一等状态。
分四个视角：viewer 主面板、XML 树解析、显示扩充、状态条入口。
    `,

    mainPanel: {
      title: "viewer 主面板",
      content: `
llm.input.json / loop_*.input.json 有专门 viewer：按 inputItems 分组展示
本轮送入 provider 的 message / function_call / function_call_output / reasoning。
      `,
    },

    xmlTree: {
      title: "XML context 树解析",
      content: `
role=system 的 message 进一步解析其中的 XML context，展开为树形节点与详情面板。
      `,
    },

    enrichment: {
      title: "显示扩充",
      content: `
viewer 同时展示 XML attrs / comments、字符数与粗略 token 估算；
JSON 结构异常时回退原始只读视图。
      `,
    },

    mainLogoStatus: {
      title: "MainLogo 状态条",
      content: `
MainLogo 接入 /api/runtime/debug/{status,enable,disable}：
未开启灰、开启蓝；叠加全局 pause 时进入蓝橙渐变。
      `,
    },
  },
};
