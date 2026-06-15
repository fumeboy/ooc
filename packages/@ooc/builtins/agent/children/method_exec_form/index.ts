/**
 * method_exec_form —— method 调用 form 的 ooc class（占位）。
 *
 * form 机制 Wave4 已废；本轮只把旧 `_shared/types/method-exec.ts` 的业务类型归位到这里
 * （types.ts `Data`），并注册一个空 `Class` 占位。暂无 construct / executable / readable。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {};

export type { Data } from "./types.js";
