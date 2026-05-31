/**
 * root plan_* methods —— B 类 plan 塌缩后的 owner-scoped 行动计划操作（OOC-4 L5b）。
 *
 * 不再创建 plan_window（已删）；改为读写对象级 `plan.md`（flow object 文件）：
 * - plan_set(content)：全量设置 plan.md（覆盖）。LLM 把 steps 作 markdown checklist
 *   （`- [ ]` / `- [x]`）写在 content 里自管。
 * - plan_clear()：清空 plan.md（写空串）。
 *
 * 落盘载体 = src/persistable/flow-plan.ts；写经 enqueueSessionWrite 串行化。
 * plan 属对象（object-scoped）：该对象所有 thread 的自视都渲染同一份 active plan
 * （取代旧 plan_window 的 share_windows 跨 thread 共享机制；spec L5-6 §4 / §D1）。
 *
 * 非空 plan.md 每轮在 <self_view><plan> 自视切片中常驻可见（self-view.ts 渲染）。
 *
 * nil-persistence（无 ctx.thread.persistence，纯内存测试模式）：无文件路径，
 * method 不落盘、返回一条说明文本（不抛错）。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
  MethodExecOutcome,
} from "../_shared/method-types.js";
import type { FlowObjectRef } from "../../../persistable/common.js";
import { readPlan, writePlan } from "../../../persistable/index.js";

const PLAN_SET_BASIC_PATH = "internal/executable/plan_set/basic";
const PLAN_SET_INPUT_PATH = "internal/executable/plan_set/input";
const PLAN_CLEAR_BASIC_PATH = "internal/executable/plan_clear/basic";

const PLAN_SET_KNOWLEDGE = `
plan_set 全量设置当前对象的 active 行动计划（覆盖写入 plan.md）。
非空 plan 每轮在 <self_view><plan> 自视切片中常驻可见，提醒你当前在执行什么。

参数：
- content: 必填，整份计划的 markdown 文本。把步骤写成 checklist 自管进度：
  未完成用 \`- [ ]\`，已完成用 \`- [x]\`。

示例：
exec(method="plan_set", title="重构 thinkable", args={ content: "# 重构 thinkable\\n\\n- [ ] 拆解 thinkloop\\n- [ ] 梳理 context\\n- [x] 已读完旧实现" })

提示：
- plan 属对象、不属单个 thread；同对象的子线程（do fork）自视也会看到同一份 plan。
- 推进时直接再 plan_set 覆盖整份内容（把某步从 \`- [ ]\` 改成 \`- [x]\`）；没有单独的「改某一步」method。
- 计划作废时用 plan_clear 清空。
`.trim();

const PLAN_CLEAR_KNOWLEDGE = `
plan_clear 清空当前对象的 active 行动计划（把 plan.md 写成空）。
清空后 <self_view><plan> 自视切片不再出现，表示当前没有进行中的计划。

无参数。

示例：exec(method="plan_clear", args={})

提示：要替换计划而非清空，请直接 plan_set 新的 content（plan_set 是覆盖语义）。
`.trim();

/** plan_* method 的可匹配路径集合。 */
export enum PlanCommandPath {
  Set = "plan_set",
  Clear = "plan_clear",
}

// ─────────────────────────── helpers ──────────────────────────────────────────

/** 从 thread.persistence 派生对象级 FlowObjectRef（threadId 字段被 objectDir 忽略，无害）。 */
function flowRefOf(ctx: MethodExecutionContext): FlowObjectRef | undefined {
  const ref = ctx.thread?.persistence;
  if (!ref?.objectId) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

const NIL_PERSISTENCE_NOTE =
  "[plan] 当前 thread 无持久化目录（内存模式），plan.md 不落盘；本次操作未持久化。";

// ─────────────────────────── plan_set ──────────────────────────────────────────

export const planSetCommand: MethodEntry = {
  paths: [PlanCommandPath.Set],
  match: () => [PlanCommandPath.Set],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [PLAN_SET_BASIC_PATH]: PLAN_SET_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[PLAN_SET_INPUT_PATH] =
        "plan_set 还缺以下参数: content。\n" +
        "请用 refine(form_id, args={ content: \"<整份计划 markdown，步骤用 - [ ] / - [x]>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executePlanSet(ctx),
};

export async function executePlanSet(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (content.trim().length === 0) {
    return {
      ok: false,
      error:
        "[plan_set] 缺少 content 参数。form 已 submit 失败 (status=failed)。**可以 refine 修正参数后重 submit**（推荐）: refine(form_id, args={ content: \"<整份计划 markdown>\" }) 会自动把 form 切回 open, 再 submit; 或 close(form_id) 彻底放弃这次调用。",
    };
  }
  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: `${NIL_PERSISTENCE_NOTE} (拟设置计划，长度 ${content.length} 字符)` };
  await writePlan(ref, content);
  return { ok: true, result: "已设置当前对象的行动计划（plan.md 已更新；未完成步骤常驻 self_view）。" };
}

// ─────────────────────────── plan_clear ────────────────────────────────────────

export const planClearCommand: MethodEntry = {
  paths: [PlanCommandPath.Clear],
  match: () => [PlanCommandPath.Clear],
  knowledge: (): MethodKnowledgeEntries => ({ [PLAN_CLEAR_BASIC_PATH]: PLAN_CLEAR_KNOWLEDGE }),
  exec: (ctx) => executePlanClear(ctx),
};

export async function executePlanClear(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: NIL_PERSISTENCE_NOTE };
  const existing = await readPlan(ref);
  if (existing.trim().length === 0) {
    return { ok: true, result: "当前对象没有 active 计划，无需清空。" };
  }
  await writePlan(ref, "");
  return { ok: true, result: "已清空当前对象的行动计划（plan.md 清空；self_view 不再渲染 plan）。" };
}
