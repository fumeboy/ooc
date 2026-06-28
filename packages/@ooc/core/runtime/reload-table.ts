/**
 * core/runtime/reload-table.ts —— on_reload 派发的进程级标记表（issue 2026-06-28）。
 *
 * **职责**：记录每个 class 最近一次被 hot-reload invalidate 的时间戳与变更文件列表。
 * 每条 `ThreadRuntime` 在 active 一个 inst 前对照本表的 `invalidatedAt` 与本地
 * cursor，越界即派发 `lifecycle.on_reload(self, { changedFiles })`、刷新 cursor。
 *
 * **为何进程级**：hot-reload watcher 本身是 process-level（fs.watch 一份覆盖整个 stones/）；
 * `stone:changed` 事件在 `WorldRuntime` 内处理时一并写入本表。跨 session 的 thread 都
 * 看得到、cursor 各自独立 → 不需要 broadcast。
 *
 * **顺序契约**：on_reload **before** active。`ThreadRuntime.dispatchActive` 入口先调
 * `maybeDispatchOnReload`，确保资源就位先于激活。
 *
 * **失败语义**：on_reload 抛 → fail-loud，外层调用者（thinkloop / dispatch）接住 → 转
 * 上层错误处理。class 自承迁移失败后果（与 OOC fail-loud 哲学一致）。
 *
 * 设计权威：`.ooc-world-meta/.../objects/supervisor/children/lifecycle/`。
 */

/** class 的一次 invalidate 记录。 */
export interface ReloadMark {
  /** invalidate 发生的进程内时间戳（performance.now-ish；同进程内单调）。 */
  invalidatedAt: number;
  /** 触发本次 invalidate 的源文件相对路径列表（hot-reload watcher 产）。 */
  changedFiles?: string[];
}

/**
 * 进程级 reload 标记表。`registerInvalidation(classId, files)` 由 `WorldRuntime` 在
 * `stone:changed` listener 内调；`peek(classId)` 由 `ThreadRuntime.maybeDispatchOnReload` 查。
 *
 * **不导出全局单例**：每 WorldRuntime 持自己一份（测试隔离 + 多 world 并存）；通过 deps
 * 注入到 ThreadRuntime。
 */
export class ReloadTable {
  private marks: Map<string, ReloadMark> = new Map();
  private counter = 0;

  /** 标记某 class 刚被 hot-reload invalidate。同 classId 多次调 = 累积 changedFiles + 推进 ts。 */
  registerInvalidation(classId: string, changedFiles?: string[]): void {
    this.counter += 1;
    const prev = this.marks.get(classId);
    const mergedFiles = changedFiles
      ? [...new Set([...(prev?.changedFiles ?? []), ...changedFiles])]
      : prev?.changedFiles;
    this.marks.set(classId, {
      invalidatedAt: this.counter,
      changedFiles: mergedFiles,
    });
  }

  /** 读最近一次 invalidate 记录；不存在返 undefined（class 未被 reload 过）。 */
  peek(classId: string): ReloadMark | undefined {
    return this.marks.get(classId);
  }

  /** 测试钩子：清空全表。 */
  clear(): void {
    this.marks.clear();
    this.counter = 0;
  }
}

export function createReloadTable(): ReloadTable {
  return new ReloadTable();
}
