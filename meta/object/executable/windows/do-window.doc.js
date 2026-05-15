import * as doWindow from "@src/executable/windows/do";

/**
 * do_window 概念：fork 子线程后产生的对话窗口。
 *
 * sources:
 *  - doWindow — continue / wait / close 命令注册 + onClose hook
 */
export const do_window_v20260515_1 = {
  name: "DoWindow",
  description: `
do_window 是 fork 子线程后产生的对话窗口（root.do submit 的副作用）。
父线程通过 do_window 的 continue / wait / close 与子线程交互；
do_window 的 transcript 是 inbox/outbox 在 targetThreadId 视角下的视图。

特例：isCreatorWindow=true 是初始 creator do_window（同 object 内 fork），
不可被 LLM 主动 close。
`.trim(),
  sources: { doWindow },
};
