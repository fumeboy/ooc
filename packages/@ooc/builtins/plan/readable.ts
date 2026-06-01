import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { PlanWindow } from "./types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "@ooc/core/thinkable/context/xml.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const w = ctx.window as PlanWindow;
  const children: XmlNode[] = [];
  if (w.description !== undefined) {
    children.push(xmlElement("description", {}, [xmlText(w.description)]));
  }
  const stepNodes: XmlNode[] = w.steps.map((s) => {
    const attrs: Record<string, string> = { id: s.id, status: s.status };
    if (s.subPlanWindowId) attrs.sub_plan_window_id = s.subPlanWindowId;
    return xmlElement("step", attrs, [xmlText(s.text)]);
  });
  children.push(
    xmlElement(
      "steps",
      { count: String(w.steps.length) },
      stepNodes,
    ),
  );
  if (w.parentPlanWindowId) {
    children.push(
      xmlElement("parent_plan", {
        plan_window_id: w.parentPlanWindowId,
        step_id: w.parentStepId ?? "",
      }),
    );
  }
  return children;
}
