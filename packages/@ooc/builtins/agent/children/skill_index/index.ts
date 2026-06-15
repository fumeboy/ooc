/**
 * skill_index —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配两维度（executable / readable）。
 * skill_index **无 constructor**：每 thread 由 synthesizer 派生注入 Data，不经构造路径；
 * **不持久化**（不导出 persistable，走系统默认——实际由 synthesizer 每轮重建、不落盘）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  executable,
  readable,
};

export type { Data } from "./types.js";
