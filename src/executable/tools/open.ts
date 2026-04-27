import type { ToolDefinition } from "../../thinkable/llm/client.js";
import { getOpenableCommands } from "../commands/index.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** open tool — 打开上下文 */
export const OPEN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "open",
    description: "打开一个上下文。type=command 加载指令知识；type=trait 加载 trait 知识；type=skill 加载 skill 内容；type=file 读取文件到上下文。可选 args 字段等价于 open 后立即 refine(args)。记得带 title 参数。",
    parameters: {
      type: "object",
      properties: {
        title: TITLE_PARAM,
        type: {
          type: "string",
          enum: ["command", "trait", "skill", "file"],
          description: "上下文类型",
        },
        command: {
          type: "string",
          enum: getOpenableCommands(),
          description: "指令名称（type=command 时必填）。可用指令由 COMMAND_TABLE 注册表动态生成。",
        },
        name: {
          type: "string",
          description: "trait 完整路径（type=trait 时必填）或 skill 名称（type=skill 时必填）",
        },
        path: {
          type: "string",
          description: "文件路径（type=file 时必填）。支持三种形式：\n- 普通相对路径（相对项目根目录）：如 `docs/哲学文档/gene.md`\n- 虚拟路径 `@trait:<ns>/<name>`：读某个 trait 的 TRAIT.md（ns = kernel / library / self）。例：`@trait:kernel/talkable`\n- 虚拟路径 `@relation:<peer>`：读当前对象与对方的关系文件。例：`@relation:supervisor`",
        },
        lines: {
          type: "number",
          description: "读取行数限制（type=file 时可选，不填则读取全文）",
        },
        args: {
          type: "object",
          description: "可选预填参数。等价于 open 后立即 refine(args)。",
        },
        description: {
          type: "string",
          description: "要做什么",
        },
        trait: {
          type: "string",
          description: "program trait/method 时：目标 trait 完整路径",
        },
        method: {
          type: "string",
          description: "program trait/method 时：方法名",
        },
        mark: MARK_PARAM,
      },
      required: ["title", "type", "description"],
    },
  },
};
