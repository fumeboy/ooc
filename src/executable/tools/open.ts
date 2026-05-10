import type { ThreadContext } from "../../thinkable/context.js";
import type { LlmTool } from "../../thinkable/llm/types.js";
import { getOpenableCommands } from "../commands/index.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** open tool - 开始行动，或把 knowledge/file 显式放入 Context。 */
export const OPEN_TOOL: LlmTool = {
  name: "open",
  description: "开始一次行动，或把 knowledge/file 放入 Context。type=command 会产生 form；type=knowledge/file 不产生 form。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      type: {
        type: "string",
        enum: ["command", "knowledge", "file"],
        description: "open 分支类型：command/knowledge/file"
      },
      command: {
        type: "string",
        enum: getOpenableCommands(),
        description: "目标 command 名，仅 type=command 时使用。"
      },
      description: {
        type: "string",
        description: "本次 open 的意图说明。"
      },
      args: {
        type: "object",
        description: "可选，允许为空，如果不确定参数可以稍后再通过 refine 补充参数"
      },
      mark: MARK_PARAM
    },
    required: ["type", "description"]
  }
};

/** 从 tool 参数中取出嵌套 args；非对象输入按空参数处理。 */
function getArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nested = args.args;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

/** 向字符串数组追加唯一值，用于 knowledge pin/activate 的幂等记录。 */
function pushUnique(target: string[] | undefined, value: string): string[] {
  const next = target ?? [];
  if (!next.includes(value)) next.push(value);
  return next;
}

/** 执行 open tool：command 创建 form，knowledge/file 只打开 context 窗口。 */
export async function handleOpenTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const openType = args.type as string;
  const description = (args.description as string | undefined) ?? "";
  const nestedArgs = getArgs(args);
  const formManager = FormManager.fromData(thread.activeForms ?? []);

  if (openType === "command") {
    const command = args.command as string;
    const formId = formManager.open(command, description);
    formManager.refine(formId, nestedArgs);
    thread.activeForms = formManager.toData();
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `Form ${formId} 已创建（${command}）。后续请用 refine / submit / close 引用该 form_id。`
    });
    return;
  }

  if (openType === "knowledge") {
    const path = nestedArgs.path as string;
    thread.activeForms = thread.activeForms ?? [];
    thread.activatedKnowledge = pushUnique(thread.activatedKnowledge, path);
    thread.pinnedKnowledge = pushUnique(thread.pinnedKnowledge, path);
    thread.windows = {
      ...(thread.windows ?? {}),
      [path]: {
        type: "knowledge",
        path,
        description,
        lines: nestedArgs.lines,
        columns: nestedArgs.columns
      }
    };
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `Knowledge ${path} 已进入 Context 并固定。`
    });
    return;
  }

  if (openType === "file") {
    const path = nestedArgs.path as string;
    thread.activeForms = thread.activeForms ?? [];
    thread.windows = {
      ...(thread.windows ?? {}),
      [path]: {
        type: "file",
        path,
        description,
        lines: nestedArgs.lines,
        columns: nestedArgs.columns
      }
    };
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `File ${path} 已进入 Context。`
    });
  }
}
