/**
 * example —— executable 维度（object method）样板。
 *
 * object method 签名 `(ctx, self, args)`，**可改 self（Data）、可副作用**。
 * 与 readable 维度（投影 + window method，在 ../readable.ts）物理分离。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const bumpMethod: ObjectMethod<Data> = {
  name: "bump",
  description: "Increment the example object's bump counter.",
  exec: (_ctx: ExecutableContext, self: Data) => {
    self.bumpCount = (self.bumpCount ?? 0) + 1;
    return `bumped → ${self.bumpCount}`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [bumpMethod],
};

export default executable;
