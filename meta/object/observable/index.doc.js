import { object_v20260504_1 } from "@meta/object/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { pause_v20260506_1 } from "@meta/object/observable/pause.doc";
import { debug_v20260506_1 } from "@meta/object/observable/debug.doc";
import { context_visibility_v20260506_1 } from "@meta/object/observable/context-visibility.doc";
import * as observable from "@src/observable/index";

export const observable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  sources: {
    observable,
  },
  index: `
Observable 描述 Object 如何被观察、被理解与被验证。

在 OOC 中，Object 的“思考过程”是可记录、可回放、可调试的。

可观察性来自两个来源：

- process events：线程里发生过什么（按时间线记录）
- effects：对象对外产生的副作用
    - 当前实现上，effects 主要体现在 events 中：
      - program 执行的 result / success
      - file_ops / http / git 等能力产生的痕迹（文件变更、输出、错误）

OOC 有两个与“观测/调试”直接相关的开关：pause 与 debug：

- pause：暂停执行（让线程进入 paused 状态），可人工介入后再 resume
- debug：持续写入每轮 LLM 的输入/输出/思考/元数据到 debug 文件，便于事后排查（不暂停执行）

两者独立：pause 会暂停但不要求写 debug；debug 会写文件但不暂停。

## 当前实现阶段

当前实现支持：

- 内存中的 latest LLM input/output 快照
- 当线程携带 persistence ref 时，覆盖写入：
  - \`threads/{threadId}/debug/llm.input.json\`
  - \`threads/{threadId}/debug/llm.output.json\`
- 当 debug mode 开启时，额外按轮次写入：
  - \`threads/{threadId}/debug/loop_0001.input.json\`
  - \`threads/{threadId}/debug/loop_0001.output.json\`
  - \`threads/{threadId}/debug/loop_0001.meta.json\`
- app server 进一步把 observable 的 pause / debug 状态提升成控制面 API，允许 web 直接查询与切换，而不是只在进程内部调用函数。

当前 observable 的运行时核心状态仍是**进程内易失状态**：

- \`latestLlmObservation\`：最近一次输入/输出快照
- \`debugEnabled\`：loop 级 debug 开关
- \`loopCounters\`：每个 thread 的轮次计数器；持久化线程按 \`baseDir:sessionId:objectId:threadId\` 计数，纯内存线程才退化到 \`ephemeral:\${id}\`
- \`pauseChecker\`：由 app server 注入的 pause 判定函数

对应进程内 API 包括：

- \`enableDebug() / disableDebug() / getDebugStatus()\`
- \`setPauseChecker() / isPausing()\`
- \`getLatestLlmObservation() / clearLatestLlmObservation() / clearObservableDebugState()\`
- \`beginLlmLoop() / finishLlmLoop()\`

当前 loop meta 覆盖字段：
- model / provider
- threadId / loopIndex
- startedAt / finishedAt / latency
- messageCount / toolCount / toolCallCount
- contextBytes / resultTextBytes
- status（ok / paused / error）
- error（若本轮失败）

这里有两个经常被混淆的边界：

- \`llm.input.json\` / \`llm.output.json\` 是“最近一次”覆盖写快照；只要线程可持久化，就会写。
- \`loop_0001.*.json\` 这类文件是“每轮留档”；只有 debug 打开时才额外写。

另外，当前磁盘上的 debug JSON 不是 provider 原始 payload，而是归一化后的调试记录：

- input 侧保存 \`{ threadId, inputItems }\`
- output 侧保存 \`{ threadId, outputItems, provider, model }\`
- 若本轮在拿到 result 之前就以 \`error\` 结束，debug 模式下仍会写 \`loop_XXXX.meta.json\`，但不保证存在对应 output 文件

可观察对象（概念层）:

- thread tree：线程结构、节点状态、父子线程关系
- context：本轮 LLM 输入窗口（哪些信息被注入、哪些 thread 可见）
- tool calls：LLM 行动
- errors：失败原因、堆栈、可复现证据

Observable 的目标:
- 让“对象为什么这么做”可解释
- 让“对象做了什么”可追溯
- 让“对象是否真的完成”可验证

当前 web 控制面已经把 \`llm.input.json\` 作为可观察性的直接入口之一：不仅能看原始 JSON，还能把 system message 内的 XML context 结构化展开，帮助人工定位“这一轮到底把什么上下文暴露给了模型”。

当前 web chat 视图也开始遵循“观测对象先归一化”的思路：原始 thread events 会先映射成 message / tool / notice 三种人类可读语义，再做卡片展示。这样 observable 不再只是“文件存在”，而是“人能快速判断发生了什么”。

## 这一轮的编程思想

1. **把可观测性从文件层提升到控制面层**
   - 文件仍是最终证据；
   - 但 pause/debug 的开关、session paused 状态、health online/offline 需要先成为查询/切换 API，才能稳定接到 UI。

2. **把“可看见”细分成两层**
   - 机器层：debug JSON、thread status、event log；
   - 人类层：tool card、notice card、XML tree viewer、Logo 状态色。

3. **运行时开关必须显式注入，不做隐式全局魔法**
   - pause 能力不是 thinkloop 自己猜出来的，而是 app server 通过 \`setPauseChecker(...)\` 注入；
   - 这样 observable 既能在纯内存测试中工作，也能在控制面 server 存在时复用同一套判定逻辑。

4. **解释优先于保真平铺**
   - 原始 event log 当然保真，但人类排障时最缺的是解释；
   - 因此本轮倾向于先保留原始证据，再增加解释视图，而不是让用户直接消费未经整理的 JSON。

## 子文档

- [pause](./pause.doc.js)                  暂停/恢复：人工检查点
- [debug](./debug.doc.js)                  debug 文件：事后排查
`,
  persistable: persistable_v20260504_1,
  pause: pause_v20260506_1,
  debug: debug_v20260506_1,
  contextVisibility: context_visibility_v20260506_1,
};
