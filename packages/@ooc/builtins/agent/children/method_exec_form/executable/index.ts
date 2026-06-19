/**
 * method_exec_form —— executable 维度（object method）。
 *
 * refine / submit 是 form 自身的两条 object method（改 Data / 触发副作用，故归 executable）。
 */

import type {
  ExecutableContext,
  ExecutableModule,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import { buildFillState } from "../schema-fill.js";
import type { Data } from "../types.js";

/**
 * refine —— 把本次 args 整体 merge 进 form.accumulatedArgs，重算 fill。
 * failed 态 refine 可"复活"回 open。只累积、不触发目标 method 执行（那是 submit）。
 */
const refine: ObjectMethod<Data> = {
  name: "refine",
  description: "Accumulate more args into this form (key/value merge); does not execute.",
  exec: async (ctx: ExecutableContext, self: Data, args: Record<string, unknown>) => {
    if (self.status !== "open" && self.status !== "failed") {
      return { err: `form 不在 open/failed 状态（当前 ${self.status}），无法 refine。` };
    }
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length === 0) {
      return { err: "refine 需要至少一个参数键值对；要执行请用 submit。" };
    }
    self.accumulatedArgs = { ...self.accumulatedArgs, ...args };
    self.fill = buildFillState(self.schema, self.accumulatedArgs, self.fill);
    const revived = self.status === "failed";
    if (revived) self.status = "open";
    // 重跑目标 method 的 route：累积参数后刷新 tip / intentPaths（渐进意图 → phase-2 知识激活的来源）。
    const routed = await ctx.runtime?.runRoute?.(self.targetObjectId, self.method, self.accumulatedArgs);
    if (routed) {
      self.tip = routed.tip;
      if (routed.intents && routed.intents.length > 0) self.intentPaths = routed.intents;
    }
    await ctx.reportDataEdit?.();
    return `已累积参数：${Object.keys(args).join(", ")}${revived ? "（form 已从 failed 复活回 open）" : ""}。`;
  },
};

/**
 * submit —— 触发目标 method 真正执行（用累积参数）。
 *
 * 经 runtime.callMethod(targetObjectId, method, accumulatedArgs) 回调目标对象——走 runtime 派发，
 * 不再触发 route（route 只在 exec 工具边界消费），故无递归。成功 → status=success + 从 context 移除；
 * 失败（目标 method throw）→ status=failed + 留 result，refine 可复活重 submit。
 */
const submit: ObjectMethod<Data> = {
  name: "submit",
  description: "Submit this form: execute the routed method with the accumulated args.",
  exec: async (ctx: ExecutableContext, self: Data) => {
    if (self.status !== "open") {
      return { err: `form 不在 open 状态（当前 ${self.status}），无法 submit。` };
    }
    if (!ctx.runtime?.callMethod) {
      return { err: "缺少 runtime.callMethod，无法 submit。" };
    }
    self.status = "executing";
    try {
      const result = await ctx.runtime.callMethod(
        self.targetObjectId,
        self.method,
        self.accumulatedArgs,
      );
      self.status = "success";
      // 成功：从 context 移除本 form（生命周期信封管理归 runtime）。
      await ctx.runtime.close?.(ctx.object.id);
      return `[form success] "${self.method}" 已执行并释放。${result ?? ""}`.trimEnd();
    } catch (err) {
      self.status = "failed";
      self.result = (err as Error).message;
      await ctx.reportDataEdit?.();
      return {
        err: `[form failed] "${self.method}" 执行失败：${self.result}。refine 修正参数后可重 submit。`,
      };
    }
  },
};

const executable: ExecutableModule<Data> = {
  methods: [refine, submit],
};

export default executable;
