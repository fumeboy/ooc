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

import type { ActiveForm } from "./form.js";

/** 线程状态 */
export type ThreadStatus = "pending" | "running" | "waiting" | "done" | "failed" | "paused";

/** 线程句柄（think(fork) / createSubThread 的返回值） */
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

  /** 认知栈：静态 traits（think(fork) 时指定） */
  traits?: string[];
  /** 认知栈：动态激活的 traits */
  activatedTraits?: string[];
  /** 固定 trait：activatedTraits 的子集，submit/close 回收逻辑不会自动卸载它们。
   * - open(type="command") 自动带入的 trait → 进 activatedTraits 但**不**进 pinnedTraits（临时生效）
   * - open(type="trait", name=X) 显式打开 → 同时加入 pinnedTraits（固定）
   * - close 对应的"trait 型" form 可以 unpin */
  pinnedTraits?: string[];

  /** 输出契约 */
  outputs?: string[];
  outputDescription?: string;

  /** 完成摘要（结构化遗忘） */
  summary?: string;

  /** 当 status === "waiting" 时，标识具体在等什么。
   *  - "await_children": 在等子线程完成（await / await_all 触发）
   *  - "talk_sync":      在等其他对象的同步回复（talk_sync 触发）
   *  - "explicit_wait":  LLM 主动 wait 暂停（wait 工具触发） */
  waitingType?: "await_children" | "talk_sync" | "explicit_wait";

  /** 正在等待的子线程 ID 列表 */
  awaitingChildren?: string[];

  /** 复活次数（每次从 done → running 时 +1） */
  revivalCount?: number;

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

  /** 活跃的 form 列表（持久化，支持 resume）
   *
   *  ActiveForm 完整字段含 accumulatedArgs / commandPath / loadedTraits / trait / functionName。
   *  FormManager.fromData 对老数据缺失字段做了向后兼容默认值填充。 */
  activeForms?: ActiveForm[];

  /** 动态 context windows（open(type=file) 产生的可更新内容窗口） */
  windows?: Record<string, {
    /** 窗口名称（通常是文件路径） */
    name: string;
    /** 窗口内容 */
    content: string;
    /** 关联的 form_id（close 时用于清理） */
    formId: string;
    /** 更新时间 */
    updatedAt: number;
  }>;

  /**
   * Compact 模式下的待应用标记（submit compact 时消费并清空）
   *
   * 场景：LLM 通过 open(command="compact") 进入压缩模式后，会多轮调用
   * truncate_action / drop_action 累积标记；最后一次 submit compact 时才一次性生效。
   * 因为每轮 ThinkLoop 是独立调度的，标记必须跨轮持久化——存在 thread.json 里最简单。
   *
   * submit compact 执行后会被清空（undefined）。
   */
  compactMarks?: {
    /** 要丢弃的 action 索引（含 reason） */
    drops?: Array<{ idx: number; reason: string }>;
    /** 要截断的 action（保留前 maxLines 行） */
    truncates?: Array<{ idx: number; maxLines: number }>;
  };
}

/**
 * talk form 结构化表单（talk/talk_sync 可选携带）
 *
 * 当发起方已经心里有几个候选回复时，用它取代纯文本选项列表——
 * 接收方前端可以渲染为 option picker（按钮选项 + 自由文本兜底）。
 *
 * 设计要点：
 * - `allow_free_text` 业务上恒为 true，保留字段只为未来扩展。
 * - `options` 里每个选项有 `id`（用于回传标识）、`label`（显示标题）、`detail`（可选副标题）。
 * - 表单上 `formId` 由 engine 生成（`form_<ts>_<rand>`），作为 formResponse 的关联锚点。
 */
export interface TalkFormOption {
  id: string;
  label: string;
  detail?: string;
}

export interface TalkFormPayload {
  /** engine 生成的表单 id，用于关联 formResponse */
  formId: string;
  /** 表单类型：single_choice 单选 / multi_choice 多选 */
  type: "single_choice" | "multi_choice";
  /** 候选选项 */
  options: TalkFormOption[];
  /** 是否允许自由文本兜底（业务上恒为 true） */
  allow_free_text: boolean;
}

/**
 * 对某个 form 的结构化回复
 *
 * 场景：user 在 MessageSidebar 上点选/输入后，由 POST /api/talk/:target 的 body
 * 附带 formResponse，后端写入发起方 inbox 时作为结构化字段存下（同时也序列化到
 * inbox.content 让 LLM 可见）。
 *
 * - `selectedOptionIds`：用户点选的 option id；单选时长度 ≤ 1，多选时多个，纯自由文本回复时可能为空。
 * - `freeText`：用户自由文本输入（没填时为 null）。
 *
 * 合法组合：至少 `selectedOptionIds.length > 0` 或 `freeText` 非 null；
 * 两者都空视为"跳过"——前端应避免提交这种情况。
 */
