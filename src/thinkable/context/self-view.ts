/**
 * 自视切片（self-view slice）—— ContextBuilder 每轮从 owner flow 文件渲染对象的自视状态。
 *
 * 设计（spec docs/superpowers/specs/2026-05-31-ooc-4-L5-6-bclass-collapse-design.md §2）：
 * - B 类（todo / plan / talk / ...）塌缩后不再是 thread.contextWindows 里的 window；
 *   它们落成 owner flow 文件（todos.json / plan.md / talks/...），ContextBuilder 每轮
 *   额外读这些文件渲染成 `<self_view>` 段，与 A 类 window 区并列。
 * - `<self_view>` 是 `<context>` 的直接 child，插在 `<self>` 之后、`<thread>` 之前。
 * - L5a 只渲 todos 段；L5b/c 往这里加 plan / talk 段（机制复用）。
 *
 * nil-persistence（无 objectId）：无文件路径可读 → 返回 null（in-memory 测试模式）。
 * 无任何自视内容（如无未完成 todo）：返回 null，保持 context 紧凑。
 */

import type { FlowObjectRef } from "../../persistable/common";
import { readTodos, type Todo } from "../../persistable/index";
import { xmlElement, xmlText, type XmlNode } from "./xml";
import type { ThreadContext } from "./index";

/**
 * 渲染对象自视切片 `<self_view>`；无 persistence 或无内容时返回 null。
 *
 * 当前（L5a）只含 todos 段：未完成待办列表。
 */
export async function renderSelfView(thread: ThreadContext): Promise<XmlNode | null> {
  const ref = flowRefOf(thread);
  if (!ref) return null;

  const children: XmlNode[] = [];

  const todosNode = await renderTodosSlice(ref);
  if (todosNode) children.push(todosNode);

  if (children.length === 0) return null;
  return xmlElement("self_view", {}, children);
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
