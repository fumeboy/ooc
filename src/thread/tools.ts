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

/**
 * talk form 参数的 JSON Schema（submit(command=talk/talk_sync) 用）
 *
 * 可选字段。当发起方已经心里有几个候选回复选项时，用它包一份「结构化表单」投递
 * 给接收方——前端（user 收到消息时）会把它渲染为 option picker（编号选项 + 自由文本
 * 兜底），用户选择/输入后把 formResponse 回传给发起方。
 *
 * 业务约束：
 * - `type` 暂支持 `single_choice` / `multi_choice`；未来可能扩展 text_input 等。
 * - `allow_free_text` 在业务上恒为 true（自然语言兜底永不关闭），这里保留字段
 *   是为了未来可能需要区分「纯选项 vs 允许文字」的场景。
 * - `options[i].detail` 是可选的副标题/说明。
 */
const FORM_PARAM = {
  type: "object",
  description: "可选的结构化表单。当你心里已经有 N 个候选回复时，用它代替纯文本选项列表——接收方的前端会渲染为 option picker（用户可以点选，也可以写自由文本）。",
  properties: {
    type: {
      type: "string",
      enum: ["single_choice", "multi_choice"],
      description: "表单类型：single_choice 单选，multi_choice 多选",
    },
    options: {
      type: "array",
      description: "候选选项列表",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "选项 ID（简短标识，如 A/B/C 或 opt1）" },
          label: { type: "string", description: "选项标题（一行文字）" },
          detail: { type: "string", description: "选项详细说明（可选）" },
        },
        required: ["id", "label"],
      },
    },
    allow_free_text: {
      type: "boolean",
      description: "是否允许用户不选选项、直接写自由文本回复（默认 true，业务上总是 true）",
    },
  },
  required: ["type", "options"],
} as const;

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

/**
 * title 参数的 JSON Schema（所有 tool 共用）
 *
 * 面向外部观察者（人类、协作对象、supervisor）的一句话意图描述。
 * 也作为 LLM 自我对齐的锚点：每次 tool call 显式复述意图可降低失焦。
 * 前端 TuiAction 会把 title 作为卡片行首主标题展示。
 *
 * 特别说明：对 submit + think(context="fork") 而言，这个 title 同时作为
 * 新创建的子线程的名字（语义上两者天然同一：「这次 tool call 在做什么」
 * 就是「要创建的子线程是什么」）。
 */
const TITLE_PARAM = {
  type: "string",
  description: "一句话说明本次工具调用在做什么（面向观察者的自然语言，建议不超过 20 个汉字）。例如：\"读取 gene.md\"、\"回复用户问题\"、\"分解任务为 3 个子线程\"。对于 submit + think(context=\"fork\")，此 title 同时作为新创建子线程的名字。",
} as const;

/** open tool — 打开上下文 */
export const OPEN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "open",
    description: "打开一个上下文。type=command 时加载指令相关知识；type=trait 时加载 trait 知识；type=skill 时加载 skill 内容；type=file 时读取文件到上下文窗口。记得带 title 参数，用一句话说明本次在做什么。",
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
          enum: ["program", "think", "talk", "talk_sync", "return", "call_function", "set_plan", "await", "await_all", "defer"],
          description: "指令名称（type=command 时必填）",
        },
        name: {
          type: "string",
          description: "trait 完整路径（type=trait 时必填）或 skill 名称（type=skill 时必填）",
        },
        path: {
          type: "string",
          description: "文件路径（type=file 时必填，相对于项目根目录）",
        },
        lines: {
          type: "number",
          description: "读取行数限制（type=file 时可选，不填则读取全文）",
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
      required: ["title", "type", "description"],
    },
  },
};

/** submit tool — 提交执行（仅 command 类型） */
export const SUBMIT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit",
    description: "提交指令执行。必须先 open 获取 form_id。记得带 title 参数，用一句话说明本次提交的意图。think/talk 指令通过 context=fork|continue 表达四种语义：think(fork) 派生自己的子线程；think(continue,threadId) 向自己某线程补充；talk(fork,target) 向别人新根线程；talk(continue,target,threadId) 向别人已有线程补充。talk 可选带 form 参数——当你已经有几个候选回复时，用结构化表单代替纯文本列表，接收方前端会把它渲染为 option picker。",
    parameters: {
      type: "object",
      properties: {
        /**
         * 注意：对 think(context="fork") 来说，这个 title 同时是新子线程的名字——
         * 这次 tool call 的「行动标题」天然等于「要创建的子线程的标题」。
         */
        title: TITLE_PARAM,
        form_id: {
          type: "string",
          description: "open 返回的 form_id",
        },
        /* program */
        code: { type: "string", description: "program: JavaScript 代码" },
        lang: { type: "string", enum: ["javascript", "shell"], description: "program: 语言" },
        /* think / talk 统一参数（fork vs continue 四模式） */
        msg: { type: "string", description: "think/talk: 要发送的消息内容。think 时向自己的线程投递，talk 时向对方投递。" },
        threadId: { type: "string", description: "think/talk: 目标线程 ID。context=continue 时必填；context=fork 时可选——省略时，think 默认 fork 当前线程，talk 默认 fork 对方新根线程。" },
        context: { type: "string", enum: ["fork", "continue"], description: "think/talk: 操作模式。fork=派生新线程（对原线程 readonly，适合查资料/拆分子任务）；continue=直接向原线程投递消息（会产生影响，适合补充信息/触发决策）。" },
        /* talk 额外参数 */
        target: { type: "string", description: "talk: 目标对象名。特殊保留字 \"super\" 指向当前对象的反思镜像分身（不是 supervisor）。" },
        /* talk: 可选结构化表单（选项 + 自由文本兜底） */
        form: FORM_PARAM,
        /* return */
        summary: { type: "string", description: "return: 完成摘要" },
        /* set_plan */
        text: { type: "string", description: "set_plan: 计划内容" },
        /* await */
        thread_id: { type: "string", description: "await: 线程 ID" },
        thread_ids: { type: "array", items: { type: "string" }, description: "await_all: 线程 ID 列表" },
        /* call_function */
        args: { type: "object", description: "call_function: 方法参数" },
        /* think 额外参数 */
        traits: { type: "array", items: { type: "string" }, description: "think(fork): 新子线程的 trait 列表" },
        /* defer */
        on_command: { type: "string", description: "defer: 目标 command 名（如 return, talk, program）" },
        content: { type: "string", description: "defer: 提醒文本" },
        once: { type: "boolean", description: "defer: 是否只触发一次（默认 true）" },
        mark: MARK_PARAM,
      },
      required: ["title", "form_id"],
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

/** wait tool — 切换线程到 waiting 状态 */
export const WAIT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "wait",
    description: "将当前线程切换到 waiting 状态，暂停执行。适用于：等待用户输入、等待外部事件、主动让出执行权。线程会在收到新的 inbox 消息时被唤醒。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "等待原因",
        },
        mark: MARK_PARAM,
      },
      required: ["reason"],
    },
  },
};

/** 所有 OOC tools */
export const OOC_TOOLS: ToolDefinition[] = [OPEN_TOOL, SUBMIT_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表
 *
 * 始终返回四个 tool（open/submit/close/wait）。
 */
export function buildAvailableTools(_activeCommands?: Set<string>): ToolDefinition[] {
  return OOC_TOOLS;
}
