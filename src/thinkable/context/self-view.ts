/**
 * 自视切片（self-view slice）—— ContextBuilder 每轮从 owner flow 文件渲染对象的自视状态。
 *
 * 设计（spec docs/superpowers/specs/2026-05-31-ooc-4-L5-6-bclass-collapse-design.md §2）：
 * - B 类（todo / plan / talk / ...）塌缩后不再是 thread.contextWindows 里的 window；
 *   它们落成 owner flow 文件（todos.json / plan.md / talks.json）或经会话历史（inbox/outbox）渲染，
 *   ContextBuilder 每轮额外读这些渲染成 `<self_view>` 段，与 A 类 window 区并列。
 * - `<self_view>` 是 `<context>` 的直接 child，插在 `<self>` 之后、`<thread>` 之前。
 * - L5a 渲 todos 段；L5b 加 plan 段；L5c 加 talk 段（按 peer 分组的最近会话）。
 *   段序：plan 置顶（当前在执行什么）→ talks（与谁在会话）→ todos（待办）。
 *
 * nil-persistence（无 objectId）：无文件路径可读 → 返回 null（in-memory 测试模式）。
 * 无任何自视内容（如无 active plan、无未完成 todo、无进行中会话）：返回 null，保持 context 紧凑。
 */

import type { FlowObjectRef } from "../../persistable/common";
import {
  readPlan,
  readTodos,
  readTalks,
  discoverStoneHierarchicalPeers,
  deriveStoneFromThread,
  readReadable,
  readableFile,
  readPoolRelation,
  readFlowRelation,
  type Todo,
} from "../../persistable/index";
import { SUPER_ALIAS_TARGET } from "../../executable/windows/_shared/super-constants";
import { xmlElement, xmlText, type XmlNode } from "./xml";
import type { ThreadContext, ThreadMessage } from "./index";

/** talk 自视切片每个 peer 渲染的最近消息条数。 */
const TALK_RECENT_PER_PEER = 6;
/** talk 自视切片单条消息正文截断长度。 */
const TALK_MESSAGE_TRUNCATE = 400;
/** relations 自视切片各文本字段（peer readable / self relation）的字节截断长度。 */
const RELATION_BODY_BYTES = 8192;

/**
 * 渲染对象自视切片 `<self_view>`；无 persistence 或无内容时返回 null。
 *
 * 段序（L6a）：`<plan>`（active 行动计划）→ `<talks>`（按 peer 的进行中会话）→
 * `<relations>`（siblings/children + talk peer 的关系认知）→ `<todos>`（未完成待办）。
 */
export async function renderSelfView(thread: ThreadContext): Promise<XmlNode | null> {
  const ref = flowRefOf(thread);
  if (!ref) return null;

  const children: XmlNode[] = [];

  const planNode = await renderPlanSlice(ref);
  if (planNode) children.push(planNode);

  const talksNode = renderTalksSlice(thread);
  if (talksNode) children.push(talksNode);

  const relationsNode = await renderRelationsSlice(thread, ref);
  if (relationsNode) children.push(relationsNode);

  const todosNode = await renderTodosSlice(ref);
  if (todosNode) children.push(todosNode);

  if (children.length === 0) return null;
  return xmlElement("self_view", {}, children);
}

/**
 * active 行动计划（plan.md）渲染成 `<plan>...markdown...</plan>`。
 * plan.md 不存在 / 空白 → 不渲该段（返回 null）。
 */
async function renderPlanSlice(ref: FlowObjectRef): Promise<XmlNode | null> {
  const md = await readPlan(ref);
  if (md.trim().length === 0) return null;
  return xmlElement("plan", {}, [xmlText(md)]);
}

/**
 * relations 自视切片 `<relations>`：自动注入 self 对身边各 peer 的关系认知。
 *
 * 设计（spec §5.3，L6a：relation_window 删除 → 自动注入）：
 * - peer 集 = `discoverStoneHierarchicalPeers`（同级 siblings + 一级 children Agent）
 *   **∪ talks.json peers**（`Object.keys(readTalks)`，含 user / critic 等 talk peer）。
 *   含 talk peers 才不丢「与非 sibling/child 的 talk peer 的 relation 展示」。
 * - 每 peer 渲染（移自旧 deriveRelationWindow + renderRelationWindow）：
 *   - `peer_readme`：peer 的 `stones/<branch>/objects/<peer>/readable.md`（exists 且非空才渲，截断）。
 *   - `self_long_term`：`pools/<self>/knowledge/relations/<peer>.md`（exists 才渲）。
 *   - `self_session`：`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`（exists 才渲）。
 * - super alias（"super"）跳过；self 自身跳过。
 * - 无任何 peer → 返回 null（不渲 `<relations>`，保持 context 紧凑）。
 * - IO 异常静默（console.debug），不让一次磁盘抖动拖垮热路径。
 *
 * 写侧（self 对 peer 的关系认知）由 root.relation_note（command.relation.ts）落盘。
 */
