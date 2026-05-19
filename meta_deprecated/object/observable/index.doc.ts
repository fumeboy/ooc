import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import { pause_v20260517_1 } from "@meta/object/observable/pause.doc";
import { debug_v20260517_1 } from "@meta/object/observable/debug.doc";
import { context_visibility_v20260517_1 } from "@meta/object/observable/context-visibility.doc";
import * as observable from "@src/observable/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页:从这块就能看到 Observable 概念的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Observable 概念:Object 的思考过程如何被记录、回放、调试。
 *
 * sources:
 *  - observable — 进程内 observable runtime:debug 开关、pause checker 注入、
 *                 latest LLM 输入输出快照、loop 计数器、debug 文件落盘的触发点
 *
 * 子概念(通过 concepts 暴露给 walker):
 *  - pause             — 人工检查点
 *  - debug             — 事后排查
 *  - contextVisibility — 观察本轮 LLM 输入窗口
 */
export type ObservableConcept = Concept & {
  sources: {
    observable: typeof observable;
  };

  /** pause / debug 两个独立运行时开关 */
  switches: DocNode & {
    pauseSwitch: DocNode;
    debugSwitch: DocNode;
    /** pause 与 debug 任意组合都合法 */
    independence: InvariantNode;
    /** 进程内非持久状态 */
    nonPersistent: InvariantNode;
  };

  /** 进程内 observable runtime 易失状态与对外 API */
  runtime: DocNode & {
    volatileState: DocNode & {
      latestLlmObservation: DocNode;
      debugEnabled: DocNode;
      loopCounters: DocNode;
      pauseChecker: DocNode;
    };
    publicApi: DocNode & {
      debugApi: DocNode;
      pauseApi: DocNode;
      latestApi: DocNode;
      loopApi: DocNode;
    };
  };

  /** latest 与 loop_NNNN debug 文件落盘边界 */
  fileBoundary: DocNode & {
    latestFiles: DocNode;
    /** loop_NNNN.* 双前提:debug 开 + persistence ref */
    loopFiles: InvariantNode;
    payloadNormalization: DocNode;
    /** persistence ref 是落盘唯一前提 */
    persistenceGate: InvariantNode;
  };

  /** app server 提升出的控制面 API 与观察层级 */
  controlPlane: DocNode & {
    apis: DocNode;
    observationLayers: DocNode & {
      threadTreeLayer: DocNode;
      contextLayer: DocNode;
      toolCallLayer: DocNode;
      errorLayer: DocNode;
    };
    goals: DocNode & {
      explainable: DocNode;
      traceable: DocNode;
      verifiable: DocNode;
    };
  };

  /** 子概念集合 */
  concepts: {
    pause: Concept;
    debug: Concept;
    contextVisibility: Concept;
  };

  refs?: {
    pause: Concept;
    debug: Concept;
    contextVisibility: Concept;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const observable_v20260517_1: ObservableConcept = {
  name: "Observable",
  get parent() {
    return object_v20260504_1;
  },
  sources: {
    observable,
  },
  description: `
Observable 描述 Object 的思考过程如何被记录、回放、调试。
可观察性来自两个来源:thread 事件流(线程里发生过什么)与对象产生的 effects
(program 执行结果、file_ops / http / git 痕迹等,当前主要体现在 events 中)。
`.trim(),

  switches: {
    title: "两个独立的运行时开关",
    summary: "pause / debug 两个开关,语义、独立性、生命周期各自独立",

    pauseSwitch: {
      title: "pause 开关",
      summary: "暂停执行让线程进入 paused 状态,可人工介入后 resume",
      content: `暂停执行(让线程进入 paused 状态),可人工介入后再 resume。`,
    },

    debugSwitch: {
      title: "debug 开关",
      summary: "每轮 LLM 的输入/输出/思考/元数据写到 debug 文件",
      content: `持续写入每轮 LLM 的输入/输出/思考/元数据到 debug 文件,便于事后排查。`,
    },

    independence: {
      kind: "invariant",
      title: "二者独立",
      summary: "pause / debug 任意组合都合法且语义清晰",
      content: `
pause 不要求写 debug,debug 不要求暂停——任意组合 (开/开、开/关、关/开、关/关)
都合法且语义清晰。
      `.trim(),
      rationale: `
把"观察"与"暂停"耦合会让两者互相牵制——例如想长跑 debug 留档但不希望被暂停,
或想 pause 单步但不想堆磁盘。解耦是这层抽象的核心约束。
      `.trim(),
    },

    nonPersistent: {
      kind: "invariant",
      title: "进程内非持久",
      summary: "两者都是进程内状态,server 重启不保留",
      content: `
两者都是进程内状态,server 重启不保留——属于控制面状态而非 world 持久化配置。
绑定 web 客户端时必须每次连接重新查询 status,不能依赖 LocalStorage 缓存。
      `.trim(),
      rationale: `
控制面是运维瞬时态,不是用户配置。重启后保留会让"我重启了为什么还在 debug"这种
情况变成隐性事故。强制每次重新查询使前端状态与 server 真值始终对齐。
      `.trim(),
    },
  },

  runtime: {
    title: "进程内运行时核心",
    summary: "observable runtime 维护易失状态并对外暴露一组 API",

    volatileState: {
      title: "易失状态总览",
      summary: "四类进程内易失状态,server 重启全部丢失",

      latestLlmObservation: {
        title: "latestLlmObservation",
        summary: "最近一次输入/输出快照,debug viewer latest 端点直读",
        content: `最近一次输入/输出快照;用于 debug viewer "latest" 端点直读,不依赖磁盘文件。`,
      },

      debugEnabled: {
        title: "debugEnabled",
        summary: "loop 级 debug 开关布尔,true 时 finishLlmLoop 额外写留档",
        content: `loop 级 debug 开关。布尔值;为 true 时 finishLlmLoop 额外写 loop_NNNN.* 留档。`,
      },

      loopCounters: {
        title: "loopCounters",
        summary: "每线程轮次计数器,4 位 zero-pad,持久 / 纯内存双轨 key",
        content: `
每线程的轮次计数器,按 4 位 zero-pad 生成 loop_NNNN 编号。

key 选择规则(双轨):

- 持久化线程:baseDir:sessionId:objectId:threadId
- 纯内存线程:退化到 ephemeral:\${id}

退化规则保证无 persistence 的线程也有稳定编号空间,不会与持久线程串号。
        `.trim(),
      },

      pauseChecker: {
        title: "pauseChecker",
        summary: "由 app server 启动时 setPauseChecker 注入的判定函数",
        content: `
由 app server 启动时通过 setPauseChecker 注入的 pause 判定函数;observable 模块
本身不知道 pause 来源,只在 thinkloop 调用 isPausing(thread)。
        `.trim(),
      },
    },

    publicApi: {
      title: "对外 API 分组",
      summary: "按职责分四组:debug 开关 / pause 注入 / latest 快照 / loop 生命周期",

      debugApi: {
        title: "debug 开关 API",
        summary: "enableDebug / disableDebug / getDebugStatus",
        content: `
- enableDebug()
- disableDebug()
- getDebugStatus()
        `.trim(),
      },

      pauseApi: {
        title: "pause 注入 API",
        summary: "setPauseChecker / isPausing",
        content: `
- setPauseChecker()
- isPausing()
        `.trim(),
      },

      latestApi: {
        title: "latest 快照 API",
        summary: "getLatestLlmObservation / clearLatestLlmObservation / clearObservableDebugState",
        content: `
- getLatestLlmObservation()
- clearLatestLlmObservation()
- clearObservableDebugState()
        `.trim(),
      },

      loopApi: {
        title: "loop 生命周期 API",
        summary: "beginLlmLoop / finishLlmLoop 成对调用",
        content: `
- beginLlmLoop()
- finishLlmLoop()

成对调用,begin 写 input snapshot,finish 写 output snapshot 并触发 pause 判定。
        `.trim(),
      },
    },
  },

  fileBoundary: {
    title: "文件层边界(与 persistable 共担)",
    summary: "latest 文件 / loop_NNNN 文件 / 归一化 payload / persistence 门控",

    latestFiles: {
      title: "llm.input.json / llm.output.json",
      summary: "线程带 persistence ref 即每轮覆盖写,与 debug 开关无关",
      content: `
只要线程带 persistence ref,每轮都写,与 debug 开关无关。文件名固定,每轮覆盖,
不保留历史轮次。
      `.trim(),
    },

    loopFiles: {
      kind: "invariant",
      title: "loop_NNNN.{input,output,meta}.json 双前提",
      summary: "debug 打开 且 线程带 persistence ref 时才写,两个前提缺一不可",
      content: `
4 位 zero-pad 编号。**双前提**:debug 打开 **且** 线程带 persistence ref 时才写。
两个前提缺一不可:纯内存线程即使 debug 开了也不写;persistence 线程 debug 关了
也不写。
      `.trim(),
      rationale: `
没 persistence 的线程没有 thread 目录,loop 文件无处可落;debug 关闭时不写避免
"长跑线程意外堆磁盘"。两个前提确认写盘有归属空间且行为是用户显式选择的。
      `.trim(),
    },

    payloadNormalization: {
      title: "落盘不是 provider 原始 payload",
      summary: "归一化后的调试记录,跨 provider 一致 + 剔除实现细节",
      content: `
落盘的是归一化后的调试记录(详见 debug 子概念的 record schema)。归一化目的:
跨 provider 一致的 viewer 解析格式 + 剔除 provider 实现细节(tools / instructions
不入 record)。
      `.trim(),
    },

    persistenceGate: {
      kind: "invariant",
      title: "persistence ref 是落盘的唯一前提",
      summary: "无 persistence → 任何 debug 文件都不落盘,viewer 走进程内 API",
      content: `
无 persistence 的纯内存线程任何 debug 文件都不会落盘——latest 与 loop_NNNN 同时
缺席。viewer 只能通过进程内 latestLlmObservation API 读取,不能走文件路径。
      `.trim(),
      rationale: `
没有持久化空间就没有文件归属,强行写盘会污染 cwd 或冲突。把"是否落盘"完全收敛到
persistence ref 一个判定,避免 latest / loop 两条规则各自漂移导致状态不一致。
      `.trim(),
    },
  },

  controlPlane: {
    title: "控制面层",
    summary: "app server 把 pause / debug 提升成控制面 API + 四层观察对象 + 三条目标",

    apis: {
      title: "提升的 API",
      summary: "pause / debug / context-visibility 三组控制面 API",
      content: `
- pause:session / global 两层范围(详见 pause 子概念)
- debug:enable / disable / status + 文件读取(详见 debug 子概念)
- context-visibility:在 debug viewer 中解释每轮输入窗口的组成(详见 contextVisibility 子概念)

允许 web 直接查询与切换,而不是只在进程内部调用函数。
      `.trim(),
    },

    observationLayers: {
      title: "观察对象层级",
      summary: "四层观察对象按抽象高度递增:thread tree / context / tool calls / errors",

      threadTreeLayer: {
        title: "thread tree",
        summary: "结构 / 节点状态 / 父子关系——对象当前并发了哪些思考线",
        content: `结构、节点状态、父子关系——观察"对象当前并发了哪些思考线"。`,
      },

      contextLayer: {
        title: "context",
        summary: "本轮输入窗口——对象本轮看到了什么",
        content: `本轮输入窗口——观察"对象本轮看到了什么"。详见 contextVisibility 子概念。`,
      },

      toolCallLayer: {
        title: "tool calls",
        summary: "行动——对象本轮想做什么",
        content: `行动——观察"对象本轮想做什么"。`,
      },

      errorLayer: {
        title: "errors",
        summary: "失败原因与堆栈——对象在哪里以及为什么失败",
        content: `失败原因与堆栈——观察"对象在哪里以及为什么失败"。`,
      },
    },

    goals: {
      title: "整体目标",
      summary: "解释 / 追溯 / 验证三条目标互补",

      explainable: {
        title: `"对象为什么这么做" 可解释`,
        summary: "context 与 thinking 留档支撑事后回答",
        content: `context 与 thinking 留档支撑事后回答这个问题。`,
      },

      traceable: {
        title: `"对象做了什么" 可追溯`,
        summary: "events + tool calls 留档支撑事后回答",
        content: `events + tool calls 留档支撑事后回答这个问题。`,
      },

      verifiable: {
        title: `"对象是否真的完成" 可验证`,
        summary: "reportPages + status + 输出留档支撑事后回答",
        content: `reportPages + status + 输出留档支撑事后回答这个问题。`,
      },
    },
  },

  concepts: {
    pause: pause_v20260517_1,
    debug: debug_v20260517_1,
    contextVisibility: context_visibility_v20260517_1,
  },

  refs: {
    pause: pause_v20260517_1,
    debug: debug_v20260517_1,
    contextVisibility: context_visibility_v20260517_1,
  },
};
