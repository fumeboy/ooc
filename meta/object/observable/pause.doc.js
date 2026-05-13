import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const pause_v20260506_1 = {
  get parent() { return observable_v20260504_1; },
  index: `
Pause 是 OOC 的“人工检查点”：让对象停止继续执行，把 LLM 的最新输出保留下来，允许人类介入，然后再 resume。

OOC 里有两种“暂停”概念：

1) session 级 pause（暂停单个session下的所有对象）
- API：
  - POST \/api\/flows\/:sessionId\/pause
  - POST \/api\/flows\/:sessionId\/resume
- 语义：只影响该对象在某个 session 下的 ThinkLoop；暂停请求会让对象的 running 线程在“LLM 返回后”进入 paused。

2) 全局 pause（暂停所有对象）
- API：
  - POST \/api\/runtime\/global-pause\/enable
  - POST \/api\/runtime\/global-pause\/disable
  - GET  \/api\/runtime\/global-pause\/status
- 语义：当 global-pause 开启，所有对象都会在当前轮次结束后暂停（进入 paused）。

## 暂停发生在 ThinkLoop 的哪个点

暂停不是“打断 LLM 调用”，而是发生在 LLM 返回之后：

- Engine 在每轮构建完 messages 后会写入 \`threads/{id}/llm.input.json\`
- LLM 返回后，如果 pause 信号被检测到：
  - 把 LLM 输出缓存到 \`threads/{id}/llm.output.json\`
  - 将线程状态置为 paused
  - 本轮不再执行任何 tool calls

## resume 的语义

resume 不是“从头再跑一轮 LLM”，而是：

- 把 paused 的线程恢复为 running
- 从 \`threads/{id}/llm.input.json\` 读取上一轮未执行的 LLM 决策继续执行

## Web 控制面当前如何使用 pause

- session pause / resume 已经接入 chat composer 左下角按钮；
- global pause / resume 已经接入 MainLogo 顶部状态条；
- UI 不自己缓存另一套 pause 真相，而是直接读取 flows/runtime API 返回值。

这背后的实现原则是：**pause 是运行时状态，不是纯 UI 状态。**

因此：

- 真正的 pause 语义必须由 engine / app server 决定；
- web 只能查询、触发、展示；
- 一旦 pause 被提升成控制面能力，就必须提供 status API，而不仅是 enable/disable 的写操作。
`,
};
