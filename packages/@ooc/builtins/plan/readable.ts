// 本文件只导出 readable / compressView / onClose hook；plan 类的单处声明（registerWindowClass）在 executable/index.ts。
import {
  type OnCloseContext,
  type RenderContext,
} from "@ooc/core/extendable/_shared/registry.js";
import type { PlanWindow } from "./types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "@ooc/core/_shared/types/xml.js";

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

export function compressPlanWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const w = ctx.window as PlanWindow;
  const total = w.steps.length;
  const done = w.steps.filter((s) => s.status === "done").length;
  const children: XmlNode[] = [];
  if (level === 1) {
    children.push(
      xmlElement("plan_summary", {
        status: w.status,
        step_count: String(total),
        done_ratio: `${done}/${total}`,
      }),
    );
  } else {
    children.push(
      xmlElement("plan_summary", {
        status: w.status,
      }),
    );
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
 * close plan_window 时级联关闭所有 sub plan_window。
 *
 * 实际级联由 WindowManager.close 通过 parentWindowId 自动处理；但 plan_window 的 sub 不是
 * parentWindowId 关系（sub plan 挂在 ROOT_WINDOW_ID 下，通过 parentPlanWindowId 软链），
 * 所以在这里显式遍历 contextWindows 找 parentPlanWindowId === self.id 的 plan_window，
 * 把它们也 close 掉。
 */
export function onClosePlanWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.class !== "plan") return;
  // sub plan_window 是通过 parentPlanWindowId 软链关联（不是 parentWindowId）;
  // 所以 WindowManager 的 cascade close 不会自动追到它们 —— 这里显式把它们切到 archived。
  const all = ctx.thread.contextWindows ?? [];
  for (const c of all) {
    if (c.class === "plan" && (c as PlanWindow).parentPlanWindowId === w.id) {
      (c as PlanWindow).status = "archived";
    }
  }
}
