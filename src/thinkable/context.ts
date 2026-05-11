import type { LlmMessage } from "./llm/types";
import type { ActiveForm } from "../executable/forms/form";
import type { ThreadPersistenceRef } from "../persistable/common";

/**
 * 线程过程事件。
 *
 * 只记录 ThinkLoop 单轮会直接产生或消费的事件；持久化、前端时间线和压缩策略
 * 都应围绕这个稳定事件流扩展，而不是把临时状态混入 system context。
 */
export type ProcessEvent =
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 普通文本回复，会作为 assistant message 进入下一轮 transcript。 */
      kind: "text";
      /** LLM 对外可见的文本内容。 */
      text: string;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 工具调用记录，先进入事件流，再由 executable 分派执行。 */
      kind: "tool_use";
      /** 当前文档定义的 tool 原语名称；compress 暂只保留类型位置。 */
      toolName: "open" | "refine" | "submit" | "close" | "wait" | "compress";
      /** 传给 tool handler 的原始参数对象。 */
      arguments: Record<string, unknown>;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** thinking 只用于记录回看，不作为推理上下文复喂。 */
      kind: "thinking";
      /** provider 返回的 thinking 文本。 */
      text: string;
    }
  | {
      /** 事件来源：系统、工具或外部输入导致的上下文变化。 */
      category: "context_change";
      /** 注入给下一轮 LLM 的提示，通常用于错误、状态变化或人工补充。 */
      kind: "inject";
      /** 注入内容，会以 user message 形式进入下一轮 transcript。 */
      text: string;
    };

/** 线程之间通过 inbox/outbox 传递的最小消息模型。 */
export type ThreadMessage = {
  /** 消息唯一标识；当前由创建方生成，不要求全局可排序。 */
  id: string;
  /** 发送消息的线程 ID。 */
  fromThreadId: string;
  /** 接收消息的线程 ID。 */
  toThreadId: string;
  /** 消息正文，直接作为接收线程可见的协作输入。 */
  content: string;
  /** 创建时间戳，用于排序和调试，不承担强一致时钟语义。 */
  createdAt: number;
  /** 消息来源；当前只区分 do 派生消息和系统消息。 */
  source: "do" | "system";
};

/**
 * 单个线程的运行时上下文。
 *
 * 这是 buildContext / think / scheduler 共享的最小结构，不等同于完整持久化模型。
 * 字段只在新版 meta 文档已经定义清楚时进入这里，避免把旧系统复杂度直接搬入。
 */
export type ThreadContext = {
  /** 线程唯一标识；同时用于 XML context 中的 thread id。 */
  id: string;
  /** 调度状态；只有 running 会被 scheduler 选中执行 ThinkLoop。 */
  status: "running" | "waiting" | "done" | "failed" | "paused";
  /** 当前线程的过程事件流，会被转换成 system message 之后的普通 LLM messages。 */
  events: ProcessEvent[];
  /** 线程树中的直接父线程；root thread 没有该字段。 */
  parentThreadId?: string;
  /** 创建本线程任务的线程，用于后续向 creator 汇报结果。 */
  creatorThreadId?: string;
  /** 子线程 ID 列表，保留创建顺序，便于展示和调试。 */
  childThreadIds?: string[];
  /** 子线程实体表；当前内存实现直接嵌套，不引入独立存储层。 */
  childThreads?: Record<string, ThreadContext>;
  /** 其他线程投递给当前线程的消息。 */
  inbox?: ThreadMessage[];
  /** 当前线程发出的协作消息记录。 */
  outbox?: ThreadMessage[];
  /** 当前线程的计划文本，由 plan command 覆盖式更新。 */
  plan?: string;
  /** 当前 open 但尚未 submit/close 的 form；todo 也通过这里表达。 */
  activeForms?: ActiveForm[];
  /** 已激活的 knowledge path；当前仅记录引用，不在本文件渲染正文。 */
  activatedKnowledge?: string[];
  /** 被显式固定的 knowledge path，避免普通 form 生命周期释放。 */
  pinnedKnowledge?: string[];
  /** 显式打开的知识或文件窗口；当前只保存窗口元信息。 */
  windows?: Record<
    string,
    {
      /** 窗口类型，决定后续 context builder 如何加载内容。 */
      type: "knowledge" | "file";
      /** knowledge path 或文件路径。 */
      path: string;
      /** 让 LLM 理解窗口用途的简短描述。 */
      description: string;
      /** 可选行范围；格式暂不收紧，等待 file/knowledge 模块定义。 */
      lines?: unknown;
      /** 可选列范围；格式暂不收紧，等待 file/knowledge 模块定义。 */
      columns?: unknown;
    }
  >;
  /** waiting 状态的原因，用于 scheduler 判断是否可唤醒。 */
  waitingType?: "explicit_wait" | "talk_sync" | "await_children";
  /** waitingType=await_children 时等待完成的子线程集合。 */
  awaitingChildren?: string[];
  /** end command 写入的结束原因。 */
  endReason?: string;
  /** end command 写入的最终摘要。 */
  endSummary?: string;
  /** 最近一次被 scheduler 执行的时间，用于公平选择下一个 running thread。 */
  lastExecutedAt?: number;
  /** 当前线程的持久化位置；缺失时系统只以内存模式运行。 */
  persistence?: ThreadPersistenceRef;
};

