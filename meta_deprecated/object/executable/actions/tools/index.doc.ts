import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { open_v20260506_1 } from "@meta/object/executable/actions/tools/open.doc";
import { refine_v20260506_1 } from "@meta/object/executable/actions/tools/refine.doc";
import { submit_v20260506_1 } from "@meta/object/executable/actions/tools/submit.doc";
import { close_v20260506_1 } from "@meta/object/executable/actions/tools/close.doc";
import { wait_v20260506_1 } from "@meta/object/executable/actions/tools/wait.doc";
import { compress_v20260506_1 } from "@meta/object/executable/actions/tools/compress.doc";
import { mark_v20260506_1 } from "@meta/object/executable/actions/tools/mark.doc";
import * as toolsSource from "@src/executable/tools/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Tools 概念骨架
 *
 *  Tools = LLM 每轮 ThinkLoop 可调的原语集合。包含：
 *    - 6 个原语一览（open / refine / submit / close / wait / compress）
 *    - 通用附加参数（mark / deps）
 *    - form pipeline（open → refine → submit → close 在 FormManager 上的串联）
 *    - command_exec form 在 contextWindows 中的形态
 *    - 容易踩坑的两条协议细节
 * ──────────────────────────────────────────────────────────────── */

/**
 * Tools 概念：LLM 每轮 ThinkLoop 可以直接调用的原语集合。
 *
 * sources:
 *  - tools — handleToolCall 入口与各原语的 dispatch 层
 */
