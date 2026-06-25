/**
 * todo —— 一项 todo item 的对象 data。
 *
 * 用于 plan / thread 内的任务追踪：LLM 经 `todo` method 在 thread context 里登记一条 todo
 * （创建一个 todo 实例），改其 status 推进进度。
 */
export interface Data {
  content: string;
  status: "open" | "in_progress" | "done";
  createdAt: number;
  doneAt?: number;
}
