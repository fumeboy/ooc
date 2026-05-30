import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Custom window — Object 自定义的 self window，由 `stones/<self>/executable/index.ts`
 * 的 `export const window: ObjectWindowDefinition = {...}` 提供具体行为。
 *
 * plan §6.2 / D1 / D2：
 * - WindowRegistry 注册一份固定 type=custom 的 dispatcher 契约；行为按 objectId 路由
 * - 仅当 thread.objectId === self（thread 由该 Object 自己持有）时由 initContextWindows 注入单例
 * - id 稳定为 `custom:<objectId>`
 */
export interface CustomWindow extends BaseContextWindow {
  type: "custom";
  status: "open" | "closed";
  /** 用来 dispatch 到 stones/<objectId>/executable/index.ts 的 ObjectWindowDefinition。 */
  objectId: string;
}
