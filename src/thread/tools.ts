/**
 * OOC Tool 定义（v2 — open/submit/close 三原语）
 *
 * 三个通用 tool 替代之前的 22 个 begin/submit tool：
 * - open: 打开上下文（加载指令相关 trait / 加载 trait 知识 / 加载 skill）
 * - submit: 提交执行（仅 command 类型）
 * - close: 关闭上下文（卸载知识 / 取消指令）
 *
 * 所有 tool 都支持可选的 mark 参数，用于主动标记 inbox 消息。
 */

import type { ToolDefinition } from "../thinkable/client.js";

/** mark 参数的 JSON Schema（三个 tool 共用） */
const MARK_PARAM = {
  type: "array",
  description: "标记 inbox 消息。可在任何 tool 调用时附带。",
  items: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "inbox 消息 ID" },
      type: { type: "string", enum: ["ack", "ignore", "todo"], description: "标记类型" },
      tip: { type: "string", description: "标记说明" },
    },
    required: ["messageId", "type", "tip"],
  },
} as const;

/** open tool — 打开上下文 */
export const OPEN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "open",
    description: "打开一个上下文。type=command 时加载指令相关知识；type=trait 时加载 trait 知识；type=skill 时加载 skill 内容。",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["command", "trait", "skill"],
          description: "上下文类型",
        },
        command: {
          type: "string",
          enum: ["program", "talk", "talk_sync", "return", "create_sub_thread", "continue_sub_thread", "call_function", "set_plan", "await", "await_all"],
          description: "指令名称（type=command 时必填）",
        },
        name: {
          type: "string",
          description: "trait 完整路径（type=trait 时必填）或 skill 名称（type=skill 时必填）",
        },
        description: {
          type: "string",
          description: "要做什么",
        },
        /* call_function 专用 */
        trait: {
          type: "string",
          description: "call_function 时：目标 trait 完整路径",
        },
        function_name: {
          type: "string",
          description: "call_function 时：方法名",
        },
        mark: MARK_PARAM,
      },
      required: ["type", "description"],
    },
  },
};

/** submit tool — 提交执行（仅 command 类型） */
export const SUBMIT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit",
    description: "提交指令执行。必须先 open 获取 form_id。",
    parameters: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "open 返回的 form_id",
        },
        /* program */
        code: { type: "string", description: "program: JavaScript 代码" },
        lang: { type: "string", enum: ["javascript", "shell"], description: "program: 语言" },
        /* talk / talk_sync */
        target: { type: "string", description: "talk: 目标对象名" },
        message: { type: "string", description: "talk/continue_sub_thread: 消息内容" },
        /* return */
        summary: { type: "string", description: "return: 完成摘要" },
        /* create_sub_thread */
        title: { type: "string", description: "create_sub_thread: 子线程标题" },
        /* set_plan */
        text: { type: "string", description: "set_plan: 计划内容" },
        /* await */
        thread_id: { type: "string", description: "await/continue_sub_thread: 线程 ID" },
        thread_ids: { type: "array", items: { type: "string" }, description: "await_all: 线程 ID 列表" },
        /* call_function */
        args: { type: "object", description: "call_function: 方法参数" },
        /* create_sub_thread 额外 */
        traits: { type: "array", items: { type: "string" }, description: "create_sub_thread: trait 列表" },
        mark: MARK_PARAM,
      },
      required: ["form_id"],
    },
  },
};

/** close tool — 关闭上下文 */
export const CLOSE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "close",
    description: "关闭一个已打开的上下文。command 类型等同于取消指令，trait/skill 类型等同于卸载知识。",
    parameters: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "open 返回的 form_id",
        },
        mark: MARK_PARAM,
      },
      required: ["form_id"],
    },
  },
};

/** 所有 OOC tools */
export const OOC_TOOLS: ToolDefinition[] = [OPEN_TOOL, SUBMIT_TOOL, CLOSE_TOOL];

/**
 * 构建可用 tools 列表
 *
 * 始终返回三个 tool（open/submit/close）。
 * submit 和 close 只在有活跃 form 时才有意义，但始终提供（LLM 自行判断）。
 */
export function buildAvailableTools(_activeCommands?: Set<string>): ToolDefinition[] {
  return OOC_TOOLS;
}
