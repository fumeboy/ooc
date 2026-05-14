/**
 * root.talk command — 创建一个 talk_window，与外部 target 持续会话。
 *
 * spec § talk_window：
 * - submit 副作用：在 thread.contextWindows 下挂 type=talk window，
 *   target=user, conversationId=windowId, title=args.title
 * - args 完整时（target/title）C 规则触发自动 submit
 * - 实际发消息走 talk_window.say，不在 root.talk 上发
 *
 * 当前阶段限制：target 只能是 "user"。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type TalkWindow,
} from "../types.js";

const TALK_BASIC_PATH = "internal/executable/talk/basic";
const TALK_INPUT_PATH = "internal/executable/talk/input";

const KNOWLEDGE = `
talk 用于开启一个对外的会话窗口（talk_window）。当前阶段 target 只能是 "user"。

参数：
- target: 必填，目前仅 "user"
- title: 必填，本会话的简短主题（多窗口区分用）

submit 后副作用：
- 在 thread.contextWindows 下挂一个 type=talk 的 window
- 后续发消息：open(parent_window_id="<talk_window_id>", command="say", args={ msg: "...", wait: true|false })
- 等待回复：open(parent_window_id="<talk_window_id>", command="wait", args={})
- 关闭窗口：close(window_id="<talk_window_id>", reason="...")

允许同时打开多个 talk_window 来并行维护不同主题。
`.trim();

export enum TalkCommandPath {
  Talk = "talk",
}

/** root.talk command：创建 talk_window；不直接发消息。 */
export const talkCommand: CommandTableEntry = {
  paths: [TalkCommandPath.Talk],
  match: () => [TalkCommandPath.Talk],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [TALK_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const target = typeof args.target === "string" ? args.target : "";
    const title = typeof args.title === "string" ? args.title : "";
    if (!target || !title) {
      entries[TALK_INPUT_PATH] =
        "talk 需要 target 与 title；用 refine(args={ target: \"user\", title: \"...\" })，或在 open 时一次给齐。";
    } else if (target !== "user") {
      entries[TALK_INPUT_PATH] = `talk 当前阶段仅支持 target="user"，收到 "${target}"。`;
    }
    return entries;
  },
  exec: (ctx) => executeTalkCommand(ctx),
};

function deriveTitle(raw: string, max = 60): string {
  const trimmed = raw.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

/** root.talk 执行入口：构建并挂载 talk_window。 */
export async function executeTalkCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk] 缺少 thread context。";
  const target = typeof ctx.args.target === "string" ? ctx.args.target : "";
  if (target !== "user") {
    return `[talk] 当前阶段仅支持 target="user"（收到 "${target}"）。`;
  }
  const title = typeof ctx.args.title === "string" ? deriveTitle(ctx.args.title) : "";
  if (!title) return "[talk] 缺少 title 参数。";

  const id = generateWindowId("talk");
  const talkWindow: TalkWindow = {
    id,
    type: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title,
    status: "open",
    createdAt: Date.now(),
    target: "user",
    conversationId: id,
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(talkWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), talkWindow];
  }
  return undefined;
}
