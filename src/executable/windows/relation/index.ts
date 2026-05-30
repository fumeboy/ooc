/**
 * relation_window — peer 关系的专属 window type 与 edit 命令面。
 *
 * 设计依据:plan witty-bubbling-pebble.md / spec 2026-05-20 relation-window-design。
 *
 * 注册的 command:
 * - edit:整文件替换语义,通过 scope 路由到 session 层(flow) 或 long_term 层(super flow)
 *
 * 不注册 close hook:relation_window 是每轮 derive 出来的,不持久化;LLM 显式 close
 * 没有意义(下一轮 derive 又会回来)。如果 LLM 误 close,通用 close 原语直接从
 * thread.contextWindows 移除,下一轮 derive 重新挂回。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import { registerWindowType, type RenderContext } from "../_shared/registry.js";
import { writeFlowRelation } from "../../../persistable/index.js";
import { deliverTalkMessage } from "../talk/delivery.js";
import { SUPER_ALIAS_TARGET } from "../_shared/super-constants.js";
import { generateWindowId, type TalkWindow } from "../_shared/types.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import type { RelationWindow } from "./types.js";

const RELATION_EDIT_BASIC = "internal/windows/relation/edit/basic";
const RELATION_EDIT_INPUT = "internal/windows/relation/edit/input";
const RELATION_EDIT_LONGTERM = "internal/windows/relation/edit/long_term_detail";

/** relation_window 的 type-level basicKnowledge。 */
const RELATION_WINDOW_BASIC_KNOWLEDGE = `
relation_window 是 self 对某 peer object 的关系窗口,自动按 thread 中存在的
talk_window(target=peerId) 派生一条,id 稳定为 \`w_rel_<peerId>\`。它注册的 method 不在
root 上,要通过 open(parent_window_id="<rel_window_id>", method="edit", args={...}) 调用:

| method | 作用 | 典型用法 |
|--------|------|----------|
| edit    | 整文件替换 relation 文件;scope 决定写 session 层还是 long_term 层 | open(parent_window_id="<rel_window_id>", method="edit", args={ content: "...", scope: "session" }) |

**两个 scope**:
- **session**:写 \`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md\`——只在
  本 session 生效,不污染长期认知。适合"本次 talk 暴露出来、对该 peer 的临时偏好/约定"。
- **long_term**:派一条 talk message 给 super flow,由 super 写
  \`pools/<self>/knowledge/relations/<peer>.md\`——跨 session 长期生效。适合"形成了
  对该 peer 稳定的合作模式/偏好/认知,值得固化"。

**重要**:
- edit 是**整文件替换语义**(与 write_file 一致),不支持 patch / append。content 写完整文件正文。
- 同一 relation_window 可以重复 edit;每次 edit 后下一轮 derive 时 KnowledgeWindow body 会反映新内容。
- 想看当前 relation 内容,看伴随的 knowledge_window(同 peerId,source=relation,body 含 long_term 与 session 两段)。
`.trim();

const EDIT_KNOWLEDGE = `
relation_window.edit 用于更新本 relation_window 对应 peer 的 relation 文件。

参数:
- content: 必填,relation 文件完整正文(整文件替换语义,非 patch/append)
- scope:   必填,'session' | 'long_term'
  - session:   写 flows/<sid>/objects/<self>/knowledge/relations/<peer>.md(仅本 session 生效)
  - long_term: 派一条 talk message 给 super flow,由 super 写 pools/<self>/knowledge/relations/<peer>.md(跨 session 长期生效)

典型用法(一步到位,args 齐时 open 立即提交):

  // 本 session 临时记下"该 peer 偏好简短回复"
  open(parent_window_id="<rel_window_id>", method="edit",
       args={ content: "## 偏好\\n- 简短回复\\n- 不要 emoji", scope: "session" })

  // 把本次形成的稳定合作模式固化到长期 relation
  open(parent_window_id="<rel_window_id>", method="edit",
       args={ content: "...完整正文...", scope: "long_term" })
`.trim();

const EDIT_LONGTERM_DETAIL = `
scope="long_term" 的路径详解:

1. 本调用不直接写 relation 文件——它会派一条 talk message 到 super flow(self-reflection 分身);
2. super flow 会作为另一个 thread 收到这条消息,自行决定如何处理(典型:用 write_file 写 pools/<self>/knowledge/relations/<peer>.md);
3. 因此 long_term edit 是**异步**的:本 method 返回成功只代表消息已派送,文件落盘要等 super flow 跑完那一轮。
`.trim();

const editCommand: MethodEntry = {
  paths: ["edit", "edit.session", "edit.long_term"],
  match: (args) => {
    const scope = args.scope;
    if (scope === "session") return ["edit", "edit.session"];
    if (scope === "long_term") return ["edit", "edit.long_term"];
    return ["edit"];
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [RELATION_EDIT_BASIC]: EDIT_KNOWLEDGE };
    if (args.scope === "long_term") {
      entries[RELATION_EDIT_LONGTERM] = EDIT_LONGTERM_DETAIL;
    }
    if (formStatus !== "open") return entries;
    const missing: string[] = [];
    if (typeof args.content !== "string" || args.content.length === 0) missing.push("content");
    if (args.scope !== "session" && args.scope !== "long_term") missing.push("scope");
    if (missing.length > 0) {
      entries[RELATION_EDIT_INPUT] =
        `relation_window.edit 需要 ${missing.join(" + ")};用 refine(args={ content: "...", scope: "session" | "long_term" })。`;
    }
    return entries;
  },
  exec: (ctx) => executeRelationEdit(ctx),
};

