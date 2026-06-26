/**
 * method_exec_form —— ooc class。「填表式渐进执行」的 form 对象，服务于 `ObjectGuideMethod` 触发。
 *
 * 流程：
 *   1. agent 经 exec(window, guideName, partialArgs) 调用某 object 的 **guide method** → runtime
 *      跑 guide.route 拿 ObjectMethodIntents：
 *      - `quickSubmit=true` → runtime 直接 guide.exec（不开 form）。
 *      - 否则 → runtime 自动 instantiate `method_exec_form` 实例（本 class），把 form ref 返给 tool call。
 *   2. agent 经 form.refine(args) 累积参数 + 触发 guide.route 重算 → currentTip / currentIntents 写回 form data。
 *   3. agent 经 form.submit() 真正 exec 目标 guide（用累积参数）。
 *
 * 设计权威：`.ooc-world-meta/.../children/executable/self.md`（form 协议）+ issue
 * 2026-06-26-object-guide-method-split.md。
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
import { type Data, VERSIONED_FIELDS } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Open a method_exec_form to progressively fill args for a target guide method.",
  schema: {
    targetObjectId: { type: "string", required: true, description: "目标对象 id（guide 所属对象）" },
    guideName: { type: "string", required: true, description: "目标 guide method 名" },
    accumulatedArgs: { type: "object", required: false, description: "初始累积参数（partialArgs）" },
    currentTip: { type: "string", required: false, description: "初始 tip（route 输出）" },
    currentIntents: { type: "object", required: false, description: "初始 intents（route 输出）" },
    want: { type: "string", required: false, description: "open 原语注入的自然语言意图（issue E）" },
  },
  exec: (
    _ctx: ConstructorContext,
    args: {
      targetObjectId?: string;
      guideName?: string;
      // 历史 alias：旧调用方仍传 targetMethod 时兼容一段
      targetMethod?: string;
      accumulatedArgs?: Record<string, unknown>;
      currentTip?: string;
      currentIntents?: string[];
      want?: string;
    },
  ): Data => ({
    targetObjectId: args.targetObjectId ?? "",
    guideName: args.guideName ?? args.targetMethod ?? "",
    accumulatedArgs: args.accumulatedArgs ?? {},
    currentTip: args.currentTip,
    currentIntents: args.currentIntents,
    want: args.want,
    createdAt: Date.now(),
  }),
};

const refineMethod: ObjectMethod<Data> = {
  name: "refine",
  description:
    "Merge args into the form and re-run the target guide's route to refresh currentTip / currentIntents.",
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
    self.data.lastError = undefined;
    // 经 runtime.runRoute 计算 tip/intents（resolve 目标 guide method）
    const intents = await ctx.runtime.runRoute?.(
      self.data.targetObjectId,
      self.data.guideName,
      merged,
    );
    if (intents) {
      self.data.currentTip = intents.tip;
      self.data.currentIntents = intents.intents;
    }
    return {
      message: `[form] refined; tip=${self.data.currentTip ?? "—"}`,
    };
  },
};

const submitMethod: ObjectMethod<Data> = {
  name: "submit",
  description: "Submit the form: call target guide method's exec with accumulated args.",
  schema: {},
  exec: async (ctx: ExecutableContext, self) => {
    if (!ctx.runtime.execGuide) {
      const err = "[form] runtime.execGuide unavailable";
      self.data.lastError = err;
      return { err };
    }
    try {
      const out = await ctx.runtime.execGuide(
        self.data.targetObjectId,
        self.data.guideName,
        self.data.accumulatedArgs,
      );
      if (!out) {
        const err = `[form] guide not found: ${self.data.targetObjectId}::${self.data.guideName}`;
        self.data.lastError = err;
        return { err };
      }
      self.data.lastError = out.err;
      return out;
    } catch (e) {
      const msg = (e as Error).message;
      self.data.lastError = msg;
      return { err: msg };
    }
  },
};

const executable: ExecutableModule<Data> = {
  methods: [refineMethod, submitMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => {
    const d = self.data;
    const contextChildren = [
      xmlElement("target_object", { id: d.targetObjectId }, []),
      xmlElement("guide", { name: d.guideName }, []),
      xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(d.accumulatedArgs, null, 2))]),
    ];
    if (d.want) {
      contextChildren.push(xmlElement("want", {}, [xmlText(d.want)]));
    }
    if (d.currentTip) {
      contextChildren.push(xmlElement("current_tip", {}, [xmlText(d.currentTip)]));
    }
    if (d.currentIntents && d.currentIntents.length > 0) {
      contextChildren.push(
        xmlElement(
          "current_intents",
          {},
          d.currentIntents.map((i) => xmlElement("intent", {}, [xmlText(i)])),
        ),
      );
    }
    if (d.lastError) {
      contextChildren.push(xmlElement("last_error", {}, [xmlText(d.lastError)]));
    }
    return {
      view: "default",
      content: [xmlElement("context", {}, contextChildren)],
    };
  },
  window: [
    {
      view: "default",
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
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
