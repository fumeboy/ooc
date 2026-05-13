import type { ThreadContext } from "../../thinkable/context.js";
import type { LlmTool } from "../../thinkable/llm/types.js";
import { getOpenableCommands } from "../commands/index.js";
import { FormManager } from "../forms/form.js";
import { enrichProgramForm } from "../server/enrich.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

const PATH_PARAM = {
  type: "string",
  minLength: 1,
  description: "文件或 knowledge 路径。type=file/knowledge 时必须通过 args.path 提供，不能只写在 description 中。"
};

const WINDOW_ARGS_SCHEMA = {
  type: "object",
  properties: {
    path: PATH_PARAM,
    lines: {
      type: "array",
      items: { type: "number" },
      description: "可选行范围，例如 [0, 200]。"
    },
    columns: {
      type: "array",
      items: { type: "number" },
      description: "可选列范围，例如 [0, 120]。"
    }
  },
  required: ["path"]
};

/** open tool - 开始行动，或把 knowledge/file 显式放入 Context。 */
export const OPEN_TOOL: LlmTool = {
  name: "open",
  description: "开始一次行动，或把 knowledge/file 放入 Context。type=command 只负责创建 form；业务参数必须放在 args，或后续通过 refine(args={...}) 补充。type=knowledge/file 不产生 form，且必须传 args.path。",
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
        description: "command 的业务参数；type=file/knowledge 时必须包含 args.path。",
        properties: {
          path: PATH_PARAM,
          lines: WINDOW_ARGS_SCHEMA.properties.lines,
          columns: WINDOW_ARGS_SCHEMA.properties.columns
        }
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

function successOutput(message: string) {
  return JSON.stringify({ ok: true, tool: "open", message });
}

function errorOutput(error: string) {
  return JSON.stringify({ ok: false, tool: "open", error });
}

function getRequiredPath(openType: string, nestedArgs: Record<string, unknown>): string | undefined {
  const path = nestedArgs.path;
  if (typeof path === "string" && path.trim()) {
    return path.trim();
  }
  return undefined;
}

/** 执行 open tool：command 创建 form，knowledge/file 只打开 context 窗口。 */
export async function handleOpenTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<string | void> {
  const openType = args.type as string;
  const description = (args.description as string | undefined) ?? "";
  const nestedArgs = getArgs(args);
  const formManager = FormManager.fromData(thread.activeForms ?? []);

  if (openType === "command") {
    const command = args.command as string;
    const formId = formManager.open(command, description);
    formManager.refine(formId, nestedArgs);
    let snapshot = formManager.toData();
    // 若 form 是 program command + function 模式，自动加载方法签名供下一轮 LLM 看见
    const target = snapshot.find((f) => f.formId === formId);
    if (target) {
      const enriched = await enrichProgramForm(target, thread);
      if (enriched !== target) {
        snapshot = snapshot.map((f) => (f.formId === formId ? enriched : f));
      }
    }
    thread.activeForms = snapshot;
    return successOutput(`Form ${formId} 已创建（${command}）。后续请用 refine / submit / close 引用该 form_id。`);
  }

  if (openType === "knowledge") {
    const path = getRequiredPath(openType, nestedArgs);
    if (!path) {
      return errorOutput(`open(type="${openType}") 缺少 args.path 参数。`);
    }
    thread.activeForms = thread.activeForms ?? [];
    // 写入 pinnedKnowledge 即可——activator 每轮 lazy 派生当前激活集合，不再需要 activatedKnowledge 字段。
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
    return successOutput(`Knowledge ${path} 已进入 Context 并固定。`);
  }

  if (openType === "file") {
    const path = getRequiredPath(openType, nestedArgs);
    if (!path) {
      return errorOutput(`open(type="${openType}") 缺少 args.path 参数。`);
    }
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
    return successOutput(`File ${path} 已进入 Context。`);
  }

  return errorOutput(`open 不支持 type="${openType}"。`);
}
