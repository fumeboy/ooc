import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, renderPathList, appendNode, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import type { CommandExecWindow } from "./types.js";

/** command_exec window 的 readable hook：accumulated_args / paths / result。 */
export function readable(ctx: RenderContext): XmlNode[] {
  const form = ctx.window as CommandExecWindow;
  const children: XmlNode[] = [
    xmlElement("command", {}, [xmlText(form.command)]),
    xmlElement("description", {}, [xmlText(form.description)]),
    xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(form.accumulatedArgs))]),
  ];
  appendNode(children, renderPathList("command_paths", form.commandPaths));
  appendNode(children, renderPathList("loaded_knowledge", form.loadedKnowledgePaths));
  appendNode(children, renderPathList("command_knowledge_paths", form.commandKnowledgePaths));
  // Round 13: 仅 failed 状态保留 result 渲染 (success 已自动移除; open/executing 无 result)
  if (form.status === "failed" && form.result) {
    children.push(xmlElement("result", {}, [xmlText(form.result)]));
  }
  return children;
}
