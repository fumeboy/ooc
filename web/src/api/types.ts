/**
 * 前端 API 类型定义
 *
 * @ref src/types/object.ts — references — StoneData 后端类型镜像
 * @ref src/types/flow.ts — references — FlowData, Action 后端类型镜像
 * @ref src/types/process.ts — references — Process, ProcessNode 后端类型镜像
 * @ref src/types/trait.ts — references — TraitDefinition 后端类型镜像
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

/** Context 可见性分类（镜像后端 `kernel/src/thread/visibility.ts#ContextVisibility`） */
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
  /** 目录标记：stone 或 flow */
  marker?: "stone" | "flow";
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