async function renderRelationsSlice(
  thread: ThreadContext,
  ref: FlowObjectRef,
): Promise<XmlNode | null> {
  const { baseDir, sessionId, objectId: selfId } = ref;

  // 1) peer 集：hierarchical siblings/children ∪ talks.json peers。
  const peers = new Set<string>();

  // self 不是 user 时才扫层级 peer（user 是 passive flow object，无 stone 子树）。
  if (selfId !== "user") {
    try {
      const { siblings, children } = await discoverStoneHierarchicalPeers(
        deriveStoneFromThread({ baseDir, sessionId, objectId: selfId, threadId: thread.id, stonesBranch: ref.stonesBranch }),
      );
      for (const peer of [...siblings, ...children]) {
        if (peer && peer !== selfId) peers.add(peer);
      }
    } catch (err) {
      console.debug(`[relations] hierarchical peers io_error self=${selfId} msg=${(err as Error).message}`);
    }
  }

  // talks.json peers：含 user / critic 等会话过的 peer；super alias 不算关系 peer。
  try {
    const routing = await readTalks({ baseDir, sessionId, objectId: selfId, stonesBranch: ref.stonesBranch });
    for (const peer of Object.keys(routing)) {
      if (peer && peer !== selfId && peer !== SUPER_ALIAS_TARGET) peers.add(peer);
    }
  } catch (err) {
    console.debug(`[relations] talks routing io_error self=${selfId} msg=${(err as Error).message}`);
  }

  if (peers.size === 0) return null;

  // 2) 逐 peer 渲染（peerId 排序，稳定输出）。
  const relationNodes: XmlNode[] = [];
  for (const peerId of [...peers].sort()) {
    const node = await renderRelationPeer(baseDir, sessionId, selfId, peerId, ref.stonesBranch);
    relationNodes.push(node);
  }
  return xmlElement("relations", {}, relationNodes);
}

/** 渲染单个 peer 的 `<relation peer_id=...>`：peer_readme + self_long_term + self_session（exists 才渲）。 */
async function renderRelationPeer(
  baseDir: string,
  sessionId: string,
  selfId: string,
  peerId: string,
  stonesBranch?: string,
): Promise<XmlNode> {
  const children: XmlNode[] = [];

  // peer readable.md（对端身份介绍，只读）。
  const peerStoneRef = { baseDir, objectId: peerId, stonesBranch };
  try {
    const text = await readReadable(peerStoneRef);
    if (text !== undefined && text.trim() !== "") {
      children.push(
        xmlElement("peer_readme", { path: readableFile(peerStoneRef) }, [xmlText(truncateRelationBody(text))]),
      );
    }
  } catch (err) {
    console.debug(`[relations] peer_readme io_error ${peerId} msg=${(err as Error).message}`);
  }

  // self long_term relation（pools；跨 session 长期认知）。
  try {
    const text = await readPoolRelation({ baseDir, objectId: selfId }, peerId);
    if (text !== undefined) {
      children.push(
        xmlElement("self_long_term", { path: `pools/${selfId}/knowledge/relations/${peerId}.md` }, [
          xmlText(truncateRelationBody(text)),
        ]),
      );
    }
  } catch (err) {
    console.debug(`[relations] long_term io_error ${peerId} msg=${(err as Error).message}`);
  }

  // self session relation（flows；仅本 session 生效）。
  try {
    const text = await readFlowRelation({ baseDir, sessionId, objectId: selfId }, peerId);
    if (text !== undefined) {
      children.push(
        xmlElement(
          "self_session",
          { path: `flows/${sessionId}/objects/${selfId}/knowledge/relations/${peerId}.md` },
          [xmlText(truncateRelationBody(text))],
        ),
      );
    }
  } catch (err) {
    console.debug(`[relations] session io_error ${peerId} msg=${(err as Error).message}`);
  }

  return xmlElement("relation", { peer_id: peerId }, children);
}

