import * as types from "@src/executable/windows/types";
import * as windows from "@src/executable/windows/index";

/**
 * ContextWindow 概念：thread 持有的上下文单元。
 *
 * sources:
 *  - types  — ContextWindow union 与各 type 的字段定义
 *  - windows — WindowManager 入口与 type registry 装载点
 */
export const context_window_v20260515_1 = {
  name: "ContextWindow",
  description: `ContextWindow 是 thread 持有的上下文单元；每个 thread 持有一组 contextWindows，按各自 type 注册一组可被 LLM 调用的 command。`,
  sources: { types, windows },

  commonFields_v20260517_1: {
    index: `
所有 ContextWindow 共有的最小字段集：

- \`id\` — 全局唯一；通过 \`generateWindowId(type)\` 生成
- \`type\` — WindowType union
- \`title\` — 渲染给 LLM 的标签
- \`status\` — type-specific 状态枚举（如 open / running / executing / waiting）
- \`parentWindowId\` — 可选；缺省的 root window 是隐含 parent
- \`createdAt\` — 创建时间戳
`.trim(),
  },

  primitives_v20260517_1: {
    index: `
LLM 通过 5 原语与 contextWindow 交互：

- \`open(parent_window_id?, command, args?)\` — 在 parent 下打开 command_exec sub-window
- \`refine(form_id, args)\` — 累积 form 的 args 并重算 commandPaths
- \`submit(form_id)\` — 执行 form；成功自动移除，失败保留 executed + result
- \`close(window_id, reason?)\` — 触发 type 的 onClose hook，级联关闭子 window
- \`wait(on)\` — 切换 thread.status 到 waiting，等 inbox 事件唤醒
`.trim(),
  },

  typeCatalog_v20260517_1: {
    index: `WindowType union 的 9 个分支；每个 type 的命令面 / 渲染 / onClose 见 \`windows/*\` 各概念。`,

    root_v20260517_1: {
      index: `
#### root

每个 thread 隐含的根 window（不显式 insert 也存在虚拟视图）。
注册顶层 command：do / talk / program / plan / end / todo / open_file / open_knowledge / glob / grep / ...
`.trim(),
    },

    commandExec_v20260517_1: {
      index: `
#### command_exec

LLM 调用某 command 时产生的临时 sub-window。生命周期 open → executing → executed
（详见 \`commandExecLifecycle\` 概念）。
`.trim(),
    },

    do_v20260517_1: {
      index: `#### do — fork 子线程后产生的对话窗口（root.do submit 副作用）。详见 \`windows.doWindow\`。`,
    },

    todo_v20260517_1: {
      index: `#### todo — root.todo 一步直建的可见待办。详见 \`windows.todoWindow\`。`,
    },

    talk_v20260517_1: {
      index: `#### talk — 与对端 flow object 的持续会话。详见 \`windows.talkWindow\`。`,
    },

    program_v20260517_1: {
      index: `#### program — 代码执行窗口（REPL 风格）。详见 \`windows.programWindow\`。`,
    },

    file_v20260517_1: {
      index: `#### file — 文件正文按 lines/columns 切片的持久 window。详见 \`windows.fileWindow\`。`,
    },

    knowledge_v20260517_1: {
      index: `#### knowledge — knowledge 文本运行时载体（explicit / protocol / activator 三 source）。详见 \`windows.knowledgeWindow\`。`,
    },

    search_v20260517_1: {
      index: `#### search — glob / grep 结果窗口；matches 带稳定 index。详见 \`windows.searchWindow\`。`,
    },
  },

  registryBinding_v20260517_1: {
    index: `
每个 type 通过 \`registerWindowType(type, partial)\` 注入：commands 表 / onClose hook /
renderXml / basicKnowledge。详见 \`windowRegistry\` 概念。
`.trim(),
  },
};
