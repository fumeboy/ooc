import type { LlmInputItem, LlmMessage } from "../llm/types";
import { collectExecutableKnowledgeEntries } from "../../executable/index";
import type { ActiveForm } from "../../executable/forms/form";
import type { ThreadPersistenceRef } from "../../persistable/common";
import { renderContextXml } from "./render";

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
      /** Responses-first 一等 function_call 记录。 */
      kind: "function_call";
      /** 当前调用的稳定 ID。 */
      callId: string;
      /** 被调用的 OOC tool 名称。 */
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
    }
  | {
      /** 事件来源：外部输入到达，供 context builder 关联 inbox 中的新消息。 */
      category: "context_change";
      /** inbox 中有新消息到达。 */
      kind: "inbox_message_arrived";
      /** 到达消息的稳定标识。 */
      msgId: string;
      /** 可选的附加提示文本。 */
      text?: string;
    }
  | {
      /** 事件来源：tool 运行时结果。 */
      category: "tool_runtime";
      /** function_call 的输出结果。 */
      kind: "function_call_output";
      /** 与 function_call 对应的调用 ID。 */
      callId: string;
      /** 对应的 tool 名称。 */
      toolName: "open" | "refine" | "submit" | "close" | "wait" | "compress";
      /** 序列化后的输出字符串。 */
      output: string;
      /** 是否成功。 */
      ok: boolean;
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
  /**
   * 被显式固定的 knowledge path（通过 open(type=knowledge) pin / close(type=knowledge) 卸载）。
   * 自动激活由 activator 每轮基于 commandPaths 派生，不持久化在 thread 上。
   */
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

/** 基于 msgId 在 inbox 中查找实际消息正文。 */
function findInboxMessage(thread: ThreadContext, msgId: string): ThreadMessage | undefined {
  return thread.inbox?.find((message) => message.id === msgId);
}

function isErrorInject(text: string): boolean {
  return text.startsWith("[错误]") || text.includes("失败") || text.includes("Error") || text.includes("error");
}

/** 把过程事件转换为 Responses-first input items；返回空数组表示该事件不进 transcript。 */
function processEventToItems(thread: ThreadContext, event: ProcessEvent): LlmInputItem[] {
  if (event.category === "context_change" && event.kind === "inbox_message_arrived") {
    const inboxMessage = findInboxMessage(thread, event.msgId);
    return [
      {
      type: "message",
      role: "system",
        content:
          `[context_change:${event.kind}] msg_id=${event.msgId}` +
          `${inboxMessage ? ` from=${inboxMessage.fromThreadId}` : ""}` +
          `${event.text ? `\n${event.text}` : ""}`
      }
    ];
  }

  if (event.category === "context_change") {
    if (!isErrorInject(event.text)) {
      return [];
    }
    return [
      {
        type: "message",
        role: "system",
        content: `[context_change:error]\n${event.text}`
      }
    ];
  }

  if (event.kind === "tool_use") {
    return [];
  }

  if (event.kind === "function_call") {
    return [
      {
        type: "function_call",
        call_id: event.callId,
        name: event.toolName,
        arguments: event.arguments
      }
    ];
  }

  if (event.category === "tool_runtime") {
    return [
      {
        type: "function_call_output",
        call_id: event.callId,
        name: event.toolName,
        output: event.output
      }
    ];
  }

  if (event.kind === "thinking") {
    return [];
  }

  return [
    {
      type: "message",
      role: "assistant",
      content: event.text
    }
  ];
}

/**
 * 构造单轮 LLM 输入。
 *
 * 第一条 message 是 XML system context，承载稳定状态窗口；历史过程事件作为后续
 * 普通 messages 追加，避免把 transcript 混入 system prompt。
 */
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  const input = await buildInputItems(thread);
  return input.input
    .filter((item): item is Extract<LlmInputItem, { type: "message" }> => item.type === "message")
    .map((item) => ({ role: item.role, content: item.content }));
}

/** 构造 Responses-first LLM 输入 items。 */
export async function buildInputItems(
  thread: ThreadContext
): Promise<{ instructions?: string; input: LlmInputItem[] }> {
  const executableState = await collectExecutableKnowledgeEntries(thread.activeForms, thread);
  const content = await renderContextXml({
    thread,
    activeForms: executableState.activeForms,
    knowledgeEntries: executableState.knowledgeEntries,
  });

  const transcript = thread.events.flatMap((event) => processEventToItems(thread, event));

  return {
    input: [
      {
        type: "message",
        role: "system",
        content
      },
      ...transcript
    ]
  };
}
