/**
 * 线程树类型定义
 *
 * 核心概念：Node = Thread = 栈帧
 * 每个 ProcessNode 同时是行为树节点、独立线程、认知栈帧。
 *
 * 命名约定：所有新类型以 Thread 前缀命名，避免与旧类型（Action, TodoItem, FrameHook）冲突。
 * 旧类型在 kernel/src/types/ 中，重构完成后将被删除。过渡期间两套类型共存。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#3
 */

/** 线程状态 */
export type ThreadStatus = "pending" | "running" | "waiting" | "done" | "failed" | "paused";

/** 线程句柄（create_sub_thread 的返回值） */
export type ThreadHandle = string;

/** 线程树结构索引（threads.json） */
export interface ThreadsTreeFile {
  rootId: string;
  nodes: Record<string, ThreadsTreeNodeMeta>;
}

/** 线程树节点元数据（不含 actions，存储在 threads.json 中） */
export interface ThreadsTreeNodeMeta {
  id: string;
  title: string;
  description?: string;
  status: ThreadStatus;
  parentId?: string;
  childrenIds: string[];

  /** 认知栈：静态 traits（create_sub_thread 时指定） */
  traits?: string[];
  /** 认知栈：动态激活的 traits */
  activatedTraits?: string[];

  /** 输出契约 */
  outputs?: string[];
  outputDescription?: string;

  /** 完成摘要（结构化遗忘） */
  summary?: string;

  /** 正在等待的子线程 ID 列表 */
  awaitingChildren?: string[];

  /** 创建者线程 ID（用于失败通知路由） */
  creatorThreadId?: string;
  /** 创建者所属 Object（跨 Object 时） */
  creatorObjectName?: string;

  /** 跨 Object talk 关联（仅 talk 创建的处理节点有此字段） */
  linkedWaitingNodeId?: string;
  linkedWaitingObjectName?: string;

  /** I2: 创建方式标记，Phase 3 的 Context builder 据此决定加载策略 */
  creationMode?: "sub_thread" | "sub_thread_on_node" | "talk";

  createdAt: number;
  updatedAt: number;
}

/** 单个线程的运行时数据（thread.json） */
export interface ThreadDataFile {
  id: string;
  actions: ThreadAction[];
  locals?: Record<string, unknown>;
  plan?: string;
  inbox?: ThreadInboxMessage[];
  todos?: ThreadTodoItem[];
  hooks?: ThreadFrameHook[];

  /** 用户设置的颜色图钉（前端 UI 标记用） */
  pins?: string[];

  /** 暂停时缓存的 LLM 输出（resume 时使用，跳过 LLM 调用） */
  _pendingOutput?: string;
  /** 暂停时缓存的 thinking 输出 */
  _pendingThinkingOutput?: string;
  /** 单步调试模式：执行一轮后自动暂停 */
  _debugMode?: boolean;

  /** 活跃的 form 列表（持久化，支持 resume） */
  activeForms?: Array<{
    formId: string;
    command: string;
    description: string;
    createdAt: number;
  }>;
}

/**
 * 线程 Action（替代旧 Action 类型）
 *
 * 与旧 Action 的区别：
 * - 新增 create_thread / thread_return 类型
 * - 删除 pause / stack_push / stack_pop 类型（不再需要）
 *
 * LLM 每轮输出的三种形态都会被记录：
 * - thinking: LLM 的思考过程（extended thinking 输出）
 * - text: LLM 的普通文本输出（非 tool 场景下的回复）
 * - tool_use: LLM 的工具调用（open/submit 等）
 *
 * 系统侧的 action 类型：
 * - inject: 系统注入的信息（form 创建、执行结果、错误提示等）
 * - program: 代码执行及其结果
 * - message_in / message_out: 跨对象消息
 * - create_thread / thread_return: 子线程管理
 * - set_plan: 计划变更
 * - mark_inbox: 标记 inbox 消息
 */
export interface ThreadAction {
  id?: string;
  type:
    | "thinking"
    | "text"
    | "tool_use"
    | "inject"
    | "program"
    | "message_in"
    | "message_out"
    | "create_thread"
    | "thread_return"
    | "set_plan"
    | "mark_inbox";
  timestamp: number;
  content: string;
  /** tool_use: 工具名称；program: 代码内容；其他: 附加信息 */
  name?: string;
  /** tool_use: 工具参数（JSON 对象） */
  args?: Record<string, unknown>;
  /** program: 执行结果 */
  result?: string;
  /** program: 执行是否成功 */
  success?: boolean;
}

/**
 * 线程 inbox 消息（新类型，旧系统无对应）
 */
export interface ThreadInboxMessage {
  id: string;
  from: string;
  content: string;
  timestamp: number;
  source: "talk" | "issue" | "thread_error" | "system";
  issueId?: string;
  status: "unread" | "marked";
  mark?: {
    type: "ack" | "ignore" | "todo";
    tip: string;
    markedAt: number;
  };
}

/**
 * 线程待办项（替代旧 TodoItem 类型）
 *
 * 与旧 TodoItem 的区别：
 * - 旧：{ nodeId, title, source } — 挂在 Process 上的全局 todo 队列
 * - 新：{ id, content, status, sourceMessageId } — 挂在节点上的局部 todo
 */
export interface ThreadTodoItem {
  id: string;
  content: string;
  sourceMessageId?: string;
  status: "pending" | "done";
  createdAt: number;
  doneAt?: number;
}

/**
 * 线程生命周期钩子（替代旧 FrameHook 类型）
 *
 * 与旧 FrameHook 的区别：
 * - 旧：{ id, when: HookTime, type: HookType, handler } — 复杂的 hook 系统
 * - 新：{ event, traitName, content, once } — 简化为纯文本 Context 注入
 */
export interface ThreadFrameHook {
  event: "before" | "after";
  traitName: string;
  content: string;
  once?: boolean;
}

/** 子线程的返回结果 */
export interface ThreadResult {
  summary: string;
  artifacts?: Record<string, unknown>;
  status: "done" | "failed";
}
