/**
 * interpreter —— ooc class 装配（不含 visible 前端）。
 *
 * 一处 `export const Class` 收口两维度（executable / readable）。
 * interpreter 是 agent 组合持有的 **tool-object 成员**、**单例 class**（无 construct）：
 * run 经 ctx.runtime 委托造 interpreter_process；自身无业务数据、无自定义持久化。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { type Data, VERSIONED_FIELDS } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/interpreter",
  executable,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
