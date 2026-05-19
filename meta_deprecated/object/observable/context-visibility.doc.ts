import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import * as observable from "@src/observable/index";
import * as debugFile from "@src/persistable/debug-file";
import * as contextRender from "@src/thinkable/context/render";
import * as getLatestDebugApi from "@src/app/server/modules/runtime/api.get-latest-debug";
import * as getLoopDebugApi from "@src/app/server/modules/runtime/api.get-loop-debug";

/* ────────────────────────────────────────────────────────────────
 *  目录页：从这块就能看到 ContextVisibility 概念的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * ContextVisibility 概念：让"本轮 LLM 输入窗口由什么组成、为什么会进入"可被逐层观察。
 *
 * sources:
 *  - observable          — `writeLatestLlmInput` / `beginLlmLoop` 在调用 LLM 前抓取
 *                          inputItems 与 contextSnapshot,是 viewer 的数据源头
 *  - debugFile           — captureContextSnapshot / normalizeInputItems 把
 *                          抓到的 input 归一化成可读 record
 *  - contextRender       — 把 thread 稳定状态序列化为 system message 用的 XML context
 *  - getLatestDebugApi   — viewer 读取最近一次快照的 HTTP 入口
 *  - getLoopDebugApi     — viewer 读取指定轮次留档的 HTTP 入口
 */
