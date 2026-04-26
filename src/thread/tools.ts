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
    description: "打开一个上下文。type=command 时加载指令相关知识；type=trait 时加载 trait 知识；type=skill 时加载 skill 内容；type=file 时读取文件到上下文窗口。可选 args 字段——若已知部分参数可一并传入，等价于 open(...) 紧接 refine(args)。记得带 title 参数，用一句话说明本次在做什么。",
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
          enum: ["program", "think", "talk", "talk_sync", "return", "call_function", "set_plan", "await", "await_all", "defer", "compact"],
          description: "指令名称（type=command 时必填）。compact 进入上下文压缩模式——列出/截断/丢弃冗余 actions，最后 submit compact {summary} 一次性完成压缩。",
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
    description: "提交指令执行。必须先 open 获取 form_id，所有参数通过 refine() 累积；submit() 本身不接受参数。think/talk 指令通过 context=fork|continue 表达四种语义：think(fork) 派生自己的子线程；think(continue,threadId) 向自己某线程补充；talk(fork,target) 向别人新根线程；talk(continue,target,threadId) 向别人已有线程补充。talk 可选带 form 参数（结构化表单）——记得用 refine() 提供。记得带 title 参数，用一句话说明本次提交的意图。",
    parameters: {
      type: "object",
      properties: {
        /**
         * 注意：对 think(context="fork") 来说，这个 title 同时是新子线程的名字——
         * 这次 tool call 的「行动标题」天然等于「要创建的子线程的标题」。
         */
        title: TITLE_PARAM,
        form_id: { type: "string", description: "open 返回的 form_id" },
        mark: MARK_PARAM,
      },
      required: ["title", "form_id"],
    },
  },
};

/** refine tool — 向 open 的 form 追加/修改 args（不执行） */
export const REFINE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "refine",
    description:
      "向已 open 的 form 追加或修改参数（不执行）。多次调用 refine 累积 args（后到覆盖先到），可能深化命令路径，从而触发新一轮知识激活。等到参数齐全且语义合理，再调 submit() 执行。refine 取代旧的 submit(partial=true)。",
    parameters: {
      type: "object",
      properties: {
        title: TITLE_PARAM,
        form_id: { type: "string", description: "open 返回的 form_id" },
        args: {
          type: "object",
          description: "要追加或覆盖的参数键值对。后到覆盖先到。",
        },
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
export const OOC_TOOLS: ToolDefinition[] = [OPEN_TOOL, REFINE_TOOL, SUBMIT_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表
 *
 * 始终返回五个 tool（open/refine/submit/close/wait）。
 */
export function buildAvailableTools(_activeCommands?: Set<string>): ToolDefinition[] {
  return OOC_TOOLS;
}
