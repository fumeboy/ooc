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
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** interpreter 无投影态。 */
export interface InterpreterWin {}

const readable: ReadableModule<Data, InterpreterWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: InterpreterWin) => ({
    class: "interpreter",
    content: [
      xmlElement("about", {}, [
        xmlText(
          "解释器对象（agent 持有的成员）。run 跑一段 ts/js 脚本——调它会造出 interpreter_process（sandbox + history）。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "interpreter",
      object_methods: ["run"],
      window_methods: [],
    },
  ],
};

export default readable;
