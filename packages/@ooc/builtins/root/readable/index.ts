/**
 * root —— readable 维度（投影成 context window）。
 *
 * root 通常不显式渲染（外层包装 + 调度器的 commands 块已足够说明 root 上可调命令），
 * 故 content 返回空 children——让调度器的 commands 子节点自然承担表达。
 *
 * root window 上展示 root 类的 misc method（example）；无投影态、无 window method。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import type { Data } from "../types.js";

/** root 的投影态：root 不需要展示态。 */
export interface RootWin {}

const readable: ReadableModule<Data, RootWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: RootWin) => ({
    class: "root",
    content: [],
  }),
  window: [
    {
      class: "root",
      object_methods: ["example"],
      window_methods: [],
    },
  ],
};

export default readable;
