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
} from "@ooc/core/readable/contract.js";
import {
  xmlElement,
  xmlText,
  renderPathList,
  type XmlNode,
} from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** todo 无投影态（静态卡片）。 */
export type TodoWin = Record<string, never>;

const readable: ReadableModule<Data, TodoWin> = {
  readable: (_ctx: ReadableContext, self: Data) => {
    const children: XmlNode[] = [
      xmlElement("content", {}, [xmlText(self.content)]),
    ];
    if (self.activatesOn && self.activatesOn.length > 0) {
      children.push(renderPathList("activates_on", self.activatesOn)!);
    }
    return {
      class: "todo",
      content: children,
    };
  },
  window: [
    {
      class: "todo",
      object_methods: [],
      window_methods: [],
    },
  ],
};

export default readable;
