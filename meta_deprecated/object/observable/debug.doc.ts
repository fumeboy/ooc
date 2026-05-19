import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import * as observable from "@src/observable/index";
import * as debugFile from "@src/persistable/debug-file";
import * as enableDebugApi from "@src/app/server/modules/runtime/api.enable-debug";
import * as disableDebugApi from "@src/app/server/modules/runtime/api.disable-debug";
import * as getDebugStatusApi from "@src/app/server/modules/runtime/api.get-debug-status";
import * as getLatestDebugApi from "@src/app/server/modules/runtime/api.get-latest-debug";
import * as getLoopDebugApi from "@src/app/server/modules/runtime/api.get-loop-debug";

/* ────────────────────────────────────────────────────────────────
 *  目录页:从这块就能看到 Debug 概念的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Debug 概念:把每轮 ThinkLoop 的输入/输出/元数据落盘,用于事后排查。
 *
 * sources:
 *  - observable          — enableDebug / disableDebug / getDebugStatus /
 *                          beginLlmLoop / finishLlmLoop / latest snapshot 状态
 *  - debugFile           — llm.input/output.json + loop_NNNN.{input,output,meta}.json
 *                          的归一化 record schema、文件路径 helper、写入函数
 *  - enableDebugApi      — POST /api/runtime/debug/enable
 *  - disableDebugApi     — POST /api/runtime/debug/disable
 *  - getDebugStatusApi   — GET  /api/runtime/debug/status
 *  - getLatestDebugApi   — GET  .../debug
 *  - getLoopDebugApi     — GET  .../debug/loops/:loopIndex
 */
