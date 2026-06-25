/**
 * runtime —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配两维度（executable / readable）。
 * runtime 是**单例工具对象**（无 constructor，无业务态）：一个 world 一份 runtime，
 * agent 组合持有它作为成员，向 Agent 提供系统级接口（create_object 等）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/runtime",
  executable,
  readable,
};

export type { Data } from "./types.js";
