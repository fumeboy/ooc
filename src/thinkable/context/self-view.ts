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
import { readPlan, readTodos, type Todo } from "../../persistable/index";
import { xmlElement, xmlText, type XmlNode } from "./xml";
import type { ThreadContext, ThreadMessage } from "./index";

/** talk 自视切片每个 peer 渲染的最近消息条数。 */
const TALK_RECENT_PER_PEER = 6;
/** talk 自视切片单条消息正文截断长度。 */
const TALK_MESSAGE_TRUNCATE = 400;

/**
 * 渲染对象自视切片 `<self_view>`；无 persistence 或无内容时返回 null。
 *
 * 段序（L5c）：`<plan>`（active 行动计划）→ `<talks>`（按 peer 的进行中会话）→ `<todos>`（未完成待办）。
 */
export async function renderSelfView(thread: ThreadContext): Promise<XmlNode | null> {
  const ref = flowRefOf(thread);
  if (!ref) return null;

  const children: XmlNode[] = [];

  const planNode = await renderPlanSlice(ref);
  if (planNode) children.push(planNode);

  const talksNode = renderTalksSlice(thread);
  if (talksNode) children.push(talksNode);

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
