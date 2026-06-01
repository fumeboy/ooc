import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Command exec form — 调用某 command 时的临时 sub-window。
 *
 * 替代旧 ActiveForm 概念；字段与 ActiveForm 一一对应。
 *
 * plan §exec 升级后：
 * - 由 `exec` tool 在 args 不齐全 / 引入新 path/knowledge 时创建
 * - 自身注册了两条命令 `refine` / `submit`，LLM 通过
 *   \`exec(<form_id>, "refine", args={...})\` 累加参数；
 *   \`exec(<form_id>, "submit")\` 触发执行
 * - 状态过渡：open → executing → success | failed
 *   - success：自动从 contextWindows 移除（spec § submit 段）
 *   - failed：保留 result，且可通过 refine 回 open（"复活"路径，Round 13 新增）
 * - parentWindowId 是该 command 注册到的 window 的 id（root 命令时 = "root"；
 *   do_window 上的 continue 时 = 该 do_window 的 id）。
 */
export interface CommandExecWindow extends BaseContextWindow {
  type: "command_exec";
  parentWindowId: string;
  command: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  commandPaths: string[];
  loadedKnowledgePaths: string[];
  commandKnowledgePaths?: string[];
  status: "open" | "executing" | "success" | "failed";
  result?: string;
}
