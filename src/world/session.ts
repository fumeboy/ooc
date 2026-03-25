/**
 * TaskSession — 任务级会话管理
 *
 * 跟踪一个顶层任务中所有参与对象的 Flow。
 * 同一 Stone 在同一任务中只有一个 Flow（sub-flow 复用）。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G2 — implements — 一个 Stone 可同时拥有多个 Flow，但同一任务中只有一个
 * @ref .ooc/docs/哲学文档/gene.md#G8 — references — sub-flow 机制（协作链中的 Flow 管理）
 * @ref src/flow/flow.ts — references — Flow 实例
 */

import { consola } from "consola";
import { Flow } from "../flow/index.js";

/** 会话中的 Flow 条目 */
interface SessionEntry {
  /** Flow 实例 */
  flow: Flow;
  /** 该 Flow 是否正在运行 ThinkLoop */
  active: boolean;
}

/** 捕获的回复（B talk A 时，A 正在等 B 的回复） */
interface CapturedReply {
  from: string;
  content: string;
}

export class TaskSession {
  /** stoneName → SessionEntry */
  private readonly _flows = new Map<string, SessionEntry>();
  /** 捕获的回复：targetName → CapturedReply（B 回复 A 时存入，A 取走后清除） */
  private readonly _replies = new Map<string, CapturedReply>();
  /** 顶层任务 ID */
  readonly taskId: string;
  /** session 根目录（flows/{taskId}/，所有 sub-flow 在此目录下的 flows/ 中创建） */
  readonly sessionDir: string;

  constructor(taskId: string, sessionDir: string) {
    this.taskId = taskId;
    this.sessionDir = sessionDir;
  }

  /**
   * 注册一个 Flow 到会话
   */
  register(stoneName: string, flow: Flow): void {
    this._flows.set(stoneName, { flow, active: false });
    consola.info(`[TaskSession] 注册 ${stoneName} (flow: ${flow.taskId})`);
  }

  /**
   * 获取对象的 Flow（如果已存在）
   */
  getFlow(stoneName: string): Flow | undefined {
    return this._flows.get(stoneName)?.flow;
  }

  /**
   * 检查对象是否已有 Flow
   */
  hasFlow(stoneName: string): boolean {
    return this._flows.has(stoneName);
  }

  /**
   * 标记 Flow 为活跃（正在运行 ThinkLoop）
   */
  setActive(stoneName: string, active: boolean): void {
    const entry = this._flows.get(stoneName);
    if (entry) entry.active = active;
  }

  /**
   * 检查 Flow 是否活跃
   */
  isActive(stoneName: string): boolean {
    return this._flows.get(stoneName)?.active ?? false;
  }

  /**
   * 存入捕获的回复（B 回复给 A）
   */
  captureReply(targetName: string, from: string, content: string): void {
    this._replies.set(targetName, { from, content });
    consola.info(`[TaskSession] 捕获 ${from} → ${targetName} 的回复`);
  }

  /**
   * 取走捕获的回复（A 取走 B 的回复）
   */
  takeReply(targetName: string): CapturedReply | undefined {
    const reply = this._replies.get(targetName);
    if (reply) this._replies.delete(targetName);
    return reply;
  }

  /**
   * 获取所有注册的 Flow
   */
  allFlows(): Array<{ stoneName: string; flow: Flow }> {
    return Array.from(this._flows.entries()).map(([stoneName, entry]) => ({
      stoneName,
      flow: entry.flow,
    }));
  }
}
