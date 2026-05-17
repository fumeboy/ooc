import * as observable from "@src/observable/index";
import * as debugFile from "@src/persistable/debug-file";
import * as contextRender from "@src/thinkable/context/render";
import * as getLatestDebugApi from "@src/app/server/modules/runtime/api.get-latest-debug";
import * as getLoopDebugApi from "@src/app/server/modules/runtime/api.get-loop-debug";

/**
 * ContextVisibility 概念：让"本轮 LLM 输入窗口由什么组成、为什么会进入"可被逐层观察。
 *
 * sources:
 *  - observable          — `writeLatestLlmInput` / `beginLlmLoop` 在调用 LLM 前抓取
 *                          \`inputItems\` 与 contextSnapshot，是 viewer 的数据源头
 *  - debugFile           — \`captureContextSnapshot\` / \`normalizeInputItems\` 把
 *                          抓到的 input 归一化成可读 record
 *  - contextRender       — 把 thread 稳定状态序列化为 system message 用的 XML context
 *  - getLatestDebugApi   — viewer 读取最近一次快照的 HTTP 入口
 *  - getLoopDebugApi     — viewer 读取指定轮次留档的 HTTP 入口
 */
export const context_visibility_v20260517_1 = {
  name: "ContextVisibility",
  sources: {
    observable,
    debugFile,
    contextRender,
    getLatestDebugApi,
    getLoopDebugApi,
  },
  description: `
ContextVisibility 描述如何观察每轮 LLM 输入窗口中的信息来源：模型本轮看到的
"上下文"不是聊天记录平铺，而是 system XML + 被挑选过的过程事件 transcript，
两部分共同决定 \`debug/llm.input.json\` 里 \`inputItems\` 的形态。
`.trim(),

  pipeline_v20260517_1: {
    index: `
## 输入构造管线

三步：构造 input items → 渲染 system XML → 归一化落盘。
落盘的 \`inputItems\` 即 viewer 展开 context 树时读取的原始数据源。
`.trim(),

    buildInputItems_v20260517_1: {
      index: `
### 1. 构造 input items

\`buildInputItems()\` 先构造一条 role=system 的 XML context，再把 \`thread.events\`
映射成后续 transcript input items（Responses-first \`LlmInputItem\` 数组）。
`.trim(),
    },

    renderXml_v20260517_1: {
      index: `
### 2. 渲染 system XML

system message 的 \`content\` 由 \`contextRender.renderContextXml(thread)\` 生成；
节段组成详见 \`xmlSections\` 子节点。
`.trim(),
    },

    normalizeAndDump_v20260517_1: {
      index: `
### 3. 归一化与落盘

调用 LLM 前，\`observable.beginLlmLoop\` 通过 \`debugFile.normalizeInputItems\`
归一化、配合 \`captureContextSnapshot(thread)\` 一起写入 \`debug/llm.input.json\`
与（debug 模式下）\`debug/loop_NNNN.input.json\`。
`.trim(),
    },
  },

  xmlSections_v20260517_1: {
    index: `
## System XML 节段

\`renderContextXml()\` 把 thread 的稳定状态序列化为以下节段：

- \`plan\`
- \`active_forms\`
- \`knowledge_entries\`
- \`active_knowledge\`
- \`windows\`
- \`inbox\` / \`outbox\`

viewer 顶层可见 \`context > thread\`，再向下逐层展开上述节段；XML 注释一并展示，
保留 context builder 在结构上的说明信息。
`.trim(),
  },

  transcriptMapping_v20260517_1: {
    index: `
## 过程事件 → transcript 的映射

分三个子节点：进 transcript 的映射表、过滤规则、整体语义。
`.trim(),

    mappingTable_v20260517_1: {
      index: `
### 进 transcript 的映射表

| thread event | 映射 |
|---|---|
| \`function_call\` | \`function_call\` input item |
| \`function_call_output\` | \`function_call_output\` input item |
| \`thinking\` | assistant message |
| 普通 \`llm_interaction.text\` | assistant message |
`.trim(),
    },

    filteredOut_v20260517_1: {
      index: `
### 不进 transcript

- \`tool_use\` 只保留在事件流里，不复喂模型
- 非错误 \`context_change.inject\` 被过滤
- \`inbox_message_arrived\` 化为一条 system 标记消息，真正消息正文走 XML 的 \`inbox\` 节段
`.trim(),
    },

    overallSemantics_v20260517_1: {
      index: `
### 整体语义

模型本轮看到的"上下文"由 system XML + 被挑选过的过程事件 transcript 共同决定，
不是 thread 事件流的平铺复读。
`.trim(),
    },
  },

  renderingBoundaries_v20260517_1: {
    index: `
## XML 渲染边界

按内容类型分四个子节点：knowledge 截断、file window 边界、字符转义、
chat 控制面的同向抽象。
`.trim(),

    knowledgeTrunc_v20260517_1: {
      index: `
### knowledge 截断

knowledge 内容按字节数截断，避免把整库文本塞进 context。
`.trim(),
    },

    fileWindowLimit_v20260517_1: {
      index: `
### file window 字节上限

file window 有独立字节上限；读取失败写成 \`<error>\` 节点，不静默丢失。
`.trim(),
    },

    cdataEscaping_v20260517_1: {
      index: `
### CDATA / 字符转义

文本含 \`< > &\` 时序列化优先包成 CDATA，并处理 \`]]>\` 分裂，
尽量保留原文本。
`.trim(),
    },

    chatControlPlane_v20260517_1: {
      index: `
### chat 控制面同向抽象

与之配套的 chat 控制面同方向抽象：

- \`function_call\` 与 \`function_call_output\` 合并为一条 tool 语义
- \`inject\` 降级为 notice 而非冒充用户消息
- 用户消息只在 \`inbox_message_arrived\` 时显示
`.trim(),
    },
  },

  viewerSemantics_v20260517_1: {
    index: `
## Viewer 语义

debug viewer 通过 \`getLatestDebugApi\` 与 \`getLoopDebugApi\` 拿到归一化 \`inputItems\`，
对 role=system 的 message 继续解析 XML context，展开为树形节点与详情面板。
viewer 同时展示 XML attrs / comments、字符数与粗略 token 估算；JSON 损坏时
回退原始只读视图。它承担的是"解释输入结构"，不是"编辑输入内容"——观察面板而非配置面板。
`.trim(),
  },
};
