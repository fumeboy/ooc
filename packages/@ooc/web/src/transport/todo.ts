/**
 * `TODO(description)` — 桩化占位 helper。
 *
 * 用于 web 端所有「server 对接的地方」(2026-06-29 用户裁决:保留 UI 设计/样式/布局,
 * 将 server 对接全部桩化、重新实现)。
 *
 * 设计原则:
 *
 * - **不模拟 mock**: 不返回任何假数据,函数被调用即抛错。让 UI 在桩点上行为可见
 *   (展示 "TODO: <描述>" 错误状态),迫使重新实现时显式接通。
 * - **携带描述**: description 描述这个留空位置的程序行为,让重新实现者一眼看清
 *   契约(`fetchStones() returns list of stone objectIds in current world`)。
 * - **保留签名**: 调用方代码不改、类型不破——只是 runtime 时抛错。
 *
 * 使用:
 *   export function fetchStones() {
 *     return TODO<string[]>("列出当前 world 内所有 stone object 的 id");
 *   }
 *
 * 重新实现时:
 *   - 接通 server endpoint
 *   - 写真实 fetch 实现
 *   - 删除 TODO 调用
 */
export function TODO<T>(description: string): T {
  throw new Error(`[TODO] ${description}`);
}

/** Promise 版,签名匹配 async / requestJson 风格 fetcher。 */
export function TODO_async<T>(description: string): Promise<T> {
  return Promise.reject(new Error(`[TODO] ${description}`));
}
