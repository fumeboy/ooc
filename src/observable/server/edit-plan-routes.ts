import {
  readEditPlan,
  previewEditPlan,
  applyEditPlan,
  cancelEditPlan,
} from "../../storable/edit-plans/edit-plans.js";
import type { World } from "../../world/index.js";
import { errorResponse, json } from "./responses.js";

/** 处理 Edit Plans（多文件原子编辑事务）相关 HTTP 路由 */
export async function handleEditPlanRoute(
  method: string,
  path: string,
  req: Request,
  world: World,
): Promise<Response | null> {
  const editPlanGetMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)$/);
  if (method === "GET" && editPlanGetMatch) {
    const sid = editPlanGetMatch[1]!;
    const planId = editPlanGetMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    const preview = await previewEditPlan(plan);
    return json({ success: true, data: { plan, preview } });
  }

  const editPlanApplyMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)\/apply$/);
  if (method === "POST" && editPlanApplyMatch) {
    const sid = editPlanApplyMatch[1]!;
    const planId = editPlanApplyMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    if (plan.status !== "pending") {
      return errorResponse(`plan 已是 ${plan.status} 状态，不能重复应用`, 409);
    }

    let threadId: string | undefined;
    try {
      const raw = (await req.json()) as Record<string, unknown>;
      if (typeof raw?.threadId === "string") threadId = raw.threadId;
    } catch {
      /* 无 body 或 body 非合法 JSON → threadId 留空 */
    }

    const result = await applyEditPlan(plan, {
      sessionId: sid,
      flowsRoot: world.flowsDir,
      threadId,
    });
    const updatedPlan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    return json({ success: true, data: { result, plan: updatedPlan ?? plan } });
  }

  const editPlanCancelMatch = path.match(/^\/api\/flows\/([^/]+)\/edit-plans\/([^/]+)\/cancel$/);
  if (method === "POST" && editPlanCancelMatch) {
    const sid = editPlanCancelMatch[1]!;
    const planId = editPlanCancelMatch[2]!;
    const plan = await readEditPlan(planId, { sessionId: sid, flowsRoot: world.flowsDir });
    if (!plan) return errorResponse(`plan "${planId}" 不存在`, 404);
    const updated = await cancelEditPlan(plan, { sessionId: sid, flowsRoot: world.flowsDir });
    return json({ success: true, data: { plan: updated } });
  }

  return null;
}
