/**
 * todo_window — 由 root.todo command 一步直建的可见待办。
 *
 * - 没有 LLM 可调用的 command；唯一动作是 close（待办完成）
 * - onClose 无副作用，window 直接释放
 * - 渲染显示 content 与 onCommandPath
 */

import { registerWindowType, type RenderContext } from "../_shared/registry.js";
import { xmlElement, xmlText, renderPathList, type XmlNode } from "../../../thinkable/context/xml.js";
import type { TodoWindow } from "./types.js";

/** todo_window 的 renderXml hook：content + on_command_path。 */
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

registerWindowType("todo", {
  // commands 留空：todo 没有可被 LLM 进一步调用的动作
  commands: {},
  renderXml: renderTodoWindow,
  // onClose 无副作用：window 释放即完成
});
