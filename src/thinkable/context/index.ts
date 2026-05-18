import type { LlmInputItem, LlmMessage } from "../llm/types";
import { collectExecutableKnowledgeEntries } from "../../executable/index";
import type { ContextWindow } from "../../executable/windows/types";
import type { ThreadPersistenceRef } from "../../persistable/common";
import { deriveStoneFromThread, objectDir, readSelf, stoneDir, threadDir } from "../../persistable";
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
  /** 发送方的 flow object id；跨对象 talk 时由 deliverTalkMessage 写入,便于 UI 标注发送方身份。
   *  旧 thread.json 缺该字段;前端要兼容空值。 */
  fromObjectId?: string;
  /** 消息正文，直接作为接收线程可见的协作输入。 */
  content: string;
  /** 创建时间戳，用于排序和调试，不承担强一致时钟语义。 */
  createdAt: number;
  /** 消息来源；step 2 加入 talk 与外部用户对话；user 区分"控制面代用户派送的 talk"。 */
  source: "do" | "system" | "talk" | "user";
  /**
   * 消息归属的 window id；
   * - 由 talk_window.say 写 outbox 时设置为该 talk_window 的 id
   * - 由 do_window.continue 可选设置（do_window 视图实际用 targetThreadId 过滤，本字段非必需）
   */
  windowId?: string;
  /**
   * 该消息是哪个 window 的回复目标；
   * - 由控制面 user-reply 路径填入：当 user 选择回复某个 talk_window 时，
   *   写入新 inbox 消息的 replyToWindowId = 那个 talk_window 的 id
   * - render 层据此把消息归入对应 talk_window 的 transcript
   */
  replyToWindowId?: string;
};

/**
 * 单个线程的运行时上下文。
 *
 * 这是 buildContext / think / scheduler 共享的最小结构，不等同于完整持久化模型。
 *
 * Step 1 重构（spec 2026-05-14）：
 * - 删除 activeForms / windows / pinnedKnowledge / waitingType / awaitingChildren
 * - 新增 contextWindows（统一抽象）+ threadLocalData（program_window step 2 使用，先占位）
 * - status="waiting" 单独表达"等待 inbox 新消息"，不再细分 waitingType（spec § 等待语义的简化）
 */
