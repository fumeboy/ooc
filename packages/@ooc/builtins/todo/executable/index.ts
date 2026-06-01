/**
 * todo_object — 由 root.todo command 一步直建的可见待办。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object。
 * 2026-06-01 P5'.5: renderXml 抽到 readable.ts。
 *
 * - 没有 LLM 可调用的 method；唯一动作是 close（待办完成）
 * - onClose 无副作用，window 直接释放
 */

import { registerObjectType } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";

registerObjectType("todo", {
  commands: {},
  readable,
});
