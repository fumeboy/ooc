/**
 * Window 展示状态对象 —— 持有一个 window 的展示参数，与 window 业务数据（file path、
 * program history…）分离。由 readable 维度的 WindowMethod 读写、readable 函数读取、
 * 随 window 持久化在 thread-context。每个 window type 只用其中与自己相关的字段。
 */
import type { Viewport, TranscriptViewport } from "./viewport.js";

export interface WindowDisplayState {
  /** file / knowledge：行列视口（第一阶段裁剪）。 */
  viewport?: Viewport;
  /** file：第二阶段行切片 [start, end]（与 viewport 复合，由 set_range 写入）。 */
  lines?: [number, number];
  /** file：第二阶段列切片 [start, end]（与 viewport 复合，由 set_range 写入）。 */
  columns?: [number, number];
  /** talk / do：transcript 视口 */
  transcriptViewport?: TranscriptViewport;
  /** search：结果列表视口 */
  resultsViewport?: TranscriptViewport;
  /** program：执行历史视口 */
  historyViewport?: TranscriptViewport;
}
