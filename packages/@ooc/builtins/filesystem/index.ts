/**
 * filesystem —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配两维度（executable / readable）。
 * filesystem 是**单例 class**（无 construct：一个 world 一份文件系统，被多个 agent 共同持有），
 * 且**无业务数据**（无 persistable：无可序列化的实例态）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/filesystem",
  executable,
  readable,
};

export type { Data } from "./types.js";
