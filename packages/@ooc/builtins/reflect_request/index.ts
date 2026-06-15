/**
 * reflect_request —— ooc class（`ooc.class: "_builtin/thread"`）：super flow 反思 thread 的 self-view
 * + reflectable 沉淀方法挂载窗。
 *
 * 一处 `export const Class` 装配两维度（reflect_request 经 class 链继承 thread → talk 的会话行为）。
 * - **无 construct**：reflect_request 不经构造路径——随 super flow 反思 thread 投影。
 * - executable：两个 reflectable 沉淀 method（会话 method say/close/share 经 class 链继承 talk）。
 * - readable：最小占位（会话渲染由 class 链上的 talk readable 复用）。
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
