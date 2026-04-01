/**
 * SSE 事件总线
 *
 * 全局事件发射器，用于将系统内部事件推送到前端 SSE 连接。
 * 各模块（World, ThinkLoop, Flow, Scheduler）在关键节点调用 emitSSE()，
 * SSE handler 监听并推送给所有连接的客户端。
 *
 * @ref docs/哲学文档/gene.md#G11 — references — SSE 是前端实时感知对象状态变化的通道
 * @ref src/types/flow.ts — references — Action, FlowMessage, FlowStatus 事件数据类型
 */

import { EventEmitter } from "node:events";
import type { Action, FlowMessage, FlowStatus } from "../types/index.js";

/** SSE 事件类型 */
export type SSEEvent =
  | { type: "flow:start"; objectName: string; taskId: string }
  | { type: "flow:action"; objectName: string; taskId: string; action: Action }
  | { type: "flow:message"; objectName: string; taskId: string; message: FlowMessage }
  | { type: "flow:status"; objectName: string; taskId: string; status: FlowStatus }
  | { type: "flow:end"; objectName: string; taskId: string; status: FlowStatus }
  | { type: "stream:thought"; objectName: string; taskId: string; chunk: string }
  | { type: "stream:talk"; objectName: string; taskId: string; target: string; chunk: string }
  | { type: "stream:thought:end"; objectName: string; taskId: string }
  | { type: "stream:talk:end"; objectName: string; taskId: string; target: string }
  | { type: "stream:program"; objectName: string; taskId: string; lang?: "javascript" | "shell"; chunk: string }
  | { type: "stream:program:end"; objectName: string; taskId: string }
  | { type: "stream:action"; objectName: string; taskId: string; toolName: string; chunk: string }
  | { type: "stream:action:end"; objectName: string; taskId: string; toolName: string }
  // 认知栈操作流式事件（stack_push: cognize 或 reflect）
  | { type: "stream:stack_push"; objectName: string; taskId: string; opType: "cognize" | "reflect"; attr: string; chunk: string }
  | { type: "stream:stack_push:end"; objectName: string; taskId: string; opType: "cognize" | "reflect"; attr: string }
  // 认知栈操作流式事件（stack_pop: cognize 或 reflect）
  | { type: "stream:stack_pop"; objectName: string; taskId: string; opType: "cognize" | "reflect"; attr: string; chunk: string }
  | { type: "stream:stack_pop:end"; objectName: string; taskId: string; opType: "cognize" | "reflect"; attr: string }
  // set_plan 流式事件
  | { type: "stream:set_plan"; objectName: string; taskId: string; chunk: string }
  | { type: "stream:set_plan:end"; objectName: string; taskId: string }
  | { type: "object:created"; name: string }
  | { type: "object:updated"; name: string }
  | { type: "flow:progress"; objectName: string; taskId: string; iterations: number; maxIterations: number; totalIterations: number; maxTotalIterations: number };

/** 全局事件总线 */
export const eventBus = new EventEmitter();

/** 发出 SSE 事件 */
export function emitSSE(event: SSEEvent): void {
  eventBus.emit("sse", event);
}
