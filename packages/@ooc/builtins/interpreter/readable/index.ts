/**
 * interpreter —— readable 维度（投影成 context window）。
 *
 * interpreter 无业务数据，投影只渲染身份/用途；方法菜单（run）由 window 声明。
 * 它也无投影态（Win 为空对象）——故不提供 window method。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { Data } from "../types.js";

/** interpreter 无投影态。 */
export interface InterpreterWin {}

const readable: ReadableModule<Data, InterpreterWin> = {
  // content 极简：object method 的 description 已足够丰富，readable 不赘述。
  readable: (_ctx: ReadableContext, _self: Data, _win: InterpreterWin) => ({
    view: "default",
    content: "解释器",
  }),
  window: [
    {
      view: "default",
      object_methods: ["run"],
      window_methods: [],
    },
  ],
};

export default readable;
