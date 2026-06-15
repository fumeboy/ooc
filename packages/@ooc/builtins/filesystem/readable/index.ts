/**
 * filesystem —— readable 维度（投影成 context window）。
 *
 * filesystem 无业务数据，readable 只渲染它的身份/用途（静态文本），并声明它展示哪些
 * object method（grep/glob/open_file/write_file）。它无展示投影态，故 `Win = {}`、无 window method。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** filesystem 无展示投影态。 */
export interface FilesystemWin {}

const readable: ReadableModule<Data, FilesystemWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: FilesystemWin) => ({
    class: "filesystem",
    content: [
      xmlElement("about", {}, [
        xmlText(
          "文件系统对象（agent 持有的成员）。grep / glob 查询、open_file / write_file 读写——" +
            "调它的方法会造出 search / file 对象。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "filesystem",
      object_methods: ["grep", "glob", "open_file", "write_file"],
      window_methods: [],
    },
  ],
};

export default readable;
