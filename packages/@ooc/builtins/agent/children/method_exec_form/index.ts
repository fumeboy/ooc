/**
 * method_exec_form —— ooc class。「填表式渐进执行」的 form 对象。
 *
 * 流程：
 *   1. agent 调用某 object 的 method（声明了 route）→ runtime 创建 method_exec_form 实例
 *   2. agent 经 form.refine 累积参数 + 触发 route 重算 → tip / intents 进 context
 *   3. agent 经 form.submit 真正 exec 目标 method（用累积参数）
 */
import type { OocClass, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ObjectConstructor,
  ConstructorContext,
  ReadableModule,
  ReadableContext,
  ReadonlySelfProxy,
  ExecutableModule,
  ObjectMethod,
  ExecutableContext,
} from "@ooc/core/types/index.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import type { Data } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Open a method_exec_form to progressively fill args for a target method.",
  schema: {
    targetObjectId: { type: "string", required: true, description: "目标对象 id" },
    targetMethod: { type: "string", required: true, description: "目标 method 名" },
  },
  exec: (_ctx: ConstructorContext, args: { targetObjectId?: string; targetMethod?: string }): Data => ({
    targetObjectId: args.targetObjectId ?? "",
    targetMethod: args.targetMethod ?? "",
    accumulatedArgs: {},
    createdAt: Date.now(),
  }),
};

const refineMethod: ObjectMethod<Data> = {
  name: "refine",
  description: "Merge args into the form and re-run target method's route to refresh tip/intents.",
  schema: {
    args: { type: "object", required: true, description: "本次新增/覆盖的参数" },
  },
  exec: async (
    ctx: ExecutableContext,
    self,
    args: { args?: Record<string, unknown> },
  ) => {
    const merged = { ...self.data.accumulatedArgs, ...(args.args ?? {}) };
    self.data.accumulatedArgs = merged;
    // 经 runtime.runRoute 计算 tip/intents
    const intents = await ctx.runtime.runRoute?.(
      self.data.targetObjectId,
      self.data.targetMethod,
      merged,
    );
    if (intents) {
      self.data.tip = intents.tip;
      self.data.intents = intents.intents;
    }
    return { message: `[form] refined; tip=${self.data.tip ?? "—"}` };
  },
};

const submitMethod: ObjectMethod<Data> = {
  name: "submit",
  description: "Submit the form: call target method with accumulated args.",
  schema: {},
  exec: async (ctx: ExecutableContext, self) => {
    if (!ctx.runtime.callMethod) {
      return { err: "[form] runtime.callMethod unavailable" };
    }
    const out = await ctx.runtime.callMethod(
      self.data.targetObjectId,
      self.data.targetMethod,
      self.data.accumulatedArgs,
    );
    return { message: out ?? "(submitted)" };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [refineMethod, submitMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "method_exec_form",
    content: [
      xmlElement("target", { object: self.data.targetObjectId, method: self.data.targetMethod }, []),
      xmlElement("args", {}, [xmlText(JSON.stringify(self.data.accumulatedArgs, null, 2))]),
      ...(self.data.tip ? [xmlElement("tip", {}, [xmlText(self.data.tip)])] : []),
    ],
  }),
  window: [
    {
      class: "method_exec_form",
      object_methods: ["refine", "submit"],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/method_exec_form",
  construct,
  executable,
  readable,
};

export type { Data } from "./types.js";
