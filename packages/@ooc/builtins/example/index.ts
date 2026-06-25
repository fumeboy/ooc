/**
 * example —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 constructor + 三维度（executable / readable / persistable）。
 * example 是**非单例 class**（有 constructor，可按需造多个实例）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import persistable from "./persistable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/example",
  construct: {
    description: "Create an example object showing a message (authoring reference).",
    schema: {
        message: { type: "string", description: "要展示的文本（可多行）" },
      },
    exec: (_ctx, args: { message?: string }): Data => ({
      message: typeof args.message === "string" ? args.message : "(empty)",
      bumpCount: 0,
    }),
  },
  executable,
  readable,
  persistable,
};

export type { Data } from "./types.js";
