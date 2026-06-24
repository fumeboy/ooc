/**
 * todo —— readable 维度（投影成 context window）。
 *
 * - readable：把 Data 投影成 `todo` window —— content（正文）+ 可选 activates_on 列表。
 * - 没有投影态（todo 是静态卡片，无 viewport/范围调节），故 win 为空对象、无 window method。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import {
  xmlElement,
  xmlText,
  renderPathList,
  type XmlNode,
} from "@ooc/core/types/xml.js";
import type { Data } from "../types.js";

/** todo 无投影态（静态卡片）。 */
export type TodoWin = Record<string, never>;

const readable: ReadableModule<Data, TodoWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>) => {
    const children: XmlNode[] = [
      xmlElement("content", {}, [xmlText(self.data.content)]),
    ];
    if (self.data.activatesOn && self.data.activatesOn.length > 0) {
      children.push(renderPathList("activates_on", self.data.activatesOn)!);
    }
    return {
      class: "todo",
      content: children,
    };
  },
  window: [
    {
      class: "todo",
      object_methods: ["mark_done"],
      window_methods: [],
    },
  ],
};

export default readable;
