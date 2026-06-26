/**
 * skill_index —— 派生注入对象。
 *
 * agent 默认 thread context 含一个 skill_index 窗，readable 渲染时扫 context 中所有窗的 class，
 * 经 ClassRegistry `resolveObjectMethods` 本类直查列出每个对象可调的 object method（不沿继承链；
 * 子如需复用父 methods 由子 class 源码 spread 在装配期表达，registry 只见扁平结果）。
 *
 * 当前最简：data 持 skills 数组（由外部 thinkable / 创建期填入）；readable 直接渲它。
 */
import type { OocClass, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ObjectConstructor,
  ConstructorContext,
  ReadableModule,
  ReadableContext,
  ReadonlySelfProxy,
} from "@ooc/core/types/index.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import { type Data, VERSIONED_FIELDS } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Open an empty skill index (populated by thinkable at context render time).",
  schema: {},
  exec: (_ctx: ConstructorContext, _args: Record<string, unknown>): Data => ({
    skills: [],
  }),
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => {
    const skills = self.data?.skills ?? [];
    return {
      class: "default",
      content: skills.map((s) =>
        xmlElement(
          "skill",
          { object: s.objectId, class: s.class, method: s.method },
          [xmlText(s.description)],
        ),
      ),
    };
  },
  window: [
    {
      class: "default",
      object_methods: [],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/skill_index",
  construct,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data, SkillEntry } from "./types.js";
