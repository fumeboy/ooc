/**
 * plan —— readable 维度（投影成 context window）。
 *
 * - readable：把 Data 投影成 window —— 渲染 description / steps(树) / parent_plan 软链。
 * - plan **无投影态**（无 viewport 之类的展示态切片），故 PlanWin 为空、无 window method。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 *
 * deferred_hooks（契约暂无槽位，逻辑保留为本目录局部 helper，Wave3 反推 core 时 re-home）：
 * - compressView：旧 compressPlanWindow(level 1|2) 压缩投影，见 compressPlanView。
 * - onClose：旧 onClosePlanWindow 级联把子 plan 切 archived，见 cascadeArchiveSubPlans。
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

// ─────────────────────────── deferred hooks（保留逻辑，Wave3 re-home）────────────

/**
 * compressView —— 旧 compressPlanWindow(level 1|2)：把 plan 投影压缩成摘要。
 * level 1 = status + step_count + done/total；level 2 = status。契约暂无 compress 槽位，保留备用。
 */
export function compressPlanView(self: Data, level: 1 | 2): XmlNode[] {
  const total = self.steps.length;
  const done = self.steps.filter((s) => s.status === "done").length;
  const children: XmlNode[] = [];
  if (level === 1) {
    children.push(
      xmlElement("plan_summary", {
        status: self.status,
        step_count: String(total),
        done_ratio: `${done}/${total}`,
      }),
    );
  } else {
    children.push(xmlElement("plan_summary", { status: self.status }));
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

/**
 * onClose —— 旧 onClosePlanWindow：sub plan 通过 parentPlanWindowId 软链关联（非 parentWindowId），
 * WindowManager 的 cascade close 不会自动追到它们，故关本 plan 时显式把它们切到 archived。
 *
 * 契约暂无 onClose 槽位，且新契约 readable 不持有同 thread 的对象列表 —— 此 helper 接受候选子对象
 * 列表（由调用方提供），返回应被切到 archived 的子 plan 对象 id。Wave3 反推 core 时 re-home。
 */
export function cascadeArchiveSubPlans(
  selfObjectId: string,
  siblings: Array<{ id: string; class: string; data: Data }>,
): string[] {
  return siblings
    .filter((c) => c.class === "plan" && c.data.parentPlanWindowId === selfObjectId)
    .map((c) => c.id);
}
