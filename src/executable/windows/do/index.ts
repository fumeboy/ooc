/**
 * do_window — fork 子线程后在父线程下产生的对话窗口。
 *
 * spec § do_window：
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command：continue / wait / close
 * - close 语义：B=ii archive — 把 child thread 标记为 archived；window 释放
 * - 特殊子类：初始 creator do_window（由 windows/_shared/init.ts 创建），不可被 LLM close
 */

import { registerWindowType, type OnCloseContext } from "../_shared/registry.js";
import { continueCommand } from "./command.continue.js";
import { waitCommand } from "./command.wait.js";
import { closeCommand } from "./command.close.js";
import { moveCommand } from "./command.move.js";
import { archiveDoWindowChild } from "./helpers.js";

function onCloseDoWindow(ctx: OnCloseContext): boolean | void {
  const window = ctx.window;
  if (window.type !== "do") return;
  if (window.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] window ${window.id} 是初始 creator do_window，不可关闭（spec § 初始 creator 对话 window）。`,
    });
    return false;
  }
  archiveDoWindowChild(ctx.thread, window);
}

registerWindowType("do", {
  commands: {
    continue: continueCommand,
    wait: waitCommand,
    close: closeCommand,
    move: moveCommand,
  },
  onClose: onCloseDoWindow,
});
