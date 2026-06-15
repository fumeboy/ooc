/**
 * thread —— ooc class（`ooc.class: "talk"`）：agent 一次智能运行的载体。
 *
 * 一处 `export const Class` 装配（thread 几乎全继承 talk）。
 * - **无 construct**：thread 不经通用构造路径——由 agent 的 `talk` object method 在开启会话时创建
 *   （object-model 核心 9：agent 执行 talk 即创建一条 thread）。
 * - executable：无 own method（say/wait/close/share 经 class 链继承 talk）。
 * - readable：投影 class=thread（self-view），会话渲染继承自 talk。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  readable,
};

export type { Data } from "./types.js";
