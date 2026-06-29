/**
 * debug-store — 进程内 debug 模式 toggle (S8, 2026-06-29)。
 *
 * **设计权威**: app/self.md ## runtime: debug 模式下每条 thread 每轮 thinkloop 落盘
 * loop_NNNN.{input,output,meta}.json 供 LoopTimeline 查看。
 *
 * 本 issue (S8) 仅实现 toggle endpoint; loop 文件落盘 + 列表/读单条 endpoint
 * 由 S9 loop debug issue 后续完成。
 */
let debugEnabled = false;

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

export function clearDebugStore(): void {
  debugEnabled = false;
}
