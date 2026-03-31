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
export type ActionType = "thought" | "program" | "message_in" | "message_out" | "pause" | "inject";

/** Action */
export interface Action {
  id?: string;
  type: ActionType;
  timestamp: number;
  content: string;
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
  summary?: string;
  locals?: Record<string, unknown>;
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
}

/** Sub-flow 摘要（参与对象的行为树） */
export interface SubFlowSummary {
  stoneName: string;
  status: FlowStatus;
  process: Process;
}

/** Flow 完整数据 */
export interface FlowData {
  taskId: string;
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
  taskId: string;
  title?: string;
  status: FlowStatus;
  firstMessage: string;
  messageCount: number;
  actionCount: number;
  hasProcess: boolean;
  createdAt: number;
  updatedAt: number;
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
  | { type: "flow:start"; objectName: string; taskId: string }
  | { type: "flow:action"; objectName: string; taskId: string; action: Action }
  | { type: "flow:message"; objectName: string; taskId: string; message: FlowMessage }
  | { type: "flow:status"; objectName: string; taskId: string; status: FlowStatus }
  | { type: "flow:end"; objectName: string; taskId: string; status: FlowStatus }
  | { type: "stream:thought"; objectName: string; taskId: string; chunk: string }
  | { type: "stream:talk"; objectName: string; taskId: string; target: string; chunk: string }
  | { type: "stream:program"; objectName: string; taskId: string; lang?: "javascript" | "shell"; chunk: string }
  | { type: "stream:action"; objectName: string; taskId: string; toolName: string; chunk: string }
  | { type: "stream:thought:end"; objectName: string; taskId: string }
  | { type: "stream:talk:end"; objectName: string; taskId: string; target: string }
  | { type: "stream:program:end"; objectName: string; taskId: string }
  | { type: "stream:action:end"; objectName: string; taskId: string; toolName: string }
  | { type: "object:created"; name: string }
  | { type: "flow:progress"; objectName: string; taskId: string; iterations: number; maxIterations: number; totalIterations: number; maxTotalIterations: number }
  | { type: "object:updated"; name: string };

/** 统一时间线条目 */
export type TimelineEntry =
  | { kind: "message"; data: FlowMessage; objectName: string }
  | { kind: "action"; data: Action; objectName: string }
  | { kind: "streaming-thought"; objectName: string; content: string }
  | { kind: "streaming-talk"; from: string; target: string; content: string };

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
