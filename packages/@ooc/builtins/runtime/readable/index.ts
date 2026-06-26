/**
 * runtime —— readable 维度（投影成 context window）。
 *
 * runtime 无业务数据、无投影态，只渲染静态身份/用途说明；方法菜单（create_object）由 window 声明。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import type { Data } from "../types.js";

/** runtime 无投影态（无 viewport 等展示态）。 */
export interface RuntimeWin {}

const readable: ReadableModule<Data, RuntimeWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: RuntimeWin) => ({
    view: "default",
    content: [
      xmlElement("about", {}, [
        xmlText(
          "runtime 对象（agent 持有的成员）——系统级接口。create_object 把新对象骨架落 session worktree。",
        ),
      ]),
    ],
  }),
  window: [
    {
      view: "default",
      object_methods: ["create_object"],
      window_methods: [],
    },
  ],
};

export default readable;
