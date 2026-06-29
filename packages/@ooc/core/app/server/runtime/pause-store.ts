/**
 * pause-store — 进程内 session-level pause + global pause 单例 (S4 + S8, 2026-06-29)。
 *
 * **设计权威**: app/self.md ## runtime: pause 是进程内调度开关; 不打断 inflight LLM,
 * 禁新 tool dispatch + jobManager 入队。
 *
 * - session-level pause: 单 session 调度停 (S4)
 * - global pause: 所有 session 调度停 (S8)
 *
 * worker.ts enqueueScheduler 入口检查 globalPause + perSessionPause, 命中即跳过入队。
 *
 * 进程内状态, server 重启即丢 (与 worker map 同语义)。
 */
const sessionPauses = new Set<string>();
let globalPaused = false;

export function isGlobalPaused(): boolean {
  return globalPaused;
}

export function setGlobalPaused(paused: boolean): void {
  globalPaused = paused;
}

export function isSessionPaused(sessionId: string): boolean {
  return sessionPauses.has(sessionId);
}

export function pauseSession(sessionId: string): void {
  sessionPauses.add(sessionId);
}

export function resumeSession(sessionId: string): void {
  sessionPauses.delete(sessionId);
}

/** 测试/shutdown 用 — 清状态。 */
export function clearPauseStore(): void {
  sessionPauses.clear();
  globalPaused = false;
}