/** relations 切片各文本字段的 8KB 截断（本地实现，避免反向 import render.ts）。 */
function truncateRelationBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= RELATION_BODY_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, RELATION_BODY_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

/** 从 thread.persistence 派生对象级 FlowObjectRef；缺 objectId 返回 undefined。 */
function flowRefOf(thread: ThreadContext): FlowObjectRef | undefined {
  const ref = thread.persistence;
  if (!ref?.objectId) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

/**
 * 未完成 todos 渲染成 `<todos><todo id done on_command_path>content</todo>...</todos>`。
 * 全部已完成（或无待办）→ 不渲该段（返回 null）。
 */
async function renderTodosSlice(ref: FlowObjectRef): Promise<XmlNode | null> {
  const todos = await readTodos(ref);
  const open = todos.filter((t) => !t.done);
  if (open.length === 0) return null;
  return xmlElement(
    "todos",
    {},
    open.map((t) => renderTodo(t)),
  );
}

function renderTodo(t: Todo): XmlNode {
  const attrs: Record<string, string> = { id: t.id, done: String(t.done) };
  if (t.onCommandPath && t.onCommandPath.length > 0) {
    attrs.on_command_path = t.onCommandPath.join(",");
  }
  return xmlElement("todo", attrs, [xmlText(t.content)]);
}

/**
 * talk 会话自视切片：从 inbox/outbox 收 talk 消息，按 peer（conversationId / peerObjectId）分组，
 * 每 peer 渲染最近若干条 → `<talks><conversation peer=...><message dir>content</message>...</conversation></talks>`。
 *
 * 数据源说明（spec L5c POST-DUAL-REVIEW §6/§9）：talks.json 是 routing-only（不存 message log），
 * 会话历史持久在 thread.inbox/outbox（不 drain）。故自视切片直接从 inbox/outbox 渲染——避免双写 + 渲染重复。
 *
 * - 仅取带 peerObjectId 的消息（window-free talk 派送写入）；缺该字段的旧消息（含 do/system）不入此切片。
 * - dir：消息在 inbox=incoming（peer→self），在 outbox=outgoing（self→peer）。
 * - 分组键优先 conversationId（同 peer 多会话不串话），缺省退化为 peerObjectId。
 * - 无任何 talk 消息 → 返回 null。
 */
export function renderTalksSlice(thread: ThreadContext): XmlNode | null {
  type Entry = { peer: string; conversationId?: string; dir: "incoming" | "outgoing"; m: ThreadMessage };
  const entries: Entry[] = [];
  for (const m of thread.outbox ?? []) {
    if (!m.peerObjectId) continue;
    entries.push({ peer: m.peerObjectId, conversationId: m.conversationId, dir: "outgoing", m });
  }
  for (const m of thread.inbox ?? []) {
    if (!m.peerObjectId) continue;
    entries.push({ peer: m.peerObjectId, conversationId: m.conversationId, dir: "incoming", m });
  }
  if (entries.length === 0) return null;

  // 分组：conversationId 优先，缺省回退 peerObjectId。保留每组的展示 peer 名。
  const groups = new Map<string, { peer: string; conversationId?: string; items: Entry[] }>();
  for (const e of entries) {
    const key = e.conversationId ?? `peer:${e.peer}`;
    let g = groups.get(key);
    if (!g) {
      g = { peer: e.peer, conversationId: e.conversationId, items: [] };
      groups.set(key, g);
    }
    g.items.push(e);
  }

  const conversations: XmlNode[] = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.m.createdAt - b.m.createdAt);
    const total = g.items.length;
    const recent = g.items.slice(-TALK_RECENT_PER_PEER);
    const attrs: Record<string, string> = { peer: g.peer, total: String(total) };
    if (g.conversationId) attrs.conversation_id = g.conversationId;
    const earlierOmitted = total - recent.length;
    if (earlierOmitted > 0) attrs.earlier_omitted = String(earlierOmitted);
    conversations.push(
      xmlElement(
        "conversation",
        attrs,
        recent.map((e) =>
          xmlElement("message", { id: e.m.id, dir: e.dir }, [
            xmlText(e.m.content.slice(0, TALK_MESSAGE_TRUNCATE)),
          ]),
        ),
      ),
    );
  }
  return xmlElement("talks", {}, conversations);
}
