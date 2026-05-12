import type { ThreadContext } from "../../thinkable/context.js";
import { deriveStoneFromThread } from "../../persistable/index.js";
import { createProgramSelf } from "../server/self.js";
import { formatProgramResult } from "./format.js";

export async function runFunctionProgram(
  thread: ThreadContext,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!thread.persistence) {
    return `[program.function] 当前线程无 persistence ref，无法调用 server 方法`;
  }

  const stoneRef = deriveStoneFromThread(thread.persistence);
  try {
    const self = createProgramSelf(stoneRef, thread);
    const returnValue = await self.callMethod(fn, args);
    return formatProgramResult(`# function: ${fn}`, "", returnValue);
  } catch (error) {
    return formatProgramResult(`# function: ${fn}`, "", undefined, (error as Error).message);
  }
}