/** 转义 XML 特殊字符，保证 context 内容不会破坏标签结构。 */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 只在字段存在时渲染简单 XML 标签，避免空字段污染 context。 */
function renderOptionalTag(tag: string, value: string | undefined): string {
  if (!value) return "";
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

/** 将 inbox/outbox 消息数组渲染为结构化 XML 子树。 */
function renderMessages(tag: "inbox" | "outbox", messages: ThreadMessage[] | undefined): string {
  if (!messages || messages.length === 0) return "";

  const items = messages
    .map((message) => {
      return [
        `<message id="${escapeXml(message.id)}">`,
        `<from_thread_id>${escapeXml(message.fromThreadId)}</from_thread_id>`,
        `<to_thread_id>${escapeXml(message.toThreadId)}</to_thread_id>`,
        `<content>${escapeXml(message.content)}</content>`,
        `<source>${escapeXml(message.source)}</source>`,
        `<created_at>${String(message.createdAt)}</created_at>`,
        "</message>"
      ].join("");
    })
    .join("");

  return `<${tag}>${items}</${tag}>`;
}

/** 渲染 program command 自动激活的方法知识文本。 */
function renderMethodKnowledge(text: string | undefined): string {
  if (!text) return "";
  return `<method_knowledge>${escapeXml(text)}</method_knowledge>`;
}

/** 渲染当前未完成的 form，让 LLM 能继续 refine/submit/close。 */
function renderActiveForms(activeForms: ActiveForm[] | undefined): string {
  if (!activeForms || activeForms.length === 0) return "";

  const items = activeForms
    .map((form) => {
      const status = form.status ?? "open";
      const commandPaths = form.commandPaths.length
        ? `<command_paths>${form.commandPaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</command_paths>`
        : "";
      const loadedKnowledge = form.loadedKnowledgePaths.length
        ? `<loaded_knowledge>${form.loadedKnowledgePaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</loaded_knowledge>`
        : "";
      const resultXml = status === "executed" && form.result
        ? `<result>${escapeXml(form.result)}</result>`
        : "";
      const methodKnowledgeXml = renderMethodKnowledge(form.methodKnowledge);

      return [
        `<form id="${escapeXml(form.formId)}" status="${escapeXml(status)}">`,
        `<command>${escapeXml(form.command)}</command>`,
        `<description>${escapeXml(form.description)}</description>`,
        `<accumulated_args>${escapeXml(JSON.stringify(form.accumulatedArgs))}</accumulated_args>`,
        commandPaths,
        loadedKnowledge,
        methodKnowledgeXml,
        resultXml,
        "</form>"
      ].join("");
    })
    .join("");

  return `<active_forms>${items}</active_forms>`;
}

/** 把过程事件转换为 provider 无关的 LLM message；返回 null 表示该事件不进 transcript。 */
function processEventToMessage(event: ProcessEvent): LlmMessage | null {
  if (event.category === "context_change") {
    return {
      role: "user",
      content: `[context_change:${event.kind}]\n${event.text}`
    };
  }

  /**
   * tool_use 事件不进 transcript：
   * 1) 多 provider 中只有把它渲染成 native tool_use block 才能让模型识别为"我之前调用了工具"；
   *    渲染成纯文本 `[tool_use:NAME]\n{...}` 会让 Claude 在下一轮模仿这种文本形态，
   *    输出的 tool 调用变成 text 内容而不是真正的 tool call（实测过的幻觉）。
   * 2) 当前形态信息（active_forms / status / result）已通过 system XML context 完整暴露，
   *    LLM 知道"我现在有哪些 form"，不需要靠 transcript 回忆自己刚才点了什么。
   * 真正的 native tool_use 复述属于后续 provider 抽象升级，本阶段不做。
   */
  if (event.kind === "tool_use") {
    return null;
  }

  if (event.kind === "thinking") {
    return {
      role: "assistant",
      content: `[thinking]\n${event.text}`
    };
  }

  return {
    role: "assistant",
    content: event.text
  };
}

/**
 * 构造单轮 LLM 输入。
 *
 * 第一条 message 是 XML system context，承载稳定状态窗口；历史过程事件作为后续
 * 普通 messages 追加，避免把 transcript 混入 system prompt。
 */
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  const content = [
    "<context>",
    `<thread id="${escapeXml(thread.id)}" status="${escapeXml(thread.status)}">`,
    renderOptionalTag("creator_thread_id", thread.creatorThreadId),
    renderOptionalTag("parent_thread_id", thread.parentThreadId),
    renderOptionalTag("plan", thread.plan),
    renderActiveForms(thread.activeForms),
    renderMessages("inbox", thread.inbox),
    renderMessages("outbox", thread.outbox),
    "</thread>",
    "</context>"
  ].join("");

  const transcript = thread.events
    .map(processEventToMessage)
    .filter((message): message is LlmMessage => message !== null);

  return [
    {
      role: "system",
      content
    },
    ...transcript
  ];
}