export interface FormResponse {
  formId: string;
  selectedOptionIds: string[];
  freeText: string | null;
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
    | "mark_inbox"
    /**
     * compact_summary：对象主动压缩上下文后留下的摘要 action
     *
     * 由 submit compact 一次性生成：
     * - content 字段存 LLM 提供的 summary 纯文本
     * - original 字段记录压缩前的 action 总数
     * - kept 字段记录压缩后保留的 action 数（不含 compact_summary 本身）
     * - timestamp 被强制设为 min(所有原 action.timestamp) - 1，保证永远排在最前
     *
     * context-builder 的 renderThreadProcess 为此类型特化渲染，作为首条历史背景注入，
     * 让 LLM 在"清理过的工作台"前仍能看到整体情境。
     */
    | "compact_summary";
  timestamp: number;
  content: string;
  /** compact_summary: 压缩前 actions 总数（仅 compact_summary 使用） */
  original?: number;
  /** compact_summary: 压缩后保留的 actions 数（不含 compact_summary 本身） */
  kept?: number;
  /** tool_use: 工具名称；program: 代码内容；其他: 附加信息 */
  name?: string;
  /** tool_use: 工具参数（JSON 对象），已剥离顶层 title 字段 */
  args?: Record<string, unknown>;
  /**
   * tool_use: 自叙式行动标题（面向观察者的一句话意图）
   * LLM 在调用 tool 时通过 title 参数提供，engine 记录时剥离出来。
   * 前端 TuiAction 会把 title 作为卡片行首主标题展示。
   * 保持 optional 以兼容历史落盘数据。
   */
  title?: string;
  /** program: 执行结果 */
  result?: string;
  /** program: 执行是否成功 */
  success?: boolean;
  /**
   * message_out (talk/talk_sync): 可选结构化表单
   *
   * 当发起方的 LLM 调用 talk 时在 submit args 里带了 form 参数，engine 会把它
   * 带上生成的 formId 一并写到这个 action 的 form 字段，作为正文的"真数据"。
   * 前端按 (threadId, messageId=action.id) 反查后，若有 form，就把消息渲染成
   * option picker 而不是普通 bubble。
   */
  form?: TalkFormPayload;
  /**
   * message_in: 对方消息里对某个 form 的结构化回复
   *
   * 仅当 user（或其他对象）通过 talk API 附带 formResponse 回复时，后端把该
   * formResponse 同时写入 inbox 消息的 content（供 LLM 阅读）和此字段
   * （供前端结构化展示）。
   */
  formResponse?: FormResponse;
  /**
   * think / talk 的操作模式（2026-04-22 引入）
   *
   * 仅当 action 来源是 think / talk 指令（tool_use / message_out / create_thread）时写入，
   * 用于前端 TuiAction 渲染和问题追溯。
   * - "fork": 派生新线程（原线程只读，不被影响）
   * - "continue": 向原线程投递消息（产生影响，唤醒原线程）
   */
  context?: "fork" | "continue";
}

/**
 * 线程 inbox 消息（新类型，旧系统无对应）
 *
 * form / formResponse 字段仅在 talk 场景下出现：
 * - `form`：对方通过带 form 的 talk 发来的消息（引用式；真数据在发起方 action 里）
 * - `formResponse`：对方（通常是 user）对本对象先前发出的 form 的结构化回复
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
  /** 对方发来的 form（带选项的结构化消息；前端渲染为 option picker） */
  form?: TalkFormPayload;
  /** 对方对本对象先前 form 的结构化回复（形如 {formId, selectedOptionIds, freeText}） */
  formResponse?: FormResponse;
  /**
   * 消息类型标签（Phase 6）
   *
   * 目前识别值：
   * - `"relation_update_request"`：发起方通过 talk.continue.relation_update 发来的
   *   "请在你那边登记我们的关系" 请求；接收方的 context 用 <relation_update_request>
   *   徽章渲染，不自动写入任何关系文件（是否接受 / 拒绝由接收方自己决定）。
   * - 未来可扩展其他半结构化通知类型。
   */
  kind?: string;
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
 *
 * event 类型：
 * - "before" / "after"：线程生命周期钩子（think(fork) / return 时触发）
 * - "on:{command}"：command 钩子（对应 command 被 submit 时触发，如 "on:return"）
 *   由 defer command 在运行时注册，灵感来自 Go 的 defer 语法。
 */
export interface ThreadFrameHook {
  event: "before" | "after" | `on:${string}`;
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
