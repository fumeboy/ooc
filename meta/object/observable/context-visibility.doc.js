import { observable_v20260504_1 } from "@meta/object/observable/index.doc";

export const context_visibility_v20260506_1 = {
  get parent() { return observable_v20260504_1; },
  index: `
Context Visibility 描述如何观察每轮 LLM 输入窗口中的信息来源。

当前落地方式：

- \`buildInputItems()\` 会先构造一条 role=system 的 XML context，再把 thread.events 映射成后续 transcript input items。
- debug 文件 \`llm.input.json\` / \`loop_*.input.json\` 记录的就是这组 Responses-first \`inputItems\`。
- 其中第一条 system message 的 \`content\` 来自 \`src/thinkable/context/render.ts\` 生成的 XML context。
- app web 在查看这些 debug 文件时，会把这段 XML 继续解析成树：
  - 顶层可见 \`context > thread\`
  - 再向下可追踪 \`active_forms\` / \`knowledge_entries\` / \`active_knowledge\` / \`windows\` / \`inbox\` / \`outbox\`
  - XML 注释也会一并展示，保留 context builder 在结构上的说明信息

这让“哪些信息进入了本轮上下文、为什么会进入”从纯文本阅读，升级成可逐层展开的调试视图。

## 当前 context 是如何被构造的

1. **稳定状态走 XML system context**
   - \`renderContextXml()\` 负责把 thread 的稳定状态序列化为 XML：
     - \`plan\`
     - \`active_forms\`
     - \`knowledge_entries\`
     - \`active_knowledge\`
     - \`windows\`
     - \`inbox / outbox\`

2. **过程事件走 transcript items**
   - \`function_call\` → \`function_call\` item
   - \`function_call_output\` → \`function_call_output\` item
   - \`thinking\` → assistant message
   - 普通 \`llm_interaction.text\` → assistant message

3. **不是所有事件都会进入 transcript**
   - \`tool_use\` 只保留在事件流里，不直接复喂给模型
   - 非错误 \`context_change.inject\` 会被过滤，不进入下一轮 transcript
   - \`inbox_message_arrived\` 会变成一条 system 标记消息，而真正的消息正文仍通过 XML 中的 \`inbox\` 可见

这意味着：模型看到的“本轮上下文”并不是简单的聊天记录平铺，而是 **system XML + 被挑选过的过程事件 transcript**。

## XML 渲染边界

- knowledge 内容会按字节数截断，避免把整库文本一次性塞进 context。
- file window 也有独立字节上限；读取失败时会写成 \`<error>\` 节点，而不是静默消失。
- 当文本里出现 \`< > &\` 等会破坏 XML 结构的字符时，序列化会优先包成 CDATA，并处理 \`]]>\` 分裂问题，尽量保留原文本。

与之配套的 chat 控制面也做了相同方向的抽象：

- \`function_call\` / \`function_call_output\` 会被合并成一条 tool 语义；
- \`inject\` 被降级为 notice，而不是冒充用户消息；
- 用户消息只在 \`inbox_message_arrived\` 时显示。

本质上，这也是 context visibility 的一部分：**不是所有写进 thread 的东西都属于“对话”，要先区分“可见给模型的上下文”“系统过程事件”“真正的人机消息”。**

补充一点：web viewer 不只是“能展开 XML”，它还会展示 XML attrs / comments、字符数与粗略 token 估算，并在 debug JSON 损坏时回退原始只读视图；因此它承担的是“解释输入结构”，不是“编辑输入内容”。
`,
};
