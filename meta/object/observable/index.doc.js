import { object_v20260504_1 } from "@meta/object/index.doc";
import { pause_v20260517_1 } from "@meta/object/observable/pause.doc";
import { debug_v20260517_1 } from "@meta/object/observable/debug.doc";
import { context_visibility_v20260517_1 } from "@meta/object/observable/context-visibility.doc";
import * as observable from "@src/observable/index";

/**
 * Observable 概念：Object 的思考过程如何被记录、回放、调试。
 *
 * sources:
 *  - observable — 进程内 observable runtime：debug 开关、pause checker 注入、
 *                 latest LLM 输入输出快照、loop 计数器、debug 文件落盘的触发点
 *
 * 子概念（通过 concepts 暴露给 walker）：
 *  - pause             — 人工检查点：暂停执行、保留输出、人工介入后 resume
 *  - debug             — 事后排查：每轮 input/output/meta 落盘
 *  - contextVisibility — 观察本轮 LLM 输入窗口的组成与来源
 */
export const observable_v20260517_1 = {
  name: "Observable",
  get parent() { return object_v20260504_1; },
  sources: {
    observable,
  },
  description: `
Observable 描述 Object 的思考过程如何被记录、回放、调试。
可观察性来自两个来源：thread 事件流（线程里发生过什么）与对象产生的 effects
（program 执行结果、file_ops / http / git 痕迹等，当前主要体现在 events 中）。
`,

  switches_v20260517_1: {
    title: "两个独立的运行时开关",
    content: `
pause / debug 两个开关；语义、独立性、生命周期分别独立子节点。
    `,

    pauseSwitch_v20260517_1: {
      title: "pause 开关",
      content: `
暂停执行（让线程进入 paused 状态），可人工介入后再 resume。
      `,
    },

    debugSwitch_v20260517_1: {
      title: "debug 开关",
      content: `
持续写入每轮 LLM 的输入/输出/思考/元数据到 debug 文件，便于事后排查。
      `,
    },

    independence_v20260517_1: {
      title: "二者独立",
      content: `
pause 不要求写 debug，debug 不要求暂停——任意组合 (开/开、开/关、关/开、关/关)
都合法且语义清晰。这是把"观察"与"暂停"解耦的核心约束。
      `,
    },

    nonPersistent_v20260517_1: {
      title: "进程内非持久",
      content: `
两者都是进程内状态，server 重启不保留——属于控制面状态而非 world 持久化配置。
绑定 web 客户端时必须每次连接重新查询 status，不能依赖 LocalStorage 缓存。
      `,
    },
  },

  runtime_v20260517_1: {
    title: "进程内运行时核心",
    content: `
observable runtime 维护若干易失状态并对外暴露一组 API（运行时模块绑定见
sources.observable）。详见多个子节点。
    `,

    volatileState_v20260517_1: {
      title: "易失状态总览",
      content: `
四类进程内易失状态，server 重启全部丢失。每类独立子节点。
      `,

      latestLlmObservation_v20260517_1: {
        title: "latestLlmObservation",
        content: `
最近一次输入/输出快照；用于 debug viewer "latest" 端点直读，不依赖磁盘文件。
        `,
      },

      debugEnabled_v20260517_1: {
        title: "debugEnabled",
        content: `
loop 级 debug 开关。布尔值；为 true 时 finishLlmLoop 额外写 loop_NNNN.* 留档。
        `,
      },

      loopCounters_v20260517_1: {
        title: "loopCounters",
        content: `
每线程的轮次计数器，按 4 位 zero-pad 生成 loop_NNNN 编号。

key 选择规则（双轨）：

- 持久化线程：baseDir:sessionId:objectId:threadId
- 纯内存线程：退化到 ephemeral:\${id}

退化规则保证无 persistence 的线程也有稳定编号空间，不会与持久线程串号。
        `,
      },

      pauseChecker_v20260517_1: {
        title: "pauseChecker",
        content: `
由 app server 启动时通过 setPauseChecker 注入的 pause 判定函数；observable 模块
本身不知道 pause 来源，只在 thinkloop 调用 isPausing(thread)。
        `,
      },
    },

    publicApi_v20260517_1: {
      title: "对外 API 分组",
      content: `
按职责分四组：debug 开关、pause 注入、latest 快照、loop 生命周期。
      `,

      debugApi_v20260517_1: {
        title: "debug 开关 API",
        content: `
- enableDebug()
- disableDebug()
- getDebugStatus()
        `,
      },

      pauseApi_v20260517_1: {
        title: "pause 注入 API",
        content: `
- setPauseChecker()
- isPausing()
        `,
      },

      latestApi_v20260517_1: {
        title: "latest 快照 API",
        content: `
- getLatestLlmObservation()
- clearLatestLlmObservation()
- clearObservableDebugState()
        `,
      },

      loopApi_v20260517_1: {
        title: "loop 生命周期 API",
        content: `
- beginLlmLoop()
- finishLlmLoop()

成对调用，begin 写 input snapshot，finish 写 output snapshot 并触发 pause 判定。
        `,
      },
    },
  },

  fileBoundary_v20260517_1: {
    title: "文件层边界（与 persistable 共担）",
    content: `
两类 debug 文件经常被混淆，必须分清。详见四个子节点。
    `,

    latestFiles_v20260517_1: {
      title: "llm.input.json / llm.output.json — 最近一次覆盖写快照",
      content: `
只要线程带 persistence ref，每轮都写，与 debug 开关无关。文件名固定，每轮覆盖，
不保留历史轮次。
      `,
    },

    loopFiles_v20260517_1: {
      title: "loop_NNNN.{input,output,meta}.json — 每轮留档",
      content: `
4 位 zero-pad 编号。**双前提**：debug 打开 **且** 线程带 persistence ref 时才写。
两个前提缺一不可：纯内存线程即使 debug 开了也不写；persistence 线程 debug 关了
也不写。
      `,
    },

    payloadNormalization_v20260517_1: {
      title: "落盘不是 provider 原始 payload",
      content: `
落盘的是归一化后的调试记录（详见 debug 子概念的 record schema）。归一化目的：
跨 provider 一致的 viewer 解析格式 + 剔除 provider 实现细节（tools / instructions
不入 record）。
      `,
    },

    persistenceGate_v20260517_1: {
      title: "persistence ref 是落盘的唯一前提",
      content: `
无 persistence 的纯内存线程任何 debug 文件都不会落盘——latest 与 loop_NNNN 同时
缺席。viewer 只能通过进程内 latestLlmObservation API 读取，不能走文件路径。
      `,
    },
  },

  controlPlane_v20260517_1: {
    title: "控制面层",
    content: `
app server 把 observable 的 pause / debug 状态提升成控制面 API。
详见三个子节点：提升出的 API 列表、观察对象层级、整体目标。
    `,

    apis_v20260517_1: {
      title: "提升的 API",
      content: `
- pause：session / global 两层范围（详见 pause 子概念）
- debug：enable / disable / status + 文件读取（详见 debug 子概念）
- context-visibility：在 debug viewer 中解释每轮输入窗口的组成（详见 contextVisibility 子概念）

允许 web 直接查询与切换，而不是只在进程内部调用函数。
      `,
    },

    observationLayers_v20260517_1: {
      title: "观察对象层级",
      content: `
四层观察对象按抽象高度递增。详见子节点。
      `,

      threadTreeLayer_v20260517_1: {
        title: "thread tree",
        content: `
结构、节点状态、父子关系——观察"对象当前并发了哪些思考线"。
        `,
      },

      contextLayer_v20260517_1: {
        title: "context",
        content: `
本轮输入窗口——观察"对象本轮看到了什么"。详见 contextVisibility 子概念。
        `,
      },

      toolCallLayer_v20260517_1: {
        title: "tool calls",
        content: `
行动——观察"对象本轮想做什么"。
        `,
      },

      errorLayer_v20260517_1: {
        title: "errors",
        content: `
失败原因与堆栈——观察"对象在哪里以及为什么失败"。
        `,
      },
    },

    goals_v20260517_1: {
      title: "整体目标",
      content: `
三条目标互补：解释 / 追溯 / 验证。
      `,

      explainable_v20260517_1: {
        title: "\"对象为什么这么做\" 可解释",
        content: `
context 与 thinking 留档支撑事后回答这个问题。
        `,
      },

      traceable_v20260517_1: {
        title: "\"对象做了什么\" 可追溯",
        content: `
events + tool calls 留档支撑事后回答这个问题。
        `,
      },

      verifiable_v20260517_1: {
        title: "\"对象是否真的完成\" 可验证",
        content: `
reportPages + status + 输出留档支撑事后回答这个问题。
        `,
      },
    },
  },

  concepts: {
    pause: pause_v20260517_1,
    debug: debug_v20260517_1,
    contextVisibility: context_visibility_v20260517_1,
  },
};
