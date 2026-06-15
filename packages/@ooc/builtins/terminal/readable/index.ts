/**
 * terminal —— readable 维度（投影成 context window + window method）。
 *
 * terminal 无业务数据、无展示态——readable 只渲染身份/用途；方法菜单经 window 声明
 * （object_methods: ['run']）。无 window method（无 viewport / 投影态可调）。
 *
 * 与 executable 维度（object method `run`，在 ../executable/index.ts）物理分离。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** terminal 无投影态。 */
export interface TerminalWin {}

const readable: ReadableModule<Data, TerminalWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: TerminalWin) => ({
    class: "terminal",
    content: [
      xmlElement("about", {}, [
        xmlText(
          "终端对象（agent 持有的成员）。run 跑一段 bash 脚本——调它会造出 terminal_process（bash 子进程 + history）。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "terminal",
      object_methods: ["run"],
      window_methods: [],
    },
  ],
};

export default readable;
