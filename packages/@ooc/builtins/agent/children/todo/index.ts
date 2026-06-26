/**
 * todo —— ooc class。一项 todo item，agent 在 thread context 里登记的小颗粒任务。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
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
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import { type Data, VERSIONED_FIELDS } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Create a todo item.",
  schema: {
    content: { type: "string", required: true, description: "todo 内容" },
  },
  exec: (_ctx: ConstructorContext, args: { content?: string }): Data => ({
    content: args.content ?? "",
    status: "open",
    createdAt: Date.now(),
  }),
};

const markInProgressMethod: ObjectMethod<Data> = {
  name: "in_progress",
  description: "Mark this todo as in progress.",
  schema: {},
  exec: (_ctx: ExecutableContext, self) => {
    self.data.status = "in_progress";
    return { message: "[todo] in_progress" };
  },
};

const markDoneMethod: ObjectMethod<Data> = {
  name: "done",
  description: "Mark this todo as done.",
  schema: {},
  exec: (_ctx: ExecutableContext, self) => {
    self.data.status = "done";
    self.data.doneAt = Date.now();
    return { message: "[todo] done" };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [markInProgressMethod, markDoneMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "default",
    content: [
      xmlElement("content", {}, [xmlText(self.data.content)]),
      xmlElement("status", {}, [xmlText(self.data.status)]),
    ],
  }),
  window: [
    {
      class: "default",
      object_methods: ["in_progress", "done"],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/todo",
  construct,
  executable,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
