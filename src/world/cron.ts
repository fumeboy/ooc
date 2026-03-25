/**
 * CronManager —— 定时任务管理器
 *
 * 定时任务本质是"在指定时间点给 OOC Object 发消息"。
 * 由 World 集成，通过 setInterval 每秒检查到期任务。
 *
 * @ref docs/哲学文档/gene.md#G8 — extends — 定时消息投递
 */

import { consola } from "consola";

/** 定时任务条目 */
export interface ScheduledTask {
  id: string;
  targetObject: string;
  message: string;
  /** 触发时间（Unix ms） */
  triggerAt: number;
  /** 创建者 */
  createdBy: string;
  /** 是否已执行 */
  fired: boolean;
}

export class CronManager {
  private _tasks: ScheduledTask[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _onFire: (task: ScheduledTask) => void;

  constructor(onFire: (task: ScheduledTask) => void) {
    this._onFire = onFire;
  }

  /** 创建定时任务，返回任务 ID */
  schedule(targetObject: string, message: string, triggerAt: number, createdBy: string): string {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._tasks.push({ id, targetObject, message, triggerAt, createdBy, fired: false });
    consola.info(`[Cron] 创建定时任务 ${id}: ${createdBy} → ${targetObject} @ ${new Date(triggerAt).toISOString()}`);
    return id;
  }

  /** 取消定时任务 */
  cancel(id: string): boolean {
    const idx = this._tasks.findIndex(t => t.id === id);
    if (idx < 0) return false;
    this._tasks.splice(idx, 1);
    consola.info(`[Cron] 取消定时任务 ${id}`);
    return true;
  }

  /** 列出所有未触发的定时任务 */
  list(): ScheduledTask[] {
    return this._tasks.filter(t => !t.fired);
  }

  /** 启动定时检查 */
  start(): void {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 1000);
    consola.info("[Cron] 定时任务管理器已启动");
  }

  /** 停止定时检查 */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      consola.info("[Cron] 定时任务管理器已停止");
    }
  }

  /** 每秒检查到期任务 */
  private _tick(): void {
    const now = Date.now();
    for (const task of this._tasks) {
      if (!task.fired && task.triggerAt <= now) {
        task.fired = true;
        consola.info(`[Cron] 触发定时任务 ${task.id}: → ${task.targetObject}`);
        this._onFire(task);
      }
    }
    this._tasks = this._tasks.filter(t => !t.fired);
  }
}
