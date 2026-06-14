import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { TalkWindow } from "../_shared/types.js";
import { archiveForkChild } from "./fork.js";

async function executeTalkWindowClose(ctx: MethodExecutionContext): Promise<string | undefined> {
  const window = ctx.self as TalkWindow;
  // fork 子线程窗 close → archive 子线程（peer 会话窗无副作用，纯关窗）。
  if (window.isForkWindow) {
    archiveForkChild(ctx.thread, window);
  }
  return undefined;
}

export const closeMethod: ObjectMethod = {
  description: "Close this talk_window. Fork child windows archive the child thread; the creator talk_window cannot be closed.",
  // peer 会话窗的关窗副作用由 onClose hook 处理；fork 窗在此 archive 子线程。
  exec: (ctx) => executeTalkWindowClose(ctx),
};