export type ThreadContext = {
  /** 线程唯一标识；同时用于 XML context 中的 thread id。 */
  id: string;
  /** 调度状态；status="waiting" 表示等待 inbox 新消息，不再有 waitingType 细分。 */
  status: "running" | "waiting" | "done" | "failed" | "paused";
  /** 当前线程的过程事件流，会被转换成 system message 之后的普通 LLM messages。 */
  events: ProcessEvent[];
  /** 线程树中的直接父线程；root thread 没有该字段。 */
  parentThreadId?: string;
  /** 创建本线程任务的线程，用于后续向 creator 汇报结果。 */
  creatorThreadId?: string;
  /**
   * 创建本线程的 object id；与 thread.persistence.objectId 比较即可判断 creator 是否=自己：
   * - 相同（含缺省，视为 fork） → creator 关系是 do（同 object 内派生子线程）
   * - 不同 → creator 关系是 talk（跨 object 的 callee thread）
   *
   * 由 talk-delivery / fork helper 在创建 callee/child thread 时写入；
   * 历史 thread.json 没有此字段时保守按"相同"处理（do）。
   */
  creatorObjectId?: string;
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
  /**
   * 当前线程的所有 ContextWindow（flat 数组，层级通过 parentWindowId 表达）。
   *
   * 取代旧的 activeForms / windows / pinnedKnowledge 三套并列字段。
   * 见 src/executable/windows/types.ts 与 spec § 模型骨架。
   */
  contextWindows: ContextWindow[];
  /**
   * thread-local 共享数据；Step 2 program_window 的 ts/js exec 之间通过这里传值
   * （spec § program_window 的"跨 exec 数据传递"段）。Step 1 仅占位、不读不写。
   */
  threadLocalData?: Record<string, unknown>;
  /** end command 写入的结束原因。 */
  endReason?: string;
  /** end command 写入的最终摘要。 */
  endSummary?: string;
  /** 最近一次被 scheduler 执行的时间，用于公平选择下一个 running thread。 */
  lastExecutedAt?: number;
  /**
   * 入眠时刻 inbox 长度快照；scheduler 唤醒时对比当前 inbox.length 判断是否有新消息。
   * status="waiting" 时由 wait tool 写入；唤醒后由 scheduler 重置为 undefined。
   * 见 spec § 等待语义的简化。
   */
  inboxSnapshotAtWait?: number;
  /**
   * status="waiting" 时由 wait tool 写入：本次 wait 引用的 IO 来源 window id。
   * 唤醒后由 scheduler 清空。observability/debug 用，Phase 1 不参与 wakeup 决策
   * （任何 inbox 新消息都唤醒）；Phase 2 可能据此做精确路由。
   * 见 docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md。
   */
  waitingOn?: string;
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
  const executableState = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
  const content = await renderContextXml({
    thread,
    contextWindows: executableState.contextWindows,
    knowledgeEntries: executableState.knowledgeEntries,
  });

  const transcript = thread.events.flatMap((event) => processEventToItems(thread, event));

  // self.md 是 Object 的对内身份说明（identity.innerSelf，见
  // meta/object/persistable/index.doc.ts stoneLayout）。这里把它作为顶层 instructions
  // 注入 LLM，让多个 Object 在同一 Session 中持有可区分的身份；不存在则保持原行为。
  const instructions = await loadSelfInstructions(thread);

  // [ooc:paths] 信息节点:把 Object 的持久化目录与 OOC world 路径告诉 LLM,
  // 让元编程动作("write_file 到我的 stones/<self>/..." / "engineer 一个新 server method")
  // 能落到正确路径。无 persistence(测试 fixture) 时不注入此节点。
  const pathsItem = buildPathsItem(thread);

  return {
    ...(instructions ? { instructions } : {}),
    input: [
      {
        type: "message",
        role: "system",
        content
      },
      ...(pathsItem ? [pathsItem] : []),
      ...transcript
    ]
  };
}

/**
 * 构造 [ooc:paths] system message。
 *
 * 把以下绝对路径告诉 LLM(每轮都注入,作为元编程 / 路径引用的稳定锚点):
 * - world_root:               OOC world 根目录(stones / flows 等所有子树的父目录)
 * - object_stone_dir:         本 Object 的 stone 目录(身份 / 知识 / server / client 长期存放)
 * - object_flow_dir:          本 Object 在当前 session 下的 flow 目录(临时产出 / 本次任务文件)
 * - current_thread_dir:       当前 thread 的 thread.json 所在目录(debug / loop_*.json 在这里)
 * - session_id / object_id / thread_id:  人类可读的标识
 *
 * 之所以放在 system message 而非 instructions:每轮都需要稳定看到、不被对话历史挤占;
 * 用 system role 与 XML context message 平行 — 都属于"环境信息"。
 */
function buildPathsItem(thread: ThreadContext): LlmInputItem | undefined {
  const ref = thread.persistence;
  if (!ref) return undefined;
  const stoneRef = deriveStoneFromThread(ref);
  const lines = [
    "[ooc:paths]",
    `world_root: ${ref.baseDir}`,
    `object_id: ${ref.objectId}`,
    `object_stone_dir: ${stoneDir(stoneRef)}`,
    `object_flow_dir: ${objectDir(ref)}`,
    `session_id: ${ref.sessionId}`,
    `current_thread_id: ${ref.threadId}`,
    `current_thread_dir: ${threadDir(ref)}`,
  ];
  return {
    type: "message",
    role: "system",
    content: lines.join("\n"),
  };
}

/**
 * 读取 thread 所属 Object 的 self.md 作为 instructions。
 *
 * - 内存模式（无 persistence）→ undefined，保持现有测试契约
 * - self.md 不存在或为空 → undefined
 * - 否则返回原文（trim 后非空校验）
 */
async function loadSelfInstructions(thread: ThreadContext): Promise<string | undefined> {
  if (!thread.persistence) return undefined;
  const stoneRef = deriveStoneFromThread(thread.persistence);
  const selfText = await readSelf(stoneRef);
  if (!selfText || !selfText.trim()) return undefined;
  return selfText;
}
