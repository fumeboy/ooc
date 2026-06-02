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

import { registerObjectType } from "@ooc/core/extendable/_shared/registry.js";
import { refineCommand } from "./command.refine.js";
import { submitCommand } from "./command.submit.js";
import { readable } from "../readable.js";

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

/** command_exec window 的 renderXml hook 已迁出到 ../readable.ts。 */

registerObjectType("command_exec", {
  commands: {
    refine: refineCommand,
    submit: submitCommand,
  },
  readable,
  basicKnowledge: COMMAND_EXEC_BASIC_KNOWLEDGE,
  // P6.§6: command_exec form 是 method 调用过程的临时载体（Object 内置特性）—— 不写独立 dir，
  //         状态 inline 进所属 thread 的 context.json。§9 将进一步搬迁到 core/method_exec/。
  isBuiltinFeature: true,
});
