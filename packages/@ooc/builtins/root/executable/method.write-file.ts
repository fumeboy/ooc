/**
 * root.write_file command — 委托到 file_window constructor（form.method="write_file"）。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/builtins/file";

const WRITE_FILE_TIP = `write_file 整文件覆盖。用于新建文件或完整重写；改已有文件局部请用 file_window.edit。
参数：path（必填）、content（必填，完整文件内容，可为空串）。`;

export const writeFileMethod: ObjectMethod = {
  description: "Write a file (full overwrite); spawns a file_window pointing at the path.",
  intents: ["write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "目标文件路径" },
      content: { type: "string", required: true, description: "要写入的完整文件内容" },
    },
  },
  onFormChange(change, { args }) {
    const hasPath = typeof args.path === "string" && args.path.length > 0;
    const hasContent = typeof args.content === "string";
    const ready = hasPath && hasContent;
    return {
      tip: ready ? `Writing ${args.path}...` : WRITE_FILE_TIP,
      intents: [{ name: "write_file" }],
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeWriteFileMethod(ctx),
};

export const executeWriteFileMethod = makeRootDelegator({
  method: "write_file",
  constructorKind: "file",
  objectLabel: "file_window",
  formMethod: "write_file",
});
