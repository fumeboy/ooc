/**
 * root —— OOC 最小 Object 基类（一切 Object 继承链的终点）的后端程序路由。
 *
 * 一处 `export const Class` 装配 executable（misc method）+ readable（投影成 root 窗）。
 * root 是单例基类（无 construct）；不自定义 persistable（走系统默认）。
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
