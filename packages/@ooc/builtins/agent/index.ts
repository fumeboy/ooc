/**
 * agent —— OOC Agent 基类的后端程序路由。
 *
 * 一处 `export const Class` 装配 agency（executable 维度）。
 * agent 是基类（无 construct——继承它的具体 agent 各自带 construct 或为单例），
 * 自身不投影成窗（无 readable）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  executable,
};

export type { Data } from "./types.js";
