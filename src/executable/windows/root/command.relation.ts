/**
 * root relation_note method —— B 类 relation 塌缩后的 owner-scoped 关系认知写入（OOC-4 L6a）。
 *
 * 不再有 relation_window（已删）；relations 现由自视切片 `<self_view><relations>` 每轮自动
 * 注入（src/thinkable/context/self-view.ts:renderRelationsSlice）。relation_note 是其**写侧**：
 * - relation_note(peer, content, scope="session")：直接写
 *   `flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`（仅本 session 生效，整文件替换）。
 * - relation_note(peer, content, scope="long_term")：window-free `deliverMessage` 派一条消息给
 *   super flow（self-reflection 分身），由 super 写 `pools/<self>/knowledge/relations/<peer>.md`
 *   （跨 session 长期生效，异步——本调用返回只代表消息已派送）。
 *
 * scope 缺省视为 "session"（最常用、纯本地落盘、无副作用扩散）。
 *
 * 〔spec §1 表说 relation「无 root 方法」，但 write 能力须存（session 写 flows + long_term 经
 *  super sediment），故落为 root.relation_note；spec §4 的 write_file 不适用——relations 在
 *  flows/pools 而非 stones。记此偏离。〕
 *
 * nil-persistence（无 ctx.thread.persistence，纯内存测试模式）：无文件路径，不落盘，
 * 返回说明文本（不抛错）。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
  MethodExecOutcome,
} from "../_shared/method-types.js";
import type { FlowObjectRef } from "../../../persistable/common.js";
import { writeFlowRelation, readTalks } from "../../../persistable/index.js";
import { deliverMessage } from "../talk/delivery.js";
import { SUPER_ALIAS_TARGET } from "../_shared/super-constants.js";

const RELATION_NOTE_BASIC_PATH = "internal/executable/relation_note/basic";
const RELATION_NOTE_INPUT_PATH = "internal/executable/relation_note/input";
const RELATION_NOTE_LONGTERM_PATH = "internal/executable/relation_note/long_term_detail";

const RELATION_NOTE_KNOWLEDGE = `
relation_note 记录/更新你对某个 peer object 的关系认知（整文件替换语义）。
非空 relation 每轮在 <self_view><relations><relation peer_id=...> 自视切片中自动注入
（与该 peer 是你的 sibling/child，或你与它 talk 过时）。

参数：
- peer:    必填，对端 objectId（如 "critic" / "user" / "agent_of_x/sub1"）
- content: 必填，relation 文件完整正文（整文件替换，非 patch/append）
- scope:   可选，'session' | 'long_term'，缺省 'session'
  - session:   写 flows/<sid>/objects/<self>/knowledge/relations/<peer>.md（仅本 session 生效，不污染长期认知）
  - long_term: 派一条消息给 super flow，由 super 写 pools/<self>/knowledge/relations/<peer>.md（跨 session 长期生效）

典型用法：
  // 本 session 临时记下"该 peer 偏好简短回复"
  exec(method="relation_note", args={ peer: "critic", content: "## 偏好\\n- 简短回复\\n- 不要 emoji", scope: "session" })

  // 把本次形成的稳定合作模式固化到长期 relation
  exec(method="relation_note", args={ peer: "critic", content: "...完整正文...", scope: "long_term" })

提示：想看当前对各 peer 的关系认知，看 <self_view><relations> 自视切片（含 peer 身份介绍
与 self 的 long_term/session 两层认知）；relation_note 是覆盖语义，重复写直接覆盖整文件。
`.trim();

const RELATION_NOTE_LONGTERM_DETAIL = `
scope="long_term" 的路径详解：

1. 本调用不直接写 relation 文件——它会派一条消息到 super flow（self-reflection 分身）；
2. super flow 作为另一个 thread 收到这条消息，自行决定如何处理（典型：用 write_file 写 pools/<self>/knowledge/relations/<peer>.md）；
3. 因此 long_term relation_note 是**异步**的：本 method 返回成功只代表消息已派送，文件落盘要等 super flow 跑完那一轮。
`.trim();

/** 从 thread.persistence 派生对象级 FlowObjectRef。 */
function flowRefOf(ctx: MethodExecutionContext): FlowObjectRef | undefined {
  const ref = ctx.thread?.persistence;
  if (!ref?.objectId) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

const NIL_PERSISTENCE_NOTE =
  "[relation_note] 当前 thread 无持久化目录（内存模式），relation 文件不落盘；本次操作未持久化。";

export const relationNoteCommand: MethodEntry = {
  paths: ["relation_note", "relation_note.session", "relation_note.long_term"],
  match: (args) => {
    const scope = args.scope;
    if (scope === "long_term") return ["relation_note", "relation_note.long_term"];
    return ["relation_note", "relation_note.session"];
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [RELATION_NOTE_BASIC_PATH]: RELATION_NOTE_KNOWLEDGE };
    if (args.scope === "long_term") {
      entries[RELATION_NOTE_LONGTERM_PATH] = RELATION_NOTE_LONGTERM_DETAIL;
    }
    if (formStatus !== "open") return entries;
    const missing: string[] = [];
    if (typeof args.peer !== "string" || args.peer.length === 0) missing.push("peer");
    if (typeof args.content !== "string" || args.content.length === 0) missing.push("content");
    if (args.scope !== undefined && args.scope !== "session" && args.scope !== "long_term") {
      missing.push("scope(只能 'session' | 'long_term')");
    }
    if (missing.length > 0) {
      entries[RELATION_NOTE_INPUT_PATH] =
        `relation_note 还缺/错: ${missing.join(" + ")};用 refine(form_id, args={ peer: "...", content: "...", scope: "session" | "long_term" }) 补齐后 submit。`;
    }
    return entries;
  },
  exec: (ctx) => executeRelationNote(ctx),
};

