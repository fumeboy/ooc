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

  commonFields: {
    title: "common Fields",
    content: `所有 ContextWindow 共有的最小字段集；每个字段独立子节点。`,

    id: {
      title: "id",
      content: `
全局唯一字符串；通过 generateWindowId(type) 生成，type 嵌入 prefix 便于阅读时识别 window 类型。
重复 id 在 insertTypedWindow 阶段会抛错，避免静默覆盖。
      `,
    },

    type: {
      title: "type",
      content: `
      WindowType union 的一个分支（root / command_exec / do / todo / talk / program / file / knowledge / search）。
      `,
    },

    title: {
      title: "title",
      content: `
      渲染给 LLM 的人类可读标签；同 type 多开时用以区分（如多个 talk_window 区分会话主题）。
      `,
    },

    status: {
      title: "status",
      content: `
type-specific 状态枚举：

- command_exec: open / executing / executed
- do: running / waiting / done / failed / paused（投影自子线程）
- talk: open
- program / file / knowledge / search / todo / root: 无显式 status（始终视为 open）
      `,
    },

    parentWindowId: {
      title: "parentWindowId",
      content: `
可选 string；缺省时挂在 ROOT_WINDOW_ID（root window 是隐含 virtual view）。
sub-window 关系通过这个字段构成树——级联 close 时按它向下递归。
      `,
    },

    createdAt: {
      title: "createdAt",
      content: `
      创建时间戳；observability / 调试用，不影响调度。
      `,
    },
  },

  primitives: {
    title: "primitives",
    content: `LLM 通过 5 原语与 contextWindow 交互；每个原语独立子节点（compress 不直接作用于 window，归 tools 文档）。`,

    open: {
      title: "open(parent_window_id?, command, args?)",
      content: `
      在 parent 下打开 command_exec sub-window；args 给齐时可走 auto-submit 一步到位。
      `,
    },

    refine: {
      title: "refine(form_id, args)",
      content: `
      累积 form 的 accumulatedArgs 并重算 commandPaths；仅 status=open 的 command_exec 可被 refine。
      `,
    },

    submit: {
      title: "submit(form_id)",
      content: `
      执行 form；成功自动从 contextWindows 移除，失败保留 status=executed + result。
      `,
    },

    close: {
      title: "close(window_id, reason?)",
      content: `
      触发 type.onClose hook；hook 返回 false 时拒绝关闭；同时级联关闭所有 parentWindowId 指向它的子 window。
      `,
    },

    wait: {
      title: "wait(on)",
      content: `
      切换 thread.status 到 waiting，等 inbox 出现新消息唤醒；on 必须是 open talk_window 或 running do_window。
      `,
    },
  },

  typeCatalog: {
    title: "type Catalog",
    content: `WindowType union 的 9 个分支；每个 type 的命令面 / 渲染 / onClose 见 windows/* 各概念。`,

    root: {
      title: "root",
      content: `
每个 thread 隐含的根 window（不显式 insert 也存在虚拟视图）。
注册顶层 command：do / talk / program / plan / end / todo / open_file / open_knowledge / glob / grep / ...
      `,
    },

    commandExec: {
      title: "command_exec",
      content: `
LLM 调用某 command 时产生的临时 sub-window。生命周期 open → executing → executed
（详见 commandExecLifecycle 概念）。
      `,
    },

    do: {
      title: "do",
      content: `
      fork 子线程后产生的对话窗口（root.do submit 副作用）。详见 windows.doWindow。
      `,
    },

    todo: {
      title: "todo",
      content: `
      root.todo 一步直建的可见待办。详见 windows.todoWindow。
      `,
    },

    talk: {
      title: "talk",
      content: `
      与对端 flow object 的持续会话。详见 windows.talkWindow。
      `,
    },

    program: {
      title: "program",
      content: `
      代码执行窗口（REPL 风格）。详见 windows.programWindow。
      `,
    },

    file: {
      title: "file",
      content: `
      文件正文按 lines/columns 切片的持久 window。详见 windows.fileWindow。
      `,
    },

    knowledge: {
      title: "knowledge",
      content: `
      knowledge 文本运行时载体（explicit / protocol / activator 三 source）。详见 windows.knowledgeWindow。
      `,
    },

    search: {
      title: "search",
      content: `
      glob / grep 结果窗口；matches 带稳定 index。详见 windows.searchWindow。
      `,
    },
  },

  registryBinding: {
    title: "registry Binding",
    content: `
每个 type 通过 registerWindowType(type, partial) 注入：commands 表 / onClose hook /
renderXml / basicKnowledge。详见 windowRegistry 概念。
    `,
  },
};
