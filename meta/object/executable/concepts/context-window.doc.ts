import type { Concept, DocNode } from "@meta/doc-types";
import * as types from "@src/executable/windows/types";
import * as windows from "@src/executable/windows/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：ContextWindow union 与各 type 的契约
 * ──────────────────────────────────────────────────────────────── */

/**
 * ContextWindow 概念：thread 持有的上下文单元。
 *
 * sources:
 *  - types   — ContextWindow union 与各 type 的字段定义
 *  - windows — WindowManager 入口与 type registry 装载点
 */
export type ContextWindowConcept = Concept & {
  sources: {
    types: typeof types;
    windows: typeof windows;
  };

  /** 所有 ContextWindow 共有的 6 个最小字段 */
  commonFields: {
    title: string;
    summary?: string;
    id: DocNode;
    type: DocNode;
    /** window 的人类可读标签字段（与 DocNode.title 同名但语义不同） */
    titleField: DocNode;
    status: DocNode;
    parentWindowId: DocNode;
    createdAt: DocNode;
  };

  /** LLM 5 原语的入口签名 */
  primitives: DocNode & {
    open: DocNode;
    refine: DocNode;
    submit: DocNode;
    close: DocNode;
    wait: DocNode;
  };

  /** WindowType union 的 9 个分支 */
  typeCatalog: DocNode & {
    root: DocNode;
    commandExec: DocNode;
    do: DocNode;
    todo: DocNode;
    talk: DocNode;
    program: DocNode;
    file: DocNode;
    knowledge: DocNode;
    search: DocNode;
  };

  /** 每个 type 通过 registerWindowType 注入契约的关联点 */
  registryBinding: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const context_window_v20260515_1: ContextWindowConcept = {
  name: "ContextWindow",
  sources: { types, windows },
  description: `
ContextWindow 是 thread 持有的上下文单元；每个 thread 持有一组 contextWindows，按各自
type 注册一组可被 LLM 调用的 command。
`.trim(),

  commonFields: {
    title: "共有字段",
    summary: "所有 ContextWindow 共有的 6 个最小字段",

    id: {
      title: "id",
      summary: "全局唯一字符串；type prefix + 重复 id 抛错",
      content: `
全局唯一字符串；通过 generateWindowId(type) 生成，type 嵌入 prefix 便于阅读时识别 window 类型。
重复 id 在 insertTypedWindow 阶段会抛错，避免静默覆盖。
      `.trim(),
    },

    type: {
      title: "type",
      summary: "WindowType union 的一个分支",
      content:
        "WindowType union 的一个分支（root / command_exec / do / todo / talk / program / file / knowledge / search）。",
    },

    titleField: {
      title: "title",
      summary: "渲染给 LLM 的人类可读标签",
      content:
        "渲染给 LLM 的人类可读标签；同 type 多开时用以区分（如多个 talk_window 区分会话主题）。",
    },

    status: {
      title: "status",
      summary: "type-specific 状态枚举",
      content: `
type-specific 状态枚举：

- command_exec: open / executing / executed
- do: running / waiting / done / failed / paused（投影自子线程）
- talk: open
- program / file / knowledge / search / todo / root: 无显式 status（始终视为 open）
      `.trim(),
    },

    parentWindowId: {
      title: "parentWindowId",
      summary: "可选；缺省挂在 ROOT_WINDOW_ID，构成 sub-window 树",
      content: `
可选 string；缺省时挂在 ROOT_WINDOW_ID（root window 是隐含 virtual view）。
sub-window 关系通过这个字段构成树——级联 close 时按它向下递归。
      `.trim(),
    },

    createdAt: {
      title: "createdAt",
      summary: "创建时间戳；observability / 调试用",
      content: "创建时间戳；observability / 调试用，不影响调度。",
    },
  },

  primitives: {
    title: "5 原语",
    summary: "LLM 通过 5 原语与 contextWindow 交互",

    open: {
      title: "open(parent_window_id?, command, args?)",
      summary: "在 parent 下打开 command_exec sub-window",
      content:
        "在 parent 下打开 command_exec sub-window；args 给齐时可走 auto-submit 一步到位。",
    },

    refine: {
      title: "refine(form_id, args)",
      summary: "累积 form.accumulatedArgs 并重算 commandPaths",
      content:
        "累积 form 的 accumulatedArgs 并重算 commandPaths；仅 status=open 的 command_exec 可被 refine。",
    },

    submit: {
      title: "submit(form_id)",
      summary: "执行 form；成功自动移除，失败保留 result",
      content:
        "执行 form；成功自动从 contextWindows 移除，失败保留 status=executed + result。",
    },

    close: {
      title: "close(window_id, reason?)",
      summary: "触发 type.onClose hook；级联关闭子 window",
      content:
        "触发 type.onClose hook；hook 返回 false 时拒绝关闭；同时级联关闭所有 parentWindowId 指向它的子 window。",
    },

    wait: {
      title: "wait(on)",
      summary: "切换 thread.status 到 waiting",
      content:
        "切换 thread.status 到 waiting，等 inbox 出现新消息唤醒；on 必须是 open talk_window 或 running do_window。",
    },
  },

  typeCatalog: {
    title: "type 枚举",
    summary: "WindowType union 的 9 个分支",

    root: {
      title: "root",
      summary: "每个 thread 隐含的根 window；注册顶层 command 集合",
      content: `
每个 thread 隐含的根 window（不显式 insert 也存在虚拟视图）。
注册顶层 command：do / talk / program / plan / end / todo / open_file / open_knowledge / glob / grep / ...
      `.trim(),
    },

    commandExec: {
      title: "command_exec",
      summary: "LLM 调用某 command 时产生的临时 sub-window",
      content: `
LLM 调用某 command 时产生的临时 sub-window。生命周期 open → executing → executed
（详见 commandExecLifecycle 概念）。
      `.trim(),
    },

    do: {
      title: "do",
      summary: "fork 子线程后产生的对话窗口",
      content: "fork 子线程后产生的对话窗口（root.do submit 副作用）。详见 windows.doWindow。",
    },

    todo: {
      title: "todo",
      summary: "root.todo 一步直建的可见待办",
      content: "root.todo 一步直建的可见待办。详见 windows.todoWindow。",
    },

    talk: {
      title: "talk",
      summary: "与对端 flow object 的持续会话",
      content: "与对端 flow object 的持续会话。详见 windows.talkWindow。",
    },

    program: {
      title: "program",
      summary: "代码执行窗口（REPL 风格）",
      content: "代码执行窗口（REPL 风格）。详见 windows.programWindow。",
    },

    file: {
      title: "file",
      summary: "文件正文按 lines/columns 切片的持久 window",
      content: "文件正文按 lines/columns 切片的持久 window。详见 windows.fileWindow。",
    },

    knowledge: {
      title: "knowledge",
      summary: "knowledge 文本运行时载体（3 source）",
      content:
        "knowledge 文本运行时载体（explicit / protocol / activator 三 source）。详见 windows.knowledgeWindow。",
    },

    search: {
      title: "search",
      summary: "glob / grep 结果窗口；matches 带稳定 index",
      content: "glob / grep 结果窗口；matches 带稳定 index。详见 windows.searchWindow。",
    },
  },

  registryBinding: {
    title: "registry 绑定",
    summary: "每个 type 通过 registerWindowType 注入契约",
    content: `
每个 type 通过 registerWindowType(type, partial) 注入：commands 表 / onClose hook /
renderXml / basicKnowledge。详见 windowRegistry 概念。
    `.trim(),
  },
};
