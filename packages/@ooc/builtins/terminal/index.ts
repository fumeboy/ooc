/**
 * terminal —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配两维度（executable / readable）。terminal 是**单例 class**
 * （一个 world 一个终端，被多个 agent 共同持有）：无 construct——数据来自缺省空 Data。
 * 无自定义序列化（无业务数据），故不写 persistable，走系统默认。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/terminal",
  executable,
  readable,
};

export type { Data } from "./types.js";
