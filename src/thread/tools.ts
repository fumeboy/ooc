/**
 * OOC Tool 定义
 *
 * 定义所有可用的 tool（begin + submit + cancel），
 * 供 engine 传给 LLM 的 tool_use 接口。
 *
 * @ref docs/superpowers/specs/2026-04-13-tool-calling-architecture-design.md#3
 */

import type { ToolDefinition } from "../thinkable/client.js";

/* ========== Begin Tools（声明意图，触发 trait 加载） ========== */

const program_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "program_begin",
    description: "声明要执行代码。系统加载 computable 相关知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const talk_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "talk_begin",
    description: "声明要向其他对象发送异步消息。系统加载 talkable 相关知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const talk_sync_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "talk_sync_begin",
    description: "声明要向其他对象发送同步消息（等待回复）。系统加载 talkable 相关知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const return_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "return_begin",
    description: "声明要完成当前线程并返回结果。系统加载 talkable + reflective + verifiable 知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const create_sub_thread_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "create_sub_thread_begin",
    description: "声明要创建子线程处理子任务。系统加载 plannable 知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const continue_sub_thread_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "continue_sub_thread_begin",
    description: "声明要向已创建的子线程追加消息。系统加载 plannable 知识。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const call_function_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "call_function_begin",
    description: "声明要直接调用 trait 方法。系统加载目标 trait。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
        trait: { type: "string", description: "trait 完整路径（如 kernel/computable/file_ops）" },
        function_name: { type: "string", description: "方法名（如 readFile）" },
      },
      required: ["description", "trait", "function_name"],
    },
  },
};

const use_skill_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "use_skill_begin",
    description: "声明要按需加载 Skill 的完整内容。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
        name: { type: "string", description: "skill 名称" },
      },
      required: ["description", "name"],
    },
  },
};

const set_plan_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "set_plan_begin",
    description: "声明要更新当前计划。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const await_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "await_begin",
    description: "声明要等待某个子线程完成。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

const await_all_begin: ToolDefinition = {
  type: "function",
  function: {
    name: "await_all_begin",
    description: "声明要等待多个子线程完成。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "要做什么" },
      },
      required: ["description"],
    },
  },
};

/* ========== Submit Tools（提交参数，执行指令） ========== */

const program_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "program_submit",
    description: "提交代码执行",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        code: { type: "string", description: "JavaScript 代码" },
        lang: { type: "string", enum: ["javascript", "shell"], description: "语言，默认 javascript" },
      },
      required: ["form_id", "code"],
    },
  },
};

const talk_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "talk_submit",
    description: "提交异步消息发送",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        target: { type: "string", description: "目标对象名" },
        message: { type: "string", description: "消息内容" },
      },
      required: ["form_id", "target", "message"],
    },
  },
};

const talk_sync_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "talk_sync_submit",
    description: "提交同步消息发送（发完等待回复）",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        target: { type: "string", description: "目标对象名" },
        message: { type: "string", description: "消息内容" },
      },
      required: ["form_id", "target", "message"],
    },
  },
};

const return_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "return_submit",
    description: "提交返回结果，完成当前线程",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        summary: { type: "string", description: "完成摘要" },
      },
      required: ["form_id", "summary"],
    },
  },
};

const create_sub_thread_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "create_sub_thread_submit",
    description: "提交子线程创建",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        title: { type: "string", description: "子线程标题" },
        description: { type: "string", description: "子线程描述" },
        traits: { type: "array", items: { type: "string" }, description: "trait 名称数组" },
      },
      required: ["form_id", "title"],
    },
  },
};

const continue_sub_thread_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "continue_sub_thread_submit",
    description: "提交向子线程追加消息",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        thread_id: { type: "string", description: "目标子线程 ID" },
        message: { type: "string", description: "追加的消息内容" },
      },
      required: ["form_id", "thread_id", "message"],
    },
  },
};

