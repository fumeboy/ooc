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
 * 子概念（通过 \`concepts\` 暴露给 walker）：
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
`.trim(),

  switches_v20260517_1: {
    index: `
## 两个独立的运行时开关

- pause：暂停执行（让线程进入 paused 状态），可人工介入后再 resume
- debug：持续写入每轮 LLM 的输入/输出/思考/元数据到 debug 文件，便于事后排查

两者独立：pause 不要求写 debug，debug 不要求暂停。两者都是进程内状态，
server 重启不保留——属于控制面状态而非 world 持久化配置。
`.trim(),
  },

  runtime_v20260517_1: {
    index: `
## 进程内运行时核心

\`@src/observable\` 维护以下易失状态：

- \`latestLlmObservation\`：最近一次输入/输出快照
- \`debugEnabled\`：loop 级 debug 开关
- \`loopCounters\`：每线程的轮次计数器；持久化线程按
  \`baseDir:sessionId:objectId:threadId\` 计数，纯内存线程退化到 \`ephemeral:\${id}\`
- \`pauseChecker\`：由 app server 注入的 pause 判定函数

对外 API：

- \`enableDebug() / disableDebug() / getDebugStatus()\`
- \`setPauseChecker() / isPausing()\`
- \`getLatestLlmObservation() / clearLatestLlmObservation() / clearObservableDebugState()\`
- \`beginLlmLoop() / finishLlmLoop()\`
`.trim(),
  },

  fileBoundary_v20260517_1: {
    index: `
## 文件层边界（与 persistable 共担）

两类 debug 文件经常被混淆，必须分清：

- \`llm.input.json\` / \`llm.output.json\`：最近一次覆盖写快照。只要线程带 persistence ref，
  每轮都写，与 debug 开关无关。
- \`loop_NNNN.{input,output,meta}.json\`：每轮留档，4 位 zero-pad。只有 debug 打开
  且线程带 persistence ref 时才写。

落盘的不是 provider 原始 payload，而是归一化后的调试记录（详见 debug 子概念
的 record schema）。
`.trim(),
  },

  controlPlane_v20260517_1: {
    index: `
## 控制面层

app server 把 observable 的 pause / debug 状态提升成控制面 API，允许 web
直接查询与切换，而不是只在进程内部调用函数：

- pause：session / global 两层范围（详见 pause 子概念）
- debug：enable / disable / status + 文件读取（详见 debug 子概念）
- context-visibility：在 debug viewer 中解释每轮输入窗口的组成（详见 contextVisibility 子概念）

观察对象层级：thread tree（结构、节点状态、父子关系）、context（本轮输入窗口）、
tool calls（行动）、errors（失败原因与堆栈）。Observable 的目标是让"对象为什么这么做"
可解释、"对象做了什么"可追溯、"对象是否真的完成"可验证。
`.trim(),
  },

  concepts: {
    pause: pause_v20260517_1,
    debug: debug_v20260517_1,
    contextVisibility: context_visibility_v20260517_1,
  },
};
