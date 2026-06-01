/**
 * command_exec window — form lifecycle 的 LLM 视角统一抽象。
 *
 * 注册的 commands：
 * - refine：累积参数到 form.accumulatedArgs，重算 commandPaths
 * - submit：触发 form.command 真正执行
 *
 * basicKnowledge 在每轮"thread.contextWindows 出现至少一个 command_exec form"时
 * 自动作为 protocol KnowledgeWindow 注入到 LLM context，告诉 LLM 如何推进 form。
 */

import { registerObjectType, type RenderContext } from "../_shared/registry.js";
import { refineCommand } from "../../../executable/windows/command_exec/command.refine.js";
import { submitCommand } from "../../../executable/windows/command_exec/command.submit.js";
import { xmlElement, xmlText, renderPathList, appendNode, type XmlNode } from "../../../thinkable/context/xml.js";
import type { CommandExecWindow } from "./types.js";

const COMMAND_EXEC_BASIC_KNOWLEDGE = `
command_exec form 是 LLM 调用某个 command 时的临时 sub-window。两条命令推进它：

| command | 作用 | 调用形态 |
|---------|------|----------|
| refine  | 累积/覆盖 form 的业务参数         | exec(window_id="<form_id>", command="refine", args={ <键值对> }) |
| submit  | 触发 form.command 真正执行       | exec(window_id="<form_id>", command="submit") |

**form 状态机 (Round 13)**: \`open → executing → success | failed\`

- **open**: 可继续 refine 或 submit
- **executing**: 短暂; 不要做动作
- **success**: 成功; 系统自动从 contextWindows 移除 (你下一轮看不到)
- **failed**: 失败; result 含错误; **可以 refine 修回 open 状态再 submit** (推荐路径)

**典型推进过程**：
1. exec(command="<X>", title="...", args={...}) → 若 args 不齐全，系统创建一个 form
2. exec(window_id=<form_id>, command="refine", args={ <补充键值对> }) → 累积参数
3. exec(window_id=<form_id>, command="submit") → 执行；success 自动释放, failed 保留 result

**failed 状态修复路径 (首选)**：
- exec(window_id=<form_id>, command="refine", args={ <修正参数> }) → form 自动切回 open + 清旧 result
- exec(window_id=<form_id>, command="submit") → 重新执行

**关键提醒**：
- exec 在 args 齐全时会立即执行（不创建 form）；只有需要多步填参时才会落到 form
- close 仍可用 (彻底放弃此次调用), 但不再是失败修复的首选 — refine-from-failed 保留 form 上下文 (knowledge / commandPaths / form id)
`.trim();

/** command_exec window 的 renderXml hook：accumulated_args / paths / result。 */
function renderCommandExec(ctx: RenderContext): XmlNode[] {
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

registerObjectType("command_exec", {
  commands: {
    refine: refineCommand,
    submit: submitCommand,
  },
  renderXml: renderCommandExec,
  basicKnowledge: COMMAND_EXEC_BASIC_KNOWLEDGE,
});
