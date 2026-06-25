/**
 * plan —— ooc class。agent 的 plan window：把分步规划放在 thread context 里供 LLM 持续推进。
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
import { type Data, type PlanStep, VERSIONED_FIELDS } from "./types.js";

function generateStepId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const construct: ObjectConstructor<Data> = {
  description: "Open a plan (empty step list).",
  schema: {},
  exec: (_ctx: ConstructorContext, _args: Record<string, unknown>): Data => ({
    steps: [],
    createdAt: Date.now(),
  }),
};

const addStepMethod: ObjectMethod<Data> = {
  name: "add_step",
  description: "Append a step to the plan.",
  schema: {
    content: { type: "string", required: true, description: "step content" },
  },
  exec: (_ctx: ExecutableContext, self, args: { content?: string }) => {
    const step: PlanStep = {
      id: generateStepId(),
      content: args.content ?? "",
      status: "pending",
    };
    self.data.steps.push(step);
    return { message: `[plan] step added: ${step.id}` };
  },
};

const markStepMethod: ObjectMethod<Data> = {
  name: "mark_step",
  description: "Mark a plan step's status.",
  schema: {
    step_id: { type: "string", required: true, description: "step id" },
    status: { type: "string", required: true, enum: ["pending", "in_progress", "done"], description: "新状态" },
  },
  exec: (_ctx: ExecutableContext, self, args: { step_id?: string; status?: PlanStep["status"] }) => {
    const step = self.data.steps.find((s) => s.id === args.step_id);
    if (!step) return { err: `[plan] step not found: ${args.step_id}` };
    step.status = args.status ?? step.status;
    return { message: `[plan] step ${step.id} → ${step.status}` };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [addStepMethod, markStepMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "plan",
    content: self.data.steps.map((s) =>
      xmlElement("step", { id: s.id, status: s.status }, [xmlText(s.content)]),
    ),
  }),
  window: [
    {
      class: "plan",
      object_methods: ["add_step", "mark_step"],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/plan",
  construct,
  executable,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data, PlanStep } from "./types.js";
