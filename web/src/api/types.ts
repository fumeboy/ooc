/**
 * 前端 API 类型定义
 *
 * @ref src/shared/types/object.ts — references — StoneData 后端类型镜像
 * @ref src/shared/types/flow.ts — references — FlowData, Action 后端类型镜像
 * @ref src/shared/types/process.ts — references — Process, ProcessNode 后端类型镜像
 * @ref src/shared/types/trait.ts — references — TraitDefinition 后端类型镜像
 */
/** 对象摘要（列表用） */
export interface ObjectSummary {
  name: string;
  talkable: { whoAmI: string; functions: { name: string; description: string }[] };
  traits: string[];
  relations: { name: string; description: string }[];
  data: Record<string, unknown>;
  paused?: boolean;
}

/** Stone 完整数据 */
export interface StoneData {
  name: string;
  thinkable: { whoAmI: string };
  talkable: { whoAmI: string; functions: { name: string; description: string }[] };
  data: Record<string, unknown>;
  relations: { name: string; description: string }[];
  traits: string[];
  memory?: string;
}

/** Flow 状态 */
export type FlowStatus = "running" | "waiting" | "pausing" | "finished" | "failed";

/** Action 类型 */
export type ActionType =
  | "thinking"
  | "text"
  | "tool_use"
  | "program"
  | "message_in"
  | "message_out"
  | "inject"
  | "set_plan"
  | "mark_inbox"
  | "create_thread"
  | "thread_return";

/**
 * talk form 选项（结构化表单里的单个选项）
 *
 * @ref kernel/src/thinkable/thread-tree/types.ts — TalkFormOption 后端类型镜像
 */
export interface TalkFormOption {
  id: string;
  label: string;
  detail?: string;
}

/**
 * talk form 结构化表单（talk/talk_sync 可选携带）
 *
 * 当发起方 LLM 在心里有几个候选回复时，用它代替纯文本列表——接收方（通常是 user）
 * 的前端会把消息渲染为 option picker（编号选项 + 自由文本兜底）。
 *
 * @ref kernel/src/thinkable/thread-tree/types.ts — TalkFormPayload 后端类型镜像
 */
export interface TalkFormPayload {
  formId: string;
  type: "single_choice" | "multi_choice";
  options: TalkFormOption[];
  allow_free_text: boolean;
}

/**
 * 对某个 form 的结构化回复
 *
 * 前端 user 点选/输入后通过 POST /api/talk/:target body.formResponse 传给后端。
 * 后端把它以 [formResponse] 前缀注入 message 让目标 LLM 识别。
 *
 * @ref kernel/src/thinkable/thread-tree/types.ts — FormResponse 后端类型镜像
 */
export interface FormResponse {
  formId: string;
  selectedOptionIds: string[];
  freeText: string | null;
}

/** Action */
export interface Action {
  id?: string;
  type: ActionType;
  timestamp: number;
  content: string;
  name?: string;
  args?: Record<string, unknown>;
  /**
   * tool_use: 自叙式行动标题（一句话说明本次 tool call 的意图）
   * 前端 TuiAction 优先用 title 作为卡片行首显示；无 title 时 fallback 到 name/content。
   */
  title?: string;
  result?: string;
  success?: boolean;
  /**
   * message_out (talk): 可选结构化表单
   *
   * 当发起方 LLM 调用 talk 时 args.form 非空，engine 会把 form（带 formId）
   * 一并落盘到此字段。前端反查 inbox 时看到 form 就把消息渲染成 option picker。
   */
  form?: TalkFormPayload;
  /** message_in (talk): 对某 form 的结构化回复（仅在 LLM 视角回显时出现） */
  formResponse?: FormResponse;
  /**
   * think / talk 的操作模式（2026-04-22 引入）
   *
   * 仅当 action 来源是 think / talk 指令（tool_use / message_out / create_thread）时写入。
   * - "fork": 派生新线程（原线程只读，不被影响）
   * - "continue": 向原线程投递消息（产生影响，唤醒原线程）
   */
  context?: "fork" | "continue";
}

