/**
 * example — executable 维度样板。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { DEFAULT_VIEWPORT } from "@ooc/core/extendable/_shared/viewport.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";
import type { ExampleWindow } from "../types.js";

const bumpMethod: ObjectMethod = {
  description: "Increment the example window's bump counter.",
  exec: (ctx: MethodExecutionContext) => {
    const self = ctx.self as ExampleWindow | undefined;
    if (!self) return "[example.bump] 缺少 self。";
    self.bumpCount = (self.bumpCount ?? 0) + 1;
    return `bumped → ${self.bumpCount}`;
  },
};

const closeMethod: ObjectMethod = {
  description: "Close this example window.",
  exec: () => undefined,
};

const exampleConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Create an example window showing a message (authoring reference).",
  intents: ["example"],
  schema: {
    args: {
      message: { type: "string", description: "要展示的文本（可多行）" },
    },
  },
  permission: () => "allow",
  exec: (ctx: MethodExecutionContext) => {
    const message = isString(ctx.args.message) ? ctx.args.message : "(empty)";
    const window: ExampleWindow = {
      id: generateWindowId("example"),
      type: "example",
      parentWindowId: ROOT_WINDOW_ID,
      title: "example",
      status: "open",
      createdAt: Date.now(),
      message,
      bumpCount: 0,
      state: { viewport: { ...DEFAULT_VIEWPORT } },
    };
    return { ok: true, window };
  },
};

builtinRegistry.registerExecutable("example", {
  methods: {
    bump: bumpMethod,
    close: closeMethod,
    example: exampleConstructor,
  },
});
