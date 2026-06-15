/**
 * root —— executable 维度（object method）。
 *
 * root 是一切 Object 继承链的终点（BASE 锚点），自身无智能能力——agency（talk/plan/todo/end）
 * 已搬去 _builtin/agent。root 类只保留边缘 misc method：
 * - example : 教学样板（实例化 example 对象）
 *
 * 飞书接入（open_chat/open_doc）已迁出 root，收口到 feishu_app 单例 object。
 *
 * default export `{methods:[...]}`，由 index.ts 的 `export const Class` 装配。
 */

import type {
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import { exampleMethod } from "./method.example.js";
import type { Data } from "../types.js";

export const ROOT_METHODS: ObjectMethod<Data>[] = [
  exampleMethod,
];

const executable: ExecutableModule<Data> = {
  methods: ROOT_METHODS,
};

export default executable;
