/**
 * filesystem —— readable 维度（投影成 context window）。
 *
 * filesystem 无业务数据，readable 只渲染它的身份/用途（静态文本），并声明它展示哪些
 * object method（grep/glob/open_file/write_file）。它无展示投影态，故 `Win = {}`、无 window method。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { Data } from "../types.js";

/** filesystem 无展示投影态。 */
export interface FilesystemWin {}

const readable: ReadableModule<Data, FilesystemWin> = {
  // content 极简：object method 的 description 已足够丰富，readable 不赘述。
  readable: (_ctx: ReadableContext, _self: Data, _win: FilesystemWin) => ({
    class: "default",
    content: "文件系统",
  }),
  window: [
    {
      class: "default",
      object_methods: ["grep", "glob", "open_file", "write_file"],
      window_methods: [],
    },
  ],
};

export default readable;
