/**
 * file —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 construct + 三维度（executable / readable）。
 * file 是**非单例 class**（有 construct：open_file / write_file 两分支可造多个文件窗实例）。
 * persistable 走系统默认（Data 仅 {path}，无自定义序列化需求）。
 *
 * 注：构造槽位键名是 `construct` 而非 `constructor`（Object.prototype.constructor 会遮蔽）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { type Data, VERSIONED_FIELDS } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/filesystem/file",
  construct: {
    description: "打开一个文件",
    schema: {
      path: { type: "string" },
    },
    exec: (_ctx, args) => {
      return {
        path: args.path,
      };
    }
  },
  executable,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
