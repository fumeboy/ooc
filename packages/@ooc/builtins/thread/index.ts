/**
 * thread —— ooc class（`ooc.class: "talk"`）：agent 一次智能运行的载体。
 *
 * 一处 `export const Class` 装配三维度（thread 几乎全继承 talk）。
 * - **无 construct**：thread 不经构造路径——由 agency `talk` 创建。
 * - executable：methods 留空（say/wait/close/share/talk 经 class 链继承 talk）。
 * - readable：最小占位（Wave4 talk 迁移后复用 talk 的会话渲染）。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  readable,
};

export type { Data } from "./types.js";