export async function executeRelationNote(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const peer = typeof ctx.args.peer === "string" ? ctx.args.peer : "";
  if (peer.length === 0) {
    return {
      ok: false,
      error:
        "[relation_note] 缺少 peer 参数（对端 objectId）。可 refine(form_id, args={ peer: \"...\", content: \"...\" }) 修正后重 submit。",
    };
  }
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (content.length === 0) {
    return {
      ok: false,
      error:
        "[relation_note] 缺少 content 参数（relation 文件完整正文）。可 refine(form_id, args={ peer, content: \"...\" }) 修正后重 submit。",
    };
  }
  const rawScope = ctx.args.scope;
  if (rawScope !== undefined && rawScope !== "session" && rawScope !== "long_term") {
    return {
      ok: false,
      error: `[relation_note] scope 只能是 'session' | 'long_term'（缺省 'session'），收到 ${JSON.stringify(rawScope)}。`,
    };
  }
  const scope: "session" | "long_term" = rawScope === "long_term" ? "long_term" : "session";

  const ref = flowRefOf(ctx);
  if (!ref) {
    return { ok: true, result: `${NIL_PERSISTENCE_NOTE} (拟写 peer=${peer} scope=${scope}，长度 ${content.length} 字符)` };
  }
  const { baseDir, sessionId, objectId: selfId } = ref;

  if (scope === "session") {
    try {
      await writeFlowRelation({ baseDir, sessionId, objectId: selfId, stonesBranch: ref.stonesBranch }, peer, content);
    } catch (error) {
      return { ok: false, error: `[relation_note] session 写入失败: ${(error as Error).message}` };
    }
    return {
      ok: true,
      result: `已更新 session 层 relation: flows/${sessionId}/objects/${selfId}/knowledge/relations/${peer}.md`,
    };
  }

  // scope === "long_term"：window-free deliverMessage 派 super（L5c 已落地）。
  const thread = ctx.thread;
  if (!thread) return { ok: false, error: "[relation_note] 缺少 thread context，无法派送 long_term 更新。" };

  // 复用既有 super 会话路由（talks.json["super"]）的 conversationId/targetThreadId，保持 super 会话连贯。
  let superRoute: { targetThreadId?: string; conversationId?: string } = {};
  try {
    const routing = await readTalks({ baseDir, sessionId, objectId: selfId, stonesBranch: ref.stonesBranch });
    const r = routing[SUPER_ALIAS_TARGET];
    if (r) superRoute = { targetThreadId: r.targetThreadId, conversationId: r.conversationId };
  } catch {
    /* 路由读失败时按首条消息处理（deliverMessage 自行生成 conversationId）。 */
  }

  const composed =
    `请把我对 \`${peer}\` 的长期 relation（pools/${selfId}/knowledge/relations/${peer}.md）` +
    `更新为以下内容（整文件替换）:\n\n---\n${content}\n---`;

  try {
    const result = await deliverMessage({
      thread,
      target: SUPER_ALIAS_TARGET,
      conversationId: superRoute.conversationId,
      targetThreadId: superRoute.targetThreadId,
      content: composed,
      source: "talk",
    });
    return {
      ok: true,
      result: `已派送 long_term relation 更新请求到 super flow（callee thread: ${result.calleeThreadId}）。super 会写入 pools/${selfId}/knowledge/relations/${peer}.md。`,
    };
  } catch (error) {
    return { ok: false, error: `[relation_note] long_term 派送失败: ${(error as Error).message}` };
  }
}
