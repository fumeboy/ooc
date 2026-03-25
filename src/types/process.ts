/**
 * 行为树相关类型定义 (G9)
 *
 * 行为树是 Flow 的唯一 action 存储。
 * 所有 action 记录在节点上，通过 focus 机制实现结构化遗忘。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G9 — implements — ProcessNode, Process, TodoItem 行为树结构
 * @ref .ooc/docs/哲学文档/gene.md#G5 — implements — focus 光标驱动结构化遗忘
 * @ref .ooc/docs/哲学文档/gene.md#G10 — references — actions 字段存储不可变事件
 * @ref src/types/flow.ts — references — Action 类型定义
 */

import type { Action } from "./flow.js";

/** 行为树节点状态 */
export type NodeStatus = "todo" | "doing" | "done";

/** 行为树节点 */
export interface ProcessNode {
  /** 节点唯一 ID */
  id: string;
  /** 节点标题 */
  title: string;
  /** 节点详细说明（目标的具体描述） */
  description?: string;
  /** 节点状态 */
  status: NodeStatus;
  /** 子节点 */
  children: ProcessNode[];
  /** 依赖的节点 ID（必须等待完成才能开始） */
  deps?: string[];
  /** 该节点的行为记录 */
  actions: Action[];
  /** 静态声明的 traits（create_plan_node 时指定） */
  traits?: string[];
  /** 动态激活的 traits（:before 帧中通过 activateTrait 添加） */
  activatedTraits?: string[];
  /** 完成后的摘要 */
  summary?: string;
  /** 节点局部变量（跨轮次持久化，随行为树栈入/栈出同步） */
  locals?: Record<string, unknown>;
  /** 栈帧级 Hook（运行时注册，触发时机由 HookTime 决定） */
  hooks?: FrameHook[];
}

/** 待办项（驱动 focus 移动的队列） */
export interface TodoItem {
  /** 关联的行为树节点 ID */
  nodeId: string;
  /** 待办描述（可与节点标题不同，如"处理来自 helper 的消息"） */
  title: string;
  /** 来源：plan = 行为树规划产生，interrupt = 消息中断插入，manual = 对象手动添加 */
  source: "plan" | "interrupt" | "manual";
}

/** 线程间信号 */
export interface Signal {
  id: string;
  /** 发送方线程名 */
  from: string;
  /** 消息内容 */
  content: string;
  timestamp: number;
  /** 是否已读 */
  acked: boolean;
  /** 已读时附加的记忆信息 */
  ackMemo?: string;
}

/** 线程状态 */
export interface ThreadState {
  /** 线程名称，唯一标识 */
  name: string;
  /** 当前聚焦的节点 ID */
  focusId: string;
  /** 线程状态 */
  status: "running" | "yielded" | "finished";
  /** 待处理的 signal 队列 */
  signals: Signal[];
}

/** 行为树（完整结构） */
export interface Process {
  /** 根节点 */
  root: ProcessNode;
  /** @deprecated 由 threads 替代，保留用于数据迁移和向后兼容 */
  focusId: string;
  /** 多线程 focus cursor */
  threads?: Record<string, ThreadState>;
  /** 待办队列（驱动 focus 的执行顺序，头部 = 当前/下一个要做的） */
  todo?: TodoItem[];
}

/** Hook 触发时机 */
export type HookTime = "when_stack_push" | "when_stack_pop" | "when_yield" | "when_error";

/** Hook 类型 */
export type HookType = "inject_message" | "create_todo";

/** 栈帧级 Hook（运行时注册） */
export interface FrameHook {
  /** Hook 唯一 ID */
  id: string;
  /** 触发时机 */
  when: HookTime;
  /** Hook 类型 */
  type: HookType;
  /** 处理器描述文本 */
  handler: string;
}
