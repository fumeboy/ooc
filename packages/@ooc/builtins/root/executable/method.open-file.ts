/**
 * root.open_file method — 委托到 file_window constructor（form.method="open_file"）。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

import "@ooc/builtins/file";

const OPEN_FILE_TIP = `open_file 把文件内容作为 file_window 引入 context。
参数：path（必填，文件路径）、lines（可选 [start,end]）、columns（可选 [start,end]）。`;

export const openFileMethod: ObjectMethod = {
  description: "Open a file as a file_window visible in context.",
  intents: ["open_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（绝对，或相对 session baseDir）" },
      lines: { type: "array", required: false, description: "[start, end] 行范围" },
      columns: { type: "array", required: false, description: "[start, end] 列范围" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    const hasPath = typeof args.path === "string" && args.path.length > 0;
    return {
      tip: hasPath ? `Opening file ${args.path}...` : OPEN_FILE_TIP,
      intents: [{ name: "open_file" }],
      quick_exec_submit: hasPath,
    };
  },
  exec: (ctx) => executeOpenFileMethod(ctx),
};

export const executeOpenFileMethod = makeRootDelegator({
  method: "open_file",
  constructorKind: "file",
  objectLabel: "file_window",
  formMethod: "open_file",
});