/** Flow 消息 */
export interface FlowMessage {
  id?: string;
  direction: "in" | "out";
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

/** 节点类型（区分普通子栈帧和内联子节点） */
export type NodeType =
  | "frame"           // 普通子栈帧（默认）
  | "inline_before"   // before 内联子节点（hook 自动触发）
  | "inline_after"    // after 内联子节点（hook 自动触发）
  | "inline_reflect"; // reflect 内联子节点（主动触发）

/** 行为树节点 */
export interface ProcessNode {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "doing" | "done";
  children: ProcessNode[];
  deps?: string[];
  actions: Action[];
  traits?: string[];
  activatedTraits?: string[];
  summary?: string;
  locals?: Record<string, unknown>;
  outputs?: string[];
  outputDescription?: string;
  type?: NodeType;
  plan?: string;
}

/** 待办项 */
export interface TodoItem {
  nodeId: string;
  title: string;
  source: "plan" | "interrupt" | "manual";
}

/** 行为树 */
export interface Process {
  root: ProcessNode;
  focusId: string;
  todo?: TodoItem[];
  /** 标记数据来源：true = 线程树架构，undefined/false = 旧 Flow 架构 */
  isThreadTree?: boolean;
}

/** Sub-flow 摘要（参与对象的行为树） */
export interface SubFlowSummary {
  stoneName: string;
  status: FlowStatus;
  process: Process;
  /**
   * 一句话动态摘要（running / waiting 状态下的"当前动作"）
   *
   * 仅在对象处于 running / waiting 时由后端按优先级提炼：
   * 1. 最新 thinking 首句
   * 2. 最新 tool_use.title
   * 3. 最新 action 的 name/type
   *
   * 长度 ≤ 50，前端在 SessionKanban 对象行旁展示，带 pulse 效果。
   *
   * @ref kernel/src/observable/server/server.ts — computeCurrentAction 后端实现
   * @ref docs/工程管理/迭代/all/20260422_feature_running_session_摘要.md
   */
  currentAction?: string;
}

/** Flow 完整数据 */
export interface FlowData {
  sessionId: string;
  stoneName: string;
  title?: string;
  status: FlowStatus;
  messages: FlowMessage[];
  process: Process;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  subFlows?: SubFlowSummary[];
}

/** Flow 摘要 */
export interface FlowSummary {
  sessionId: string;
  title?: string;
  status: FlowStatus;
  firstMessage: string;
  messageCount: number;
  actionCount: number;
  hasProcess: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Context 可见性分类（镜像后端 `kernel/src/observable/visibility/visibility.ts#ContextVisibility`） */
export type ContextVisibility = "detailed" | "summary" | "title_only" | "hidden";

/** context-visibility API 返回结构 */
export interface ContextVisibilityResult {
  /** 实际使用的 focus 节点 ID（可能是 query 传入的，也可能是默认选中的） */
  focusId: string;
  /** 每个节点 threadId → 可见性分类 */
  visibility: Record<string, ContextVisibility>;
}

/** Trait 信息 */
export interface TraitInfo {
  name: string;
  when: string;
  readme: string;
  hasMethods: boolean;
  methods: { name: string; description: string }[];
}

/** SSE 事件 */
export type SSEEvent =
  | { type: "flow:start"; objectName: string; sessionId: string }
  | { type: "flow:action"; objectName: string; sessionId: string; action: Action }
  | { type: "flow:message"; objectName: string; sessionId: string; message: FlowMessage }
  | { type: "flow:status"; objectName: string; sessionId: string; status: FlowStatus }
  | { type: "flow:end"; objectName: string; sessionId: string; status: FlowStatus }
  /** provider 原生 thinking 通道的流式片段；assistant 协议本身不再显式输出 [thought] */
  | { type: "stream:thought"; objectName: string; sessionId: string; chunk: string }
  | { type: "stream:talk"; objectName: string; sessionId: string; target: string; chunk: string }
  | { type: "stream:program"; objectName: string; sessionId: string; lang?: "javascript" | "shell"; chunk: string }
  | { type: "stream:action"; objectName: string; sessionId: string; toolName: string; chunk: string }
  // 认知栈操作流式事件
  | { type: "stream:stack_push"; objectName: string; sessionId: string; opType: "cognize" | "reflect"; attr: string; chunk: string }
  | { type: "stream:stack_pop"; objectName: string; sessionId: string; opType: "cognize" | "reflect"; attr: string; chunk: string }
  | { type: "stream:set_plan"; objectName: string; sessionId: string; chunk: string }
  | { type: "stream:thought:end"; objectName: string; sessionId: string }
  | { type: "stream:talk:end"; objectName: string; sessionId: string; target: string }
  | { type: "stream:program:end"; objectName: string; sessionId: string }
  | { type: "stream:action:end"; objectName: string; sessionId: string; toolName: string }
  // 认知栈操作流式结束事件
  | { type: "stream:stack_push:end"; objectName: string; sessionId: string; opType: "cognize" | "reflect"; attr: string }
  | { type: "stream:stack_pop:end"; objectName: string; sessionId: string; opType: "cognize" | "reflect"; attr: string }
  | { type: "stream:set_plan:end"; objectName: string; sessionId: string }
  | { type: "object:created"; name: string }
  | { type: "flow:progress"; objectName: string; sessionId: string; iterations: number; maxIterations: number; totalIterations: number; maxTotalIterations: number }
  | { type: "object:updated"; name: string };

/** 统一时间线条目 */
export type TimelineEntry =
  | { kind: "message"; data: FlowMessage; objectName: string }
  | { kind: "action"; data: Action; objectName: string }
  /** 前端正在展示的 provider thinking 流 */
  | { kind: "streaming-thought"; objectName: string; content: string }
  | { kind: "streaming-talk"; from: string; target: string; content: string }
  | { kind: "streaming-stack-push"; objectName: string; opType: "cognize" | "reflect"; attr: string; content: string }
  | { kind: "streaming-stack-pop"; objectName: string; opType: "cognize" | "reflect"; attr: string; content: string }
  | { kind: "streaming-set-plan"; objectName: string; content: string };

/** 每个对象的 action 展示模式 */
export type ActionDisplayMode = "full" | "compact" | "hidden";

/** 文件信息 */
export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

/** 文件树节点 */
export interface FileTreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  children?: FileTreeNode[];
  /** 目录标记：stone（对象）/ flow（session 里的对象实例）/ view（对象的 views 渲染入口） */
  marker?: "stone" | "flow" | "view";
}

// --- Session Kanban ---

export type IssueStatus =
  | "discussing" | "designing" | "reviewing"
  | "executing" | "confirming" | "done" | "closed";

export type TaskStatus = "running" | "done" | "closed";

export interface KanbanComment {
  id: string;
  author: string;
  content: string;
  mentions?: string[];
  createdAt: string;
}

export interface KanbanIssue {
  id: string;
  title: string;
  status: IssueStatus;
  description?: string;
  participants: string[];
  taskRefs: string[];
  reportPages: string[];
  hasNewInfo: boolean;
  comments: KanbanComment[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanSubTask {
  id: string;
  title: string;
  assignee?: string;
  status: "pending" | "running" | "done";
}

export interface KanbanTask {
  id: string;
  title: string;
  status: TaskStatus;
  description?: string;
  issueRefs: string[];
  reportPages: string[];
  subtasks: KanbanSubTask[];
  hasNewInfo: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * User Inbox（session 级引用式收件箱）
 *
 * user 是身份挂牌、不参与 ThinkLoop，但系统会记录每次"某对象→user"的 talk，
 * 方便前端聚合渲染 MessageSidebar 的"按对象分组 + 未读角标"。
 *
 * 条目只存 (threadId, messageId) 引用，不存消息正文；正文在发起对象的
 * thread.json.actions 里，前端凭 (threadId, messageId) 反查。
 *
 * @ref kernel/src/storable/inbox/user-inbox.ts — UserInboxEntry / UserInboxData 后端类型镜像
 */
export interface UserInboxEntry {
  /** 发起对象当前线程 id */
  threadId: string;
  /** message_out action 的 id（在发起对象的 thread.json.actions 里反查正文） */
  messageId: string;
}

/**
 * 已读状态：每个对象最后已读消息的 timestamp
 *
 * 前端切换到某对象的线程时调 `POST /user-read-state` 上报时间戳；
 * 服务端按 objectName 单调递增地记录。判定 unread 用：thread 中消息
 * timestamp > lastReadTimestampByObject[objectName]。
 */
export interface UserReadState {
  lastReadTimestampByObject: Record<string, number>;
}

export interface UserInbox {
  inbox: UserInboxEntry[];
  /** 已读进度：对象 → 最后已读时间戳（map 顺序不稳定，仅按 key 访问） */
  readState: UserReadState;
}