export type ToolsConcept = Concept & {
  sources: { tools: typeof toolsSource };

  /** 6 个原语一览（用表格鸟瞰，详述见各子概念） */
  primitives: ExampleNode;

  /** 任意 tool 调用都可携带的附加参数（mark / deps） */
  universalParams: {
    title: string;
    summary?: string;
    /** mark：标记 inbox 消息已读 */
    markParam: DocNode;
    /** deps：声明本次调用基于哪些信息 */
    depsParam: DocNode;
  };

  /** open → refine → submit → close + wait 在 FormManager 上的串联 */
  formPipeline: {
    title: string;
    summary?: string;
    /** open 阶段：FormManager.open */
    openStage: DocNode;
    /** refine 阶段：FormManager.refine */
    refineStage: DocNode;
    /** submit 阶段：FormManager.submit + executeCommand */
    submitStage: DocNode;
    /** close 阶段：FormManager.close */
    closeStage: DocNode;
    /** wait 阶段：setNodeStatus("waiting") */
    waitStage: DocNode;
  };

  /** command_exec form 在 thread.contextWindows 中的形态 */
  contextWindowRepresentation: {
    title: string;
    summary?: string;
    /** form 在 ContextWindow 体系中即 command_exec window */
    commandExecWindow: DocNode;
    /** submit 成功后 form 自动从 contextWindows 移除 */
    autoRemoveOnSubmit: DocNode;
    /** todo 一步直建路径 */
    todoFastPath: DocNode;
  };

  /** 容易踩坑的两条协议细节 */
  protocolNotes: {
    title: string;
    summary?: string;
    /** refine 业务参数字段名是 form_args */
    refineArgsField: DocNode;
    /** submit 不接业务参数但运行时会合并 tool 元参数 */
    submitSchemaMetaMix: DocNode;
  };

  /** 子概念：open 原语 */
  open: Concept;
  /** 子概念：refine 原语 */
  refine: Concept;
  /** 子概念：submit 原语 */
  submit: Concept;
  /** 子概念：close 原语 */
  close: Concept;
  /** 子概念：wait 原语 */
  wait: Concept;
  /** 子概念：compress 原语 */
  compress: Concept;
  /** 子概念：mark 附加参数 */
  mark: Concept;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 *
 *  parent 改为 getter 以打破 executable/index ↔ tools/index 的循环初始化死锁。
 *  executable/index.doc 在顶层 import 本模块，此时 executable_v20260504_1 尚未
 *  赋值；用 getter 让消费方按需访问，避开 ReferenceError。
 * ──────────────────────────────────────────────────────────────── */

export const tools_v20260506_1: ToolsConcept = {
  name: "Tools",
  get parent() {
    return executable_v20260504_1;
  },
  sources: { tools: toolsSource },
  description: `
Tools 是 LLM 在每一轮 ThinkLoop 中可以直接调用的原语集合。
OOC 把"行动"建模为这些原语；具体能做什么由 open 时携带的 command 决定。
`.trim(),

  primitives: {
    kind: "example",
    title: "原语一览",
    summary: "6 个原语的作用速查表（详述见各子概念）",
    content: `
| 原语 | 作用 |
|---|---|
| open    | 打开一次行动的入口（开启 form / 加载 knowledge / 加载 file） |
| refine  | 累积 / 修改 form 参数（不执行） |
| submit  | 提交 form，触发对应 command 执行 |
| close   | 取消 form / 关闭任意 ContextWindow |
| wait    | 声明等待指定 window (talk/do) 上的未来 IO；无合法 on 时被 reject |
| compress | 压缩本线程的 process events |
    `.trim(),
  },

  universalParams: {
    title: "通用附加参数",
    summary: "任意 tool 调用都可携带，与具体 tool 语义正交",

    markParam: {
      title: "mark",
      content: `
任意 tool 调用都可以携带 mark 参数，用来标记 inbox 消息已读（ack / ignore / todo）。
详见 mark 子概念。
      `.trim(),
    },

    depsParam: {
      title: "deps",
      content: `
任意 tool 调用都可以携带 deps 参数，用于声明执行这个 tool 时是基于哪些信息而作出的决定。
      `.trim(),
    },
  },

  formPipeline: {
    title: "form 流水线",
    summary: "4 个 form 原语在 FormManager 上的串联；每一步都留下可观察痕迹",

    openStage: {
      title: "open(type=command, command=X, ...) → FormManager.open",
      content: `
form 进入 status=open 活跃状态；根据 command 路径激活相关 knowledge。

\`\`\`
open(type=command, command=X, ...)   →  FormManager.open(command=X)
                                          ↓
                                       form 进入活跃状态（status=open）
                                       根据 command 路径激活相关 knowledge
\`\`\`
      `.trim(),
    },

    refineStage: {
      title: "refine(form_id, form_args) → FormManager.refine",
      content: `
累积参数；若 args 触发新的 command 路径，增量激活对应 knowledge。

\`\`\`
refine(form_id, form_args)           →  FormManager.refine(formId, form_args)
                                          ↓
                                       累积参数；若 args 触发新的 command 路径，
                                       增量激活对应 knowledge
\`\`\`
      `.trim(),
    },

    submitStage: {
      title: "submit(form_id, ...) → FormManager.submit + executeCommand",
      content: `
\`\`\`
submit(form_id, ...)                 →  FormManager.submit(formId)
                                          ↓
                                       form 状态切到 executing（仍在 active_forms）
                                       executeCommand(form.command, finalArgs)
                                       FormManager.markExecuted(formId, result)
                                       form 状态切到 executed，result 进入 context
                                       （form 不自动关闭，由 LLM 显式 close）
\`\`\`
      `.trim(),
    },

    closeStage: {
      title: "close(form_id, reason) → FormManager.close",
      content: `
\`\`\`
close(form_id, reason)               →  FormManager.close(formId)
                                          ↓
                                       form 真正离开 active_forms（任何状态都可关）
                                       非 pinned 的 knowledge 自动卸载
\`\`\`
      `.trim(),
    },

    waitStage: {
      title: 'wait(on=<window_id>) → setNodeStatus("waiting")',
      content: `
\`\`\`
wait(on=<window_id>)                 →  setNodeStatus("waiting") + waitingOn=on
                                          ↓
                                       on 必须 resolve 到 open 的 talk_window
                                       或 do_window；否则 reject（无合法 on
                                       通常意味着应该 end，不是 wait）
\`\`\`
      `.trim(),
    },
  },

  contextWindowRepresentation: {
    title: "ContextWindow 形态",
    summary: "form 在 thread.contextWindows 中的形态与可见性规则",

    commandExecWindow: {
      title: "command_exec window",
      content: `
form 在 ContextWindow 体系中即 command_exec window，是 ContextWindow 的一种 type。
每个 open 创建的 command_exec form 都会出现在 thread.contextWindows 中
（详见 thinkable/context），让 LLM 看到自己手头还挂着哪些行动。
      `.trim(),
    },

    autoRemoveOnSubmit: {
      title: "submit 成功 → 自动移除",
      content: `
submit 成功后该 form **自动从 contextWindows 移除**，无需 close；
失败时保留 status=executed + result，等 LLM 显式 close。
      `.trim(),
    },

    todoFastPath: {
      title: "todo 一步直建路径",
      content: `
todo 不走 open → refine → submit 三步——open(command="todo", title=..., args={ content })
在 args 给齐时 open 立即提交 form，产出独立的 todo_window；
完成时 close(window_id="<todo_window_id>")。
      `.trim(),
    },
  },

  protocolNotes: {
    title: "协议踩坑提示",
    summary: "两条容易在 prompt / 实现侧踩坑的协议细节",

    refineArgsField: {
      title: "refine 业务参数字段名",
      content: `
refine 的业务参数真实字段名是 form_args，不是某些早期文档写的顶层 args。
      `.trim(),
    },

    submitSchemaMetaMix: {
      title: "submit 不接业务参数但运行时会合并 tool 元参数",
      content: `
submit 的 schema 不接受新的业务参数；
运行时内部仍会把 tool 顶层参数（如 title / mark）并入最终执行参数，
因此 command 实现需要自己区分"业务参数"和"tool 元参数"。
      `.trim(),
    },
  },

  open: open_v20260506_1,
  refine: refine_v20260506_1,
  submit: submit_v20260506_1,
  close: close_v20260506_1,
  wait: wait_v20260506_1,
  compress: compress_v20260506_1,
  mark: mark_v20260506_1,

  refs: {
    /** 6 个原语的子概念 */
    open: open_v20260506_1,
    refine: refine_v20260506_1,
    submit: submit_v20260506_1,
    close: close_v20260506_1,
    wait: wait_v20260506_1,
    compress: compress_v20260506_1,
    mark: mark_v20260506_1,
  },
};
