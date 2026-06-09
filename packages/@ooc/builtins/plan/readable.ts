import {
  builtinRegistry,
  type OnCloseContext,
  type RenderContext,
} from "@ooc/core/extendable/_shared/registry.js";
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

function compressPlanWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
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
function onClosePlanWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "plan") return;
  // sub plan_window 是通过 parentPlanWindowId 软链关联（不是 parentWindowId）;
  // 所以 WindowManager 的 cascade close 不会自动追到它们 —— 这里显式把它们切到 archived。
  const all = ctx.thread.contextWindows ?? [];
  for (const c of all) {
    if (c.type === "plan" && (c as PlanWindow).parentPlanWindowId === w.id) {
      (c as PlanWindow).status = "archived";
    }
  }
}

const PLAN_BASIC_KNOWLEDGE = `
plan_window 是 thread 的行动计划窗口（first-class ContextWindow）。
由 root.plan method 创建/更新；支持 sub plan 嵌套 + 通过 do.share_windows 共享给子 thread。

在 plan_window 上可调命令（通过 exec(parent_window_id="<plan_window_id>", method="X", args=...) 调用）：
- update_plan: 更新 plan.title / description
- add_step: 追加 step（参数 text 必填；status 可选，默认 pending）
- update_step: 修改某 step 的 text / status（参数 step_id 必填）
- expand_step: 把 step 展开为 sub plan_window（创建 child + 写回 subPlanWindowId）
- collapse_subplan: 反向；archive sub plan_window + 清 subPlanWindowId
- mark_done: 标记 plan_window 自身完成（status → "done"）
- close: 关闭 plan_window（cascade 把所有 sub plan_window 切 archived）

renderXml: <plan_window>...<description?/><steps count><step id status sub_plan_window_id?/>...</steps></plan_window>
`.trim();

// readable 维度自注册（readable + compressView + onClose + basicKnowledge）。
builtinRegistry.registerReadable("plan", {
  onClose: onClosePlanWindow,
  readable,
  compressView: compressPlanWindow,
  basicKnowledge: PLAN_BASIC_KNOWLEDGE,
});