export async function executeRelationEdit(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[relation.edit] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "relation") {
    return "[relation.edit] 未挂载在 relation_window 上。";
  }
  if (!thread.persistence) {
    return "[relation.edit] 当前 thread 无 persistence,无法写入。";
  }

  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (content.length === 0) return "[relation.edit] 缺少 content(整文件正文)。";

  const scope = ctx.args.scope;
  if (scope !== "session" && scope !== "long_term") {
    return `[relation.edit] scope 必填且只能是 'session' | 'long_term',收到 ${JSON.stringify(scope)}。`;
  }

  const peerId = window.peerId;
  if (!peerId) return "[relation.edit] relation_window 缺少 peerId。";

  const { baseDir, sessionId, objectId: selfId } = thread.persistence;

  if (scope === "session") {
    try {
      await writeFlowRelation({ baseDir, sessionId, objectId: selfId }, peerId, content);
    } catch (error) {
      return `[relation.edit] session 写入失败: ${(error as Error).message}`;
    }
    return `[relation.edit] 已更新 session 层 relation: flows/${sessionId}/objects/${selfId}/knowledge/relations/${peerId}.md`;
  }

  // scope === "long_term":派 super flow
  // 1) 优先复用已有 super talk_window
  const existingSuperTalk = (thread.contextWindows ?? []).find(
    (w): w is TalkWindow => w.type === "talk" && w.target === SUPER_ALIAS_TARGET,
  );
  // 2) 没有则构造一个临时 TalkWindow,不挂到 thread.contextWindows(避免常驻通道)
  const talkWindow: TalkWindow = existingSuperTalk ?? {
    id: `w_rel_super_tmp_${generateWindowId("talk").slice("w_talk_".length)}`,
    type: "talk",
    parentWindowId: "root",
    title: `relation update for ${peerId}`,
    status: "open",
    createdAt: Date.now(),
    target: SUPER_ALIAS_TARGET,
    conversationId: "",
  };
  // conversationId 用 id 兜底(临时 window 也要保持 == 关系)
  if (!talkWindow.conversationId) talkWindow.conversationId = talkWindow.id;

  const composed =
    `请把我对 \`${peerId}\` 的长期 relation(pools/${selfId}/knowledge/relations/${peerId}.md)` +
    `更新为以下内容(整文件替换):\n\n---\n${content}\n---`;

  try {
    const result = await deliverTalkMessage({
      caller: { thread, talkWindow },
      content: composed,
      source: "talk",
    });
    return `[relation.edit] 已派送 long_term relation 更新请求到 super flow(callee thread: ${result.calleeThreadId})。super 会写入 pools/${selfId}/knowledge/relations/${peerId}.md。`;
  } catch (error) {
    return `[relation.edit] long_term 派送失败: ${(error as Error).message}`;
  }
}

/**
 * relation_window 的 renderXml hook：peer_id + peer_readme + self long_term/session。
 *
 * 2026-05-27 修订:
 * - 撤回 R8-5 的 peer_readme 删除决定:default visibility 让大量 sibling/child relation
 *   自动派生,不带 peer 身份介绍则空壳,违背初衷;peer_readme 重新挂回。
 * - 文件缺失节点时不再渲染占位文案("(暂无;通过 open(...) 写入)"):节点本身缺席就是
 *   信号,占位文案对 LLM 是噪声,不需要主动指引(basicKnowledge 已经讲清楚 edit 用法)。
 *   exists=false 时直接跳过该节点;exists=true 才输出节点。
 */
function renderRelationWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as RelationWindow;
  const children: XmlNode[] = [
    xmlElement("peer_id", {}, [xmlText(window.peerId)]),
  ];

  if (window.peerReadmeExists && window.peerReadmeBody !== undefined) {
    children.push(
      xmlElement("peer_readme", { path: window.peerReadmePath }, [xmlText(window.peerReadmeBody)]),
    );
  }

  if (window.selfLongTermExists && window.selfLongTermBody !== undefined) {
    children.push(
      xmlElement("self_long_term", { path: window.selfLongTermPath }, [xmlText(window.selfLongTermBody)]),
    );
  }

  if (window.selfSessionExists && window.selfSessionBody !== undefined) {
    children.push(
      xmlElement("self_session", { path: window.selfSessionPath }, [xmlText(window.selfSessionBody)]),
    );
  }

  return children;
}

registerWindowType("relation", {
  methods: {
    edit: editCommand,
  },
  renderXml: renderRelationWindow,
  basicKnowledge: RELATION_WINDOW_BASIC_KNOWLEDGE,
});

export { RELATION_WINDOW_BASIC_KNOWLEDGE };
