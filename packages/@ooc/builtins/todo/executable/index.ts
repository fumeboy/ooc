/**
 * todo_object — 由 root.todo command 一步直建的可见待办。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object。
 *
 * - 没有 LLM 可调用的 method；唯一动作是 close（待办完成）
 * - onClose 无副作用，window 直接释放
 * - 渲染显示 content 与 onCommandPath
 */

import { registerObjectType, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, renderPathList, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import type { TodoWindow } from "../types.js";

/** todo_object 的 renderXml hook：content + on_command_path。 */
function renderTodoWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as TodoWindow;
  const children: XmlNode[] = [
    xmlElement("content", {}, [xmlText(window.content)]),
  ];
  if (window.onCommandPath && window.onCommandPath.length > 0) {
    children.push(renderPathList("on_command_path", window.onCommandPath)!);
  }
  return children;
}

registerObjectType("todo", {
  // commands 留空：todo 没有可被 LLM 进一步调用的动作
  commands: {},
  renderXml: renderTodoWindow,
  // onClose 无副作用：window 释放即完成
});
