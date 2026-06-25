/**
 * user —— ooc class。代表人类用户的**被动** object。
 *
 * 设计：
 * - 不持 thinkable —— user 不跑 thinkloop（scheduler 跳过它）
 * - 只持 readable（在 agent context 里露名 + 标识）+ 极简 persistable
 * - agent.talk(target="user") 向 user 推 messages；user 经控制面回复（人类驱动）
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
  description: "Create a user object (passive, driven by human via control plane).",
  schema: {
    name: { type: "string", required: false, description: "display name" },
  },
  exec: (_ctx: ConstructorContext, args: { name?: string }): Data => ({
    name: args.name,
  }),
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "user",
    content: [
      xmlElement("user", { name: self.data?.name ?? "user" }, [
        xmlText("(human user; messages from control plane)"),
      ]),
    ],
  }),
  window: [
    {
      class: "user",
      object_methods: [],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/user",
  construct,
  readable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