export type DebugConcept = Concept & {
  sources: {
    observable: typeof observable;
    debugFile: typeof debugFile;
    enableDebugApi: typeof enableDebugApi;
    disableDebugApi: typeof disableDebugApi;
    getDebugStatusApi: typeof getDebugStatusApi;
    getLatestDebugApi: typeof getLatestDebugApi;
    getLoopDebugApi: typeof getLoopDebugApi;
  };

  /** 开关:进程内 API / HTTP 控制面 / 状态生命周期 */
  switch: DocNode & {
    processApi: DocNode;
    httpControlPlane: DocNode;
    stateLifecycle: DocNode;
  };

  /** 文件落盘布局:最近快照 + 留档 + 编号规则 */
  layout: DocNode & {
    latestSnapshot: DocNode;
    loopArchive: DocNode;
    loopNumbering: DocNode;
  };

  /** input / output / meta record 归一化结构 */
  recordSchema: DocNode & {
    inputRecord: DocNode;
    outputRecord: DocNode;
    metaRecord: DocNode & {
      metaFields: DocNode;
      statusEnum: DocNode;
    };
    /** meta 可单独存在,viewer 必须容忍 */
    partialWriteBoundary: InvariantNode;
  };

  /** debug viewer 读取的 HTTP endpoint */
  controlPlaneReads: DocNode & {
    latestEndpoint: DocNode;
    loopEndpoint: DocNode;
    conventions: DocNode & {
      baseDirOverride: DocNode;
      /** 缺文件返回 404 */
      notFoundIs404: InvariantNode;
      /** JSON 损坏返回 500 */
      brokenJsonIs500: InvariantNode;
    };
  };

  /** web 调试视图各视角 */
  webViewer: DocNode & {
    mainPanel: DocNode;
    xmlTree: DocNode;
    enrichment: DocNode;
    mainLogoStatus: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const debug_v20260517_1: DebugConcept = {
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
Debug 模式把每轮 ThinkLoop 的输入/输出/元数据写到文件,用于事后排查。
debug 与 pause 互相独立:debug 不暂停执行,pause 也不要求写 debug。
`.trim(),

  switch: {
    title: "开关",
    summary: "进程内 API / HTTP 控制面 / 状态生命周期三层",

    processApi: {
      title: "进程内 API(observable 暴露)",
      summary: "enableDebug / disableDebug / getDebugStatus",
      content: `
- enableDebug()
- disableDebug()
- getDebugStatus()
      `.trim(),
    },

    httpControlPlane: {
      title: "HTTP 控制面",
      summary: "/api/runtime/debug/{enable,disable,status}",
      content: `
- POST /api/runtime/debug/enable
- POST /api/runtime/debug/disable
- GET  /api/runtime/debug/status
      `.trim(),
    },

    stateLifecycle: {
      title: "状态生命周期",
      summary: "进程内布尔,server 重启不保留",
      content: `
debugEnabled 是进程内布尔,server 重启不保留——属于控制面状态,
不是 world 持久化配置。
      `.trim(),
    },
  },

  layout: {
    title: "文件落盘布局",
    summary: "最近一次快照 + debug 留档 + 轮次编号规则",

    latestSnapshot: {
      title: "最近一次快照",
      summary: "线程带 persistence ref 即每轮覆盖写,与 debug 开关无关",
      content: `
线程只要带 persistence ref,每轮就覆盖写:

- threads/{threadId}/debug/llm.input.json
- threads/{threadId}/debug/llm.output.json

与 debug 开关无关。
      `.trim(),
    },

    loopArchive: {
      title: "debug 留档(每轮)",
      summary: "debug 开启 + 带 persistence 时每轮额外写 loop_NNNN.* 三件",
      content: `
debug 开启后,每轮额外写:

- threads/{threadId}/debug/loop_NNNN.input.json
- threads/{threadId}/debug/loop_NNNN.output.json
- threads/{threadId}/debug/loop_NNNN.meta.json
      `.trim(),
    },

    loopNumbering: {
      title: "轮次编号规则",
      summary: "4 位 zero-pad,key=baseDir:sessionId:objectId:threadId(纯内存退化)",
      content: `
轮次编号固定 4 位 zero-pad(0001 / 0002 / ...),由 debugFile helper 统一生成;
loop 计数 key 为 baseDir:sessionId:objectId:threadId,纯内存线程退化到 ephemeral:\${id}。
      `.trim(),
    },
  },

  recordSchema: {
    title: "盘面 record schema",
    summary: "input / output / meta 归一化记录,落盘不是 provider 原始 payload",

    inputRecord: {
      title: "input record",
      summary: "{ threadId, inputItems, contextSnapshot },不含 tools/instructions",
      content: `
{ threadId, inputItems, contextSnapshot }

- 不包含 provider 请求里的 tools / instructions
- inputItems 与 ContextVisibility 概念中所述同源
      `.trim(),
    },

    outputRecord: {
      title: "output record",
      summary: "{ threadId, outputItems, provider, model }",
      content: `
{ threadId, outputItems, provider, model }

- outputItems 从 thinking / text / toolCalls 投影出
- provider / model 字段固定为本轮使用的 LLM 通道与具体模型名
      `.trim(),
    },

    metaRecord: {
      title: "meta record",
      summary: "本轮元信息:字段清单 + status 三态语义",

      metaFields: {
        title: "字段清单",
        summary: "threadId / loopIndex / model / provider / 时间 / 字节 / 计数 / status",
        content: `
threadId / loopIndex / model / provider / startedAt / finishedAt / latencyMs /
messageCount / toolCount / toolCallCount / contextBytes / resultTextBytes /
status (ok | paused | error) / error
        `.trim(),
      },

      statusEnum: {
        title: "status 三态语义",
        summary: "ok / paused / error",
        content: `
- ok — 本轮正常完成
- paused — 本轮在 finishLlmLoop 后被 pause 拦截,未执行 tool calls
- error — 本轮中途异常退出(含拿到 result 前后两种情形)
        `.trim(),
      },
    },

    partialWriteBoundary: {
      kind: "invariant",
      title: "meta 可单独存在,viewer 必须容忍",
      summary: "本轮 result 前失败仍写 meta(status=error),output 可能缺失",
      content: `
若本轮在拿到 provider result 之前失败,debug 模式仍会写 loop_NNNN.meta.json
(status=error),但不保证存在对应 loop_NNNN.output.json。viewer 必须容忍
meta 存在而 output 缺失的状态,不能 join-fail 整轮。
      `.trim(),
      rationale: `
事后排查的核心信息是"为什么失败",meta 比 output 更关键。强制 viewer 兼容
"缺 output"避免一次 provider 异常就把整轮 debug 视图打挂。
      `.trim(),
    },
  },

  controlPlaneReads: {
    title: "控制面读取接口",
    summary: "两个 endpoint + 一组共同约定",

    latestEndpoint: {
      title: "GET .../debug",
      summary: "返回最近一次快照(llm.input.json + llm.output.json)",
      content: `
GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug

返回最近一次快照(llm.input.json + llm.output.json)。
      `.trim(),
    },

    loopEndpoint: {
      title: "GET .../debug/loops/:loopIndex",
      summary: "返回指定轮次留档(loop_NNNN.input/output/meta.json)",
      content: `
GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex

返回指定轮次留档(loop_NNNN.input/output/meta.json)。
      `.trim(),
    },

    conventions: {
      title: "共同约定",
      summary: "baseDir 覆盖 / 404 / 500 三条共享约定",

      baseDirOverride: {
        title: "baseDir 覆盖规则",
        summary: "query baseDir 覆盖世界根目录,未传时回退 process.cwd()",
        content: `
两条 API 允许通过 query baseDir 覆盖世界根目录;未传时回退 process.cwd()。
让 viewer 可调试任意工作目录的 debug 文件,而不绑死在 server 启动目录。
        `.trim(),
      },

      notFoundIs404: {
        kind: "invariant",
        title: "缺文件返回 404",
        summary: "文件不存在 → 404,区分'没跑过'与'服务错误'",
        content: `文件不存在时返回 HTTP 404,让前端区分"线程没跑过"与"服务错误"。`,
        rationale: `
若用 500 兜底,前端看不出是真错误还是单纯"线程还没跑过",会把正常空状态当告警弹。
404 显式表达"目标资源未生成",让前端有清晰分支可走。
        `.trim(),
      },

      brokenJsonIs500: {
        kind: "invariant",
        title: "JSON 损坏返回 500",
        summary: "JSON 解析失败 → 500,进入告警而非前端静默吞掉",
        content: `
JSON 解析失败返回 500——这意味着 debugFile 写入逻辑有 bug 或被外部破坏,
应进入告警而不是被前端静默吞掉。
        `.trim(),
        rationale: `
写入到落盘期间 JSON 不应损坏。若损坏说明 debugFile 有 bug 或文件被外部改写,
必须以服务错误形态被监控,而不是被前端用空数据掩盖。
        `.trim(),
      },
    },
  },

  webViewer: {
    title: "Web 调试视图",
    summary: "debug 是人工操作面上的一等状态,viewer 主面板 + XML 树 + 显示扩充 + 状态条",

    mainPanel: {
      title: "viewer 主面板",
      summary: "按 inputItems 分组展示 message / function_call / output / reasoning",
      content: `
llm.input.json / loop_*.input.json 有专门 viewer:按 inputItems 分组展示
本轮送入 provider 的 message / function_call / function_call_output / reasoning。
      `.trim(),
    },

    xmlTree: {
      title: "XML context 树解析",
      summary: "role=system message 中的 XML context 展开为树形节点",
      content: `role=system 的 message 进一步解析其中的 XML context,展开为树形节点与详情面板。`,
    },

    enrichment: {
      title: "显示扩充",
      summary: "XML attrs / comments、字符数、token 估算,损坏时回退原始视图",
      content: `
viewer 同时展示 XML attrs / comments、字符数与粗略 token 估算;
JSON 结构异常时回退原始只读视图。
      `.trim(),
    },

    mainLogoStatus: {
      title: "MainLogo 状态条",
      summary: "未开灰 / 开启蓝 / 叠加 pause 蓝橙渐变",
      content: `
MainLogo 接入 /api/runtime/debug/{status,enable,disable}:
未开启灰、开启蓝;叠加全局 pause 时进入蓝橙渐变。
      `.trim(),
    },
  },
};
