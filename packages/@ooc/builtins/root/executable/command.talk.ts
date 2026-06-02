/**
 * root.talk command — 委托到 talk_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.talk 的构造逻辑（target 校验 + TalkWindow build）已迁到
 * packages/@ooc/core/executable/windows/talk/index.ts 的 kind="constructor" talk method。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("talk") 委托。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 talk_window constructor 注册
import "@ooc/core/executable/windows/talk/index.js";

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

/** root.talk command：委托到 talk_window constructor。 */
export const talkCommand: CommandTableEntry = {
  paths: [TalkCommandPath.Talk],
  match: () => [TalkCommandPath.Talk],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [TALK_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!target || !title) {
      const missing: string[] = [];
      if (!target) missing.push("target");
      if (!title) missing.push("title");
      entries[TALK_INPUT_PATH] =
        `talk 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ target: \"<objectId>\", title: \"<会话主题>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeTalkCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 talk_window constructor。
 */
export async function executeTalkCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("talk");
  if (!ctor) return "[talk] talk_window constructor 未注册（registry 期望 kind=\"constructor\" 的 talk method）。";
  return await ctor.exec(ctx);
}
