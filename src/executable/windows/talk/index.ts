/**
 * talk_window — 与另一个 flow object 的某条 thread 持续会话。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * - 注册的 command：say / wait / close
 * - say：通过 talk-delivery 把消息派送到 target object 的 callee thread；同时记入本 thread.outbox
 * - wait：父线程进 status=waiting + inboxSnapshotAtWait 写入
 * - close：onClose 拒绝关闭 creator talk_window（与 caller 的恒在通道）；其他 talk_window 释放即可
 * - 视图：transcript 按 outbox.windowId === self.id || inbox.replyToWindowId === self.id 过滤
 */

import { registerWindowType, type OnCloseContext } from "../_shared/registry.js";
import { sayCommand } from "./command.say.js";
import { waitCommand } from "./command.wait.js";
import { closeCommand } from "./command.close.js";

/**
 * talk_window 的 type-level basicKnowledge。
 *
 * 通过 registerWindowType 注入；只要 thread.contextWindows 里出现至少一个 talk_window，
 * 全局基础知识合成阶段就会把这段文本作为一个 protocol KnowledgeWindow 注入到 context，
 * 让 LLM 在还没 open 任何 say/wait form 时就知道 talk_window 的命令面与典型用法。
 */
const TALK_WINDOW_BASIC_KNOWLEDGE = `
talk_window 是与一个对端 flow object 的持续会话窗口。它注册的 command 不在 root 上，
要通过 open(parent_window_id="<talk_window_id>", command="...", args={...}) 调用：

| command | 作用 | 典型用法 |
|---------|------|----------|
| say     | 发一条消息给对端，并可选地把本线程切到 waiting | open(parent_window_id="<talk_window_id>", command="say", args={ msg: "...", wait: true|false }) |
| wait    | 不发消息、仅切到 waiting 等下一条 inbox        | open(parent_window_id="<talk_window_id>", command="wait") |
| close   | 结束本对话主题                                  | close(window_id="<talk_window_id>", reason="...") |

**关键提醒**：
- talk_window **不接受** root 级别的 \`talk\` command；那是用来"创建新 talk_window"的，不是发消息
- 想发消息只用 \`say\`；想等回信用 \`wait\`；想结束对话用 \`close\`
- 同一个对端复用同一个 talk_window，不要每发一条消息就 close 再重开
- creator talk_window（isCreatorWindow=true）= 创建本 thread 的对端给你的回信通道；
  收到 inbox 消息后回复就走它的 \`say\`，不要 open 新的 talk

## 关系记录（relation）

你对每个 peer 的长期认知请写到 \`pools/<self>/knowledge/relations/<peer>.md\`
（普通 markdown，一个 peer 一份）。每当 thread 里存在指向某 peer 的 talk_window 时，
系统会自动在 context 注入两条 knowledge:
- \`stones/<peer>/readme.md\` —— peer 公开自述
- \`pools/<self>/knowledge/relations/<peer>.md\` —— 你对该 peer 的认知

如果你**还没**对该 peer 写过 relation，第二条会显示一段占位提示，告诉你按上述
路径写入。形成新认知后通过 \`open(command="write_file", path="pools/<self>/knowledge/relations/<peer>.md", content="...")\`
（或 \`open(command="open_file") + edit\` 增量更新）即可。下次再与该 peer 对话时，
文件会自动作为 knowledge 出现在你的 context。
`.trim();

/** talk_window 的 onClose hook：creator talk_window 不可关闭。 */
function onCloseTalkWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "talk") return;
  if (w.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] talk_window "${w.id}" 是初始 creator talk_window，与 caller 的恒在通道，不可关闭。`,
    });
    return false;
  }
  return true;
}

registerWindowType("talk", {
  commands: {
    say: sayCommand,
    wait: waitCommand,
    close: closeCommand,
  },
  onClose: onCloseTalkWindow,
  basicKnowledge: TALK_WINDOW_BASIC_KNOWLEDGE,
});
