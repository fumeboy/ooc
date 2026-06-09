/**
 * root.example method —— 委托到 example_window constructor。
 *
 * 与 open_file 同构的 thin delegator：root 表项持有 knowledge / paths / schema；
 * exec 走 lookupConstructor("example") 委托到 example/executable 的 kind="constructor" method。
 * example 是标准对象定义样板，这条 root 命令让 agent 可直接 `exec(method="example")` 构造它。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

// side-effect import 触发 example_window constructor 注册。
import "@ooc/builtins/example";

const EXAMPLE_BASIC_PATH = "internal/executable/example/basic";

const KNOWLEDGE = `
example 用于构造一个 example_window —— OOC 标准对象定义的最小样板。

参数：
- message: 可选，要展示的文本（可多行）

后续操作：
- 累加计数：exec(parent_window_id="<example_window_id>", method="bump")
- 调整视口：exec(parent_window_id="<example_window_id>", method="set_viewport", args={ line_end: 50 })
- 关闭：close(window_id="<example_window_id>")

调用示例：
open(method="example", title="试一下", args={ message: "hello\\nworld" })
`.trim();

export const exampleMethod: ObjectMethod = {
  paths: ["example"],
  schema: {
    args: {
      message: { type: "string", required: false, description: "要展示的文本（可多行）" },
    },
  } as MethodCallSchema,
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form as MethodExecWindow, { [EXAMPLE_BASIC_PATH]: KNOWLEDGE });
  },
  exec: makeRootDelegator({
    method: "example",
    constructorKind: "example",
    objectLabel: "example_window",
  }),
};