export type ContextVisibilityConcept = Concept & {
  sources: {
    observable: typeof observable;
    debugFile: typeof debugFile;
    contextRender: typeof contextRender;
    getLatestDebugApi: typeof getLatestDebugApi;
    getLoopDebugApi: typeof getLoopDebugApi;
  };

  /** 输入构造管线：input items → XML → 归一化落盘 */
  pipeline: DocNode & {
    buildInputItems: DocNode;
    renderXml: DocNode;
    normalizeAndDump: DocNode;
  };

  /** System XML 节段：各节段的来源与内容 */
  xmlSections: DocNode & {
    planSection: DocNode;
    activeFormsSection: DocNode;
    knowledgeEntriesSection: DocNode;
    activeKnowledgeSection: DocNode;
    windowsSection: DocNode;
    inboxOutboxSection: DocNode;
    viewerRendering: DocNode;
  };

  /** 过程事件 → transcript 的映射与过滤规则 */
  transcriptMapping: DocNode & {
    mappingTable: ExampleNode;
    filteredOut: DocNode & {
      toolUseFiltered: DocNode;
      injectFiltered: DocNode;
      inboxArrivedFiltered: DocNode;
    };
    overallSemantics: DocNode;
  };

  /** XML 渲染边界 */
  renderingBoundaries: DocNode & {
    knowledgeTrunc: DocNode;
    fileWindowLimit: DocNode;
    cdataEscaping: DocNode;
    chatControlPlane: DocNode;
  };

  /** Viewer 解释输入结构的语义约定 */
  viewerSemantics: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const context_visibility_v20260517_1: ContextVisibilityConcept = {
  name: "ContextVisibility",
  sources: {
    observable,
    debugFile,
    contextRender,
    getLatestDebugApi,
    getLoopDebugApi,
  },
  description: `
ContextVisibility 描述如何观察每轮 LLM 输入窗口中的信息来源:模型本轮看到的
"上下文"不是聊天记录平铺,而是 system XML + 被挑选过的过程事件 transcript,
两部分共同决定 debug/llm.input.json 里 inputItems 的形态。
`.trim(),

  pipeline: {
    title: "输入构造管线",
    summary: "三步:构造 input items → 渲染 system XML → 归一化落盘",

    buildInputItems: {
      title: "1. 构造 input items",
      summary: "buildInputItems() 拼 system XML + 后续 transcript 序列",
      content: `
buildInputItems() 先构造一条 role=system 的 XML context,再把 thread.events
映射成后续 transcript input items（Responses-first LlmInputItem 数组）。
      `.trim(),
    },

    renderXml: {
      title: "2. 渲染 system XML",
      summary: "contextRender.renderContextXml(thread) 生成 system content",
      content: `
system message 的 content 由 contextRender.renderContextXml(thread) 生成;
节段组成详见 xmlSections 子节点。
      `.trim(),
    },

    normalizeAndDump: {
      title: "3. 归一化与落盘",
      summary: "normalizeInputItems + captureContextSnapshot 写 debug/llm.input.json",
      content: `
调用 LLM 前,observable.beginLlmLoop 通过 debugFile.normalizeInputItems
归一化、配合 captureContextSnapshot(thread) 一起写入 debug/llm.input.json
与(debug 模式下)debug/loop_NNNN.input.json。
      `.trim(),
    },
  },

  xmlSections: {
    title: "System XML 节段",
    summary: "renderContextXml(thread) 把稳定状态序列化为若干节段",

    planSection: {
      title: "plan",
      summary: "当前线程的 plan 字段,由 LLM 通过 open(command=plan) 自维护",
      content: `当前线程的 plan 字段(由 LLM 通过 open(command="plan", ...) 自维护)。`,
    },

    activeFormsSection: {
      title: "active_forms",
      summary: "当前线程下打开但未 submit/close 的 form 列表",
      content: `当前线程下打开但未 submit/close 的 form 列表,用于"我正在处理什么"。`,
    },

    knowledgeEntriesSection: {
      title: "knowledge_entries",
      summary: "所有 candidate knowledge 的索引(path + description),不含正文",
      content: `所有 candidate knowledge 的索引(path + description),不含正文。`,
    },

    activeKnowledgeSection: {
      title: "active_knowledge",
      summary: "已激活并展开正文的 knowledge 列表(受截断规则影响)",
      content: `已激活并展开正文的 knowledge 列表。受 knowledge 截断规则影响(见 renderingBoundaries)。`,
    },

    windowsSection: {
      title: "windows",
      summary: "contextWindows 数组渲染,每个 window 按 type 展开",
      content: `contextWindows 数组渲染。每个 window 的 type 与 attrs 按类型解析展开。`,
    },

    inboxOutboxSection: {
      title: "inbox / outbox",
      summary: "未被任何 window 收纳的消息余量",
      content: `
未被任何 window 收纳的消息余量;详见 thinkable.context.specialReductions
中 inbox/outbox 兜底渲染规则。
      `.trim(),
    },

    viewerRendering: {
      title: "viewer 渲染约定",
      summary: "顶层 context > thread 树形展开,保留 XML 注释",
      content: `
viewer 顶层可见 context > thread,再向下逐层展开上述节段;XML 注释一并展示,
保留 context builder 在结构上的说明信息。
      `.trim(),
    },
  },

  transcriptMapping: {
    title: "过程事件 → transcript 的映射",
    summary: "进 transcript 的映射表 + 过滤规则 + 整体语义",

    mappingTable: {
      kind: "example",
      title: "进 transcript 的映射表",
      summary: "thread event 到 input item 的对应关系",
      content: `
| thread event | 映射 |
|---|---|
| function_call | function_call input item |
| function_call_output | function_call_output input item |
| thinking | assistant message |
| 普通 llm_interaction.text | assistant message |
      `.trim(),
    },

    filteredOut: {
      title: "不进 transcript",
      summary: "三条过滤规则:tool_use / 非错误 inject / inbox_arrived",

      toolUseFiltered: {
        title: "tool_use 只保留在事件流里",
        summary: "不复喂模型避免上下文 echo",
        content: `
不复喂模型——LLM 已经在上一轮看到自己说过的 tool_use,再喂会产生
"上下文 echo",让 LLM 困惑或自我强化。
        `.trim(),
      },

      injectFiltered: {
        title: "非错误 context_change.inject 被过滤",
        summary: "inject 是系统内部日志,错误 inject 保留",
        content: `
inject 是系统内部的上下文变更日志,对 LLM 而言不是行为历史。
错误(error inject)保留,因为 LLM 需要看到失败原因才能纠错。
        `.trim(),
      },

      inboxArrivedFiltered: {
        title: "inbox_message_arrived 化为 system 标记消息",
        summary: "真正消息正文走 XML 的 inbox 节段,避免重复回应",
        content: `
真正消息正文走 XML 的 inbox 节段——避免同一条消息既出现在 system 又出现在
transcript,导致 LLM 重复回应。transcript 中只保留"来信了"这条事件标记。
        `.trim(),
      },
    },

    overallSemantics: {
      title: "整体语义",
      summary: "system XML + 挑选过的 transcript 共同决定上下文,而非事件流平铺",
      content: `
模型本轮看到的"上下文"由 system XML + 被挑选过的过程事件 transcript 共同决定,
不是 thread 事件流的平铺复读。
      `.trim(),
    },
  },

  renderingBoundaries: {
    title: "XML 渲染边界",
    summary: "knowledge 截断 / file 上限 / 字符转义 / chat 控制面同向抽象",

    knowledgeTrunc: {
      title: "knowledge 截断",
      summary: "knowledge 内容按字节数截断",
      content: `knowledge 内容按字节数截断,避免把整库文本塞进 context。`,
    },

    fileWindowLimit: {
      title: "file window 字节上限",
      summary: "独立字节上限,读取失败写成 <error> 节点",
      content: `file window 有独立字节上限;读取失败写成 <error> 节点,不静默丢失。`,
    },

    cdataEscaping: {
      title: "CDATA / 字符转义",
      summary: "含 < > & 时优先 CDATA 包装,处理 ]]> 分裂",
      content: `
文本含 < > & 时序列化优先包成 CDATA,并处理 ]]> 分裂,
尽量保留原文本。
      `.trim(),
    },

    chatControlPlane: {
      title: "chat 控制面同向抽象",
      summary: "function_call+output 合并 / inject 降为 notice / 用户消息仅 inbox 显示",
      content: `
与之配套的 chat 控制面同方向抽象:

- function_call 与 function_call_output 合并为一条 tool 语义
- inject 降级为 notice 而非冒充用户消息
- 用户消息只在 inbox_message_arrived 时显示
      `.trim(),
    },
  },

  viewerSemantics: {
    title: "Viewer 语义",
    summary: "观察面板而非配置面板——解释输入结构,不编辑输入内容",
    content: `
debug viewer 通过 getLatestDebugApi 与 getLoopDebugApi 拿到归一化 inputItems,
对 role=system 的 message 继续解析 XML context,展开为树形节点与详情面板。
viewer 同时展示 XML attrs / comments、字符数与粗略 token 估算;JSON 损坏时
回退原始只读视图。它承担的是"解释输入结构",不是"编辑输入内容"——观察面板而非配置面板。
    `.trim(),
  },
};
