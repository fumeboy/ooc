/**
 * plan —— readable 维度（投影成 context window）。
 *
 * - readable：把 Data 投影成 window —— 渲染 description / steps(树) / parent_plan 软链。
 * - plan **无投影态**（无 viewport 之类的展示态切片），故 PlanWin 为空、无 window method。
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
  type XmlNode,
} from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** plan 的投影态：plan 无展示态切片（整棵 step 树直投）。 */
export interface PlanWin {}

const readable: ReadableModule<Data, PlanWin> = {
  readable: (_ctx: ReadableContext, self: Data, _win: PlanWin) => {
    const children: XmlNode[] = [];
    if (self.description !== undefined) {
      children.push(xmlElement("description", {}, [xmlText(self.description)]));
    }
    const stepNodes: XmlNode[] = self.steps.map((s) => {
      const attrs: Record<string, string> = { id: s.id, status: s.status };
      if (s.subPlanWindowId) attrs.sub_plan_window_id = s.subPlanWindowId;
      return xmlElement("step", attrs, [xmlText(s.text)]);
    });
    children.push(
      xmlElement("steps", { count: String(self.steps.length) }, stepNodes),
    );
    if (self.parentPlanWindowId) {
      children.push(
        xmlElement("parent_plan", {
          plan_window_id: self.parentPlanWindowId,
          step_id: self.parentStepId ?? "",
        }),
      );
    }
    return { class: "plan", content: children };
  },
  window: [
    {
      class: "plan",
      object_methods: [
        "update_plan",
        "add_step",
        "update_step",
        "expand_step",
        "collapse_subplan",
        "mark_done",
        "close",
      ],
      window_methods: [],
    },
  ],
};

export default readable;
