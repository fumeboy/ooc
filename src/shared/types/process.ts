/**
 * ProcessView 兼容类型定义
 *
 * ThreadTree 是真实执行模型；这些类型用于 FlowData.process 字段、
 * 前端 ProcessView 以及 /api/flows 响应。
 *
 * @ref src/shared/types/flow.ts — references — Action 类型定义
 */

import type { Action } from "./flow.js";

/** 行为树节点状态 */
export type NodeStatus = "todo" | "doing" | "waiting" | "done" | "failed";

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
  /** 该节点的 process events */
  events: Action[];
  /** 静态声明的 traits（create_plan_node 时指定） */
  traits?: string[];
  /** 动态激活的 traits（:before 帧中通过 activateTrait 添加） */
  activatedTraits?: string[];
  /** 完成后的摘要 */
  summary?: string;
  /** 节点局部变量（跨轮次持久化，随行为树栈入/栈出同步）
   *
   * 当节点完成时，通过 finish_plan_node(summary, artifacts) 传递的数据会合并到父节点的 locals 中。
   */
  locals?: Record<string, unknown>;
  /** 节点预期输出的 key 列表（前端展示用） */
  outputs?: string[];
  /** 节点输出描述（前端展示用） */
  outputDescription?: string;
  /** plan 文本（当前节点的计划/目标，plan command 写入） */
  plan?: string;
}

/** 行为树（完整结构） */
export interface Process {
  /** 根节点 */
  root: ProcessNode;
  /** @deprecated 由 threads 替代，保留用于数据迁移和向后兼容 */
  focusId: string;
  /** 标记数据来源：true = 线程树架构 */
  isThreadTree?: boolean;
}
