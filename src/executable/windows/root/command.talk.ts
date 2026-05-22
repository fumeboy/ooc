/**
 * root.talk command — 创建一个 talk_window，与另一个 flow object 持续会话。
 *
 * - target 是任意 flow object 的 objectId（含 "user"）
 * - submit 副作用：在 thread.contextWindows 下挂 type=talk window，初始无 targetThreadId；
 *   首次通过 talk_window.say 派送时再创建 callee thread 并回填
 * - args 完整时（target/title）open 会立刻提交 form
 * - 实际发消息走 talk_window.say，不在 root.talk 上发
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { stat } from "node:fs/promises";
import { stoneDir } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET } from "../_shared/super-constants.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type TalkWindow,
} from "../_shared/types.js";

const TALK_BASIC_PATH = "internal/executable/talk/basic";
const TALK_INPUT_PATH = "internal/executable/talk/input";

const KNOWLEDGE = `
talk 用于开启一个对外的会话窗口（talk_window），与另一个 flow object 持续会话。

参数：
- target: 必填，目标 flow object 的 objectId（"user" 也是一个 flow object）
- title: 必填，本会话的简短主题（同一 caller 多窗口区分用）

submit 后副作用：
- 在 thread.contextWindows 下挂一个 type=talk 的 window（初始 targetThreadId 为空）
- 首次发消息：open(parent_window_id="<talk_window_id>", command="say", args={ msg: "...", wait: true|false })
  - 若 callee thread 尚未存在，系统会在 flows/{sid}/objects/{target}/threads/ 下创建一条
  - 同时把消息追加到 callee.inbox + caller.outbox，callee 自动进入 running 等待 worker 调度
- 等待回复：open(parent_window_id="<talk_window_id>", command="wait", args={})
- 关闭窗口：close(window_id="<talk_window_id>", reason="...")

**重要：talk_window 是持续会话窗口，应该复用。**
- 同一个 target 在同一个 thread 内只需要一个 talk_window；后续消息全部从同一个 talk_window 的 say 走
- 不要每发一条消息就 close，再下一轮 open 一个新的——这会丢失 conversation 关联，并产生大量噪声 window
- 仅当与该对象的对话真正结束、明确不再需要回复时才 close

允许同时打开多个 talk_window 来并行维护**不同 target / 不同主题**（不是为了重复同一对话）。
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
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!target || !title) {
      entries[TALK_INPUT_PATH] =
        "talk 需要 target（任意 objectId）与 title；用 refine(args={ target: \"<objectId>\", title: \"...\" })，或在 open 时一次给齐。";
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
  const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
  if (!target) return "[talk] 缺少 target 参数。submit 后 form 已 executed, 请 close(form_id) 后重新 open(command=\"talk\", args={ target: \"<objectId>\", title: \"<会话主题>\" }) 一次性给齐; 下次 open 时直接附 args 可避免失败回路。";
  const title = typeof ctx.args.title === "string" ? deriveTitle(ctx.args.title) : "";
  if (!title) return "[talk] 缺少 title 参数。submit 后 form 已 executed, 请 close(form_id) 后重新 open(command=\"talk\", args={ target: \"<objectId>\", title: \"<会话主题>\" }) 一次性给齐; 下次 open 时直接附 args 可避免失败回路。";

  // target 校验:对应 stones/{target}/ 必须存在,否则 LLM 容易因 typo 等错误
  // 与"幻 peer"对话,且 relation 派生(meta/object/collaborable/relation)会全部
  // 静默跳过,无视错。super alias 是预定义自反目标,豁免。thread.persistence 缺失
  // (测试 fixture 等异常)走安全网跳过校验,不破现有单元测试。
  if (target !== SUPER_ALIAS_TARGET && thread.persistence?.baseDir) {
    const dir = stoneDir({ baseDir: thread.persistence.baseDir, objectId: target });
    let exists = false;
    try {
      const info = await stat(dir);
      exists = info.isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!exists) {
      return `[talk] target \`${target}\` 不存在(stones/${target}/ 目录未找到)。请检查 target 拼写是否正确;若是新对象,先创建 stone object 再 open talk_window。`;
    }
  }

  const id = generateWindowId("talk");
  const talkWindow: TalkWindow = {
    id,
    type: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title,
    status: "open",
    createdAt: Date.now(),
    target,
    conversationId: id,
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(talkWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), talkWindow];
  }
  return undefined;
}
