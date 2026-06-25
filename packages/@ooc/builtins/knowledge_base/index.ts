/**
 * knowledge_base —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 executable + readable。
 * knowledge_base 是**单例 class**（无 construct；一个 world 一份知识库）——委托类 tool-object，
 * open_knowledge 经 ctx.runtime 实例化 knowledge 子对象。无自定义持久化（走系统默认）。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/knowledge_base",
  executable,
  readable,
};

export type { Data } from "./types.js";
