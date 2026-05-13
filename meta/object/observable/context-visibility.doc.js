import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const context_visibility_v20260506_1 = {
  get parent() { return observable_v20260504_1; },
  index: `
Context Visibility 描述如何观察每轮 LLM 输入窗口中的信息来源。

当前落地方式：

- debug 文件 `llm.input.json` 记录本轮传给 provider 的 `inputItems`。
- 其中 role=system 的 message.content 是由 `src/thinkable/context/render.ts` 生成的 XML context。
- app web 在查看 `llm.input.json` 时，会把这段 XML 继续解析成树：
  - 顶层可见 `context > thread`
  - 再向下可追踪 `active_forms` / `knowledge_entries` / `active_knowledge` / `windows` / `inbox` / `outbox`
  - XML 注释也会一并展示，保留 context builder 在结构上的说明信息

这让“哪些信息进入了本轮上下文、为什么会进入”从纯文本阅读，升级成可逐层展开的调试视图。

与之配套的 chat 控制面也做了相同方向的抽象：

- `function_call` / `function_call_output` 会被合并成一条 tool 语义；
- `inject` 被降级为 notice，而不是冒充用户消息；
- 用户消息只在 `inbox_message_arrived` 时显示。

本质上，这也是 context visibility 的一部分：**不是所有写进 thread 的东西都属于“对话”，要先区分“可见给模型的上下文”“系统过程事件”“真正的人机消息”。**
`,
};
