import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { DoWindow } from "../_shared/types.js";
import { archiveDoWindowChild } from "./helpers.js";

async function executeDoWindowClose(ctx: MethodExecutionContext): Promise<string | undefined> {
  const window = ctx.self as DoWindow;
  archiveDoWindowChild(ctx.thread, window);
  return undefined;
}

export const closeMethod: ObjectMethod = {
  description: "Archive the child thread and close this do_window.",
  exec: (ctx) => executeDoWindowClose(ctx),
};
