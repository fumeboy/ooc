/**
 * root.talk method — 向另一个 flow object 发一条消息（OOC-4 L5c talk 塌缩 / Phase C）。
 *
 * agent-facing：agent 不再创建 / 操作 talk_window。一次 `talk(target, content, wait?)` 合一：
 * - 读 caller.talks.json[target] 拿已有会话路由（targetThreadId / conversationId）
 * - 经 window-free `deliverMessage` 派送（写 caller.outbox + callee.inbox + 双向 talks.json + 翻 callee 状态）
 * - wait=true → 本 thread 进 waiting（inboxSnapshotAtWait/waitingOn 记录，等对端回信经 scheduler 唤醒）
 *
 * 会话历史经自视 talk 切片（self-view.ts `<talks>`）呈现，不再有 talk_window 渲染。
 *
 * - target 是任意 flow object 的 objectId（"user" / "super" 自指别名也合法）
 * - 同一 target 复用同一会话路由（talks.json[target]）；不需要"创建窗口"概念
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import { stat } from "node:fs/promises";
import { readTalks, stoneDir, type FlowObjectRef } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET } from "../_shared/super-constants.js";
import { deliverMessage } from "../talk/delivery.js";

const TALK_BASIC_PATH = "internal/executable/talk/basic";
const TALK_INPUT_PATH = "internal/executable/talk/input";

const KNOWLEDGE = `
talk 向另一个 flow object 发一条消息，与它持续会话。

参数：
- target: 必填，目标 flow object 的 objectId（"user" 也是一个 flow object；"super" 是自指反思别名）
- content: 必填，消息正文
- wait: 可选，true 时发完进入 status="waiting"，等对端回信进 inbox 后唤醒；false / 缺省时发完不等

行为（一步到位，args 给齐时 open 立即提交 form）：
  open(method="talk", title="询问发布时间",
       args={ target: "bob", content: "明天可以发布吗？", wait: true })

- 消息追加到本 thread.outbox + 派送到对端 object 的 callee thread.inbox（首条会创建 callee thread）
- 对端自动进入 running，由 worker 调度
- 会话路由（targetThreadId / conversationId）持久在你的 talks.json[target]；同一 target 后续 talk 自动复用，
  不需要"创建窗口 / 复用窗口"——直接再 talk(target=同一对象) 即可
- 你与各 peer 的会话历史会出现在 <self_view><talks> 自视切片里（按 peer 分组，最近若干条）

**收到对端消息后回复**：直接 talk(target=对方 objectId, content="...")——按对端 objectId 路由回去，
不需要找"是哪个窗口发来的"。
`.trim();

export enum TalkCommandPath {
  Talk = "talk",
  Wait = "talk.wait",
}

/** root.talk method：window-free 派送消息（可选 wait）。 */
export const talkCommand: MethodEntry = {
  paths: [TalkCommandPath.Talk, TalkCommandPath.Wait],
  match: (args) => {
    const hit: string[] = [TalkCommandPath.Talk];
    if (args.wait === true) hit.push(TalkCommandPath.Wait);
    return hit;
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [TALK_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!target || !content) {
      const missing: string[] = [];
      if (!target) missing.push("target");
      if (!content) missing.push("content");
      entries[TALK_INPUT_PATH] =
        `talk 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ target: \"<objectId>\", content: \"<消息正文>\", wait: true|false }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeTalkCommand(ctx),
};

function objectRef(thread: NonNullable<MethodExecutionContext["thread"]>): FlowObjectRef | undefined {
  const ref = thread.persistence;
  if (!ref?.objectId || !ref.baseDir) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

const REFINE_HINT =
  "form 已 submit 失败 (status=failed)。**可以 refine 修正参数后重 submit**（推荐）: " +
  "refine(form_id, args={ target: \"<objectId>\", content: \"<消息正文>\", wait: true|false }) 会自动把 form 切回 open, 再 submit; " +
  "或 close(form_id) 彻底放弃这次调用。";

/** root.talk 执行入口：window-free 派送消息（+ 可选 wait）。 */
export async function executeTalkCommand(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[talk] 缺少 thread context。";
  const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
  if (!target) return `[talk] 缺少 target 参数。${REFINE_HINT}`;
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (!content.trim()) return `[talk] 缺少 content 参数。${REFINE_HINT}`;
  if (!thread.persistence?.baseDir) {
    return "[talk] 当前 thread 无 persistence ref，无法跨对象派送。";
  }

  // target 校验：对应 stones/{target}/ 必须存在，否则 LLM 容易因 typo 与"幻 peer"对话，
  // 且 relation 派生会全部静默跳过无视错。super alias 是预定义自反目标，豁免。
  if (target !== SUPER_ALIAS_TARGET) {
    const dir = stoneDir({ baseDir: thread.persistence.baseDir, objectId: target });
    let exists = false;
    try {
      const info = await stat(dir);
      exists = info.isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!exists) {
      return `[talk] target \`${target}\` 不存在(stones/${target}/ 目录未找到)。请检查 target 拼写是否正确;若是新对象,先创建 stone object 再 talk。`;
    }
  }

  // 读已有会话路由（targetThreadId / conversationId）；首条消息时缺省，由 deliverMessage 生成。
  let targetThreadId: string | undefined;
  let conversationId: string | undefined;
  const ref = objectRef(thread);
  if (ref) {
    try {
      const routing = await readTalks(ref);
      const route = routing[target];
      if (route) {
        targetThreadId = route.targetThreadId;
        conversationId = route.conversationId;
      }
    } catch {
      // talks.json 读失败（损坏等）不致命：当作首条消息派送（deliverMessage 兜底创建）。
    }
  }

  let result;
  try {
    result = await deliverMessage({
      thread,
      target,
      conversationId,
      targetThreadId,
      content,
      source: "talk",
    });
  } catch (err) {
    return `[talk] 派送失败：${(err as Error).message}`;
  }

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    // waitingOn 仅作 observability：window-free 后用 conversationId 标记在等哪对会话。
    thread.waitingOn = result.conversationId;
  }
  return undefined;
}
