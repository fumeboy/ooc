import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectConstructor } from "@ooc/core/types";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import persistable from "./persistable/index.js";
import { type Data, VERSIONED_FIELDS } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Create an agent instance with an identity (self.md text).",
  schema: {
      self: {
        type: "string",
        required: false,
        description: "agent 身份正文（self.md 内容）；缺省为空，可后续编辑。",
      },
    },
  exec: (_ctx, args) => ({
    self: typeof args?.self === "string" ? args.self : "",
  }),
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent",
  construct,
  executable,
  readable,
  persistable,
  versioned_fields: VERSIONED_FIELDS,
};

export type { Data } from "./types.js";