const call_function_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "call_function_submit",
    description: "提交 trait 方法调用",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        args: { type: "object", description: "方法参数（按参数名传入）" },
      },
      required: ["form_id"],
    },
  },
};

const use_skill_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "use_skill_submit",
    description: "提交 Skill 加载",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
      },
      required: ["form_id"],
    },
  },
};

const set_plan_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "set_plan_submit",
    description: "提交计划更新",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        text: { type: "string", description: "计划内容" },
      },
      required: ["form_id", "text"],
    },
  },
};

const await_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "await_submit",
    description: "提交等待子线程",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        thread_id: { type: "string", description: "等待的子线程 ID" },
      },
      required: ["form_id", "thread_id"],
    },
  },
};

const await_all_submit: ToolDefinition = {
  type: "function",
  function: {
    name: "await_all_submit",
    description: "提交等待多个子线程",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        thread_ids: { type: "array", items: { type: "string" }, description: "等待的子线程 ID 列表" },
      },
      required: ["form_id", "thread_ids"],
    },
  },
};

/* ========== Cancel Tool ========== */

const form_cancel: ToolDefinition = {
  type: "function",
  function: {
    name: "form_cancel",
    description: "取消一个已开启的 form",
    parameters: {
      type: "object",
      properties: {
        form_id: { type: "string" },
      },
      required: ["form_id"],
    },
  },
};

/* ========== 导出 ========== */

/** 所有 begin tools */
export const BEGIN_TOOLS: ToolDefinition[] = [
  program_begin,
  talk_begin,
  talk_sync_begin,
  return_begin,
  create_sub_thread_begin,
  continue_sub_thread_begin,
  call_function_begin,
  use_skill_begin,
  set_plan_begin,
  await_begin,
  await_all_begin,
];

/** begin tool name → 对应的 command 名称 */
export const BEGIN_TOOL_TO_COMMAND: Record<string, string> = {
  program_begin: "program",
  talk_begin: "talk",
  talk_sync_begin: "talk_sync",
  return_begin: "return",
  create_sub_thread_begin: "create_sub_thread",
  continue_sub_thread_begin: "continue_sub_thread",
  call_function_begin: "call_function",
  use_skill_begin: "use_skill",
  set_plan_begin: "set_plan",
  await_begin: "await",
  await_all_begin: "await_all",
};

/** command 名称 → 对应的 submit tool */
export const COMMAND_TO_SUBMIT_TOOL: Record<string, ToolDefinition> = {
  program: program_submit,
  talk: talk_submit,
  talk_sync: talk_sync_submit,
  return: return_submit,
  create_sub_thread: create_sub_thread_submit,
  continue_sub_thread: continue_sub_thread_submit,
  call_function: call_function_submit,
  use_skill: use_skill_submit,
  set_plan: set_plan_submit,
  await: await_submit,
  await_all: await_all_submit,
};

/** submit tool name → 对应的 command 名称 */
export const SUBMIT_TOOL_TO_COMMAND: Record<string, string> = Object.fromEntries(
  Object.entries(COMMAND_TO_SUBMIT_TOOL).map(([cmd, tool]) => [tool.function.name, cmd]),
);

/** form_cancel tool */
export const FORM_CANCEL_TOOL = form_cancel;

/**
 * 根据当前 form 状态生成可用 tools 列表
 *
 * - 始终提供所有 begin tools
 * - 有活跃 form 时，提供对应的 submit tools + form_cancel
 */
export function buildAvailableTools(activeCommands: Set<string>): ToolDefinition[] {
  const tools: ToolDefinition[] = [...BEGIN_TOOLS];

  if (activeCommands.size > 0) {
    tools.push(form_cancel);
    for (const cmd of activeCommands) {
      const submitTool = COMMAND_TO_SUBMIT_TOOL[cmd];
      if (submitTool) tools.push(submitTool);
    }
  }

  return tools;
}
