import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as toolsSource from "@src/executable/tools/index";

// parent 改为 getter 以打破 executable/index ↔ tools/index 的循环初始化死锁。
// executable/index.doc.js 在顶层 import 本模块，此时 executable_v20260504_1 尚未赋值；
// 用 getter 让消费方按需访问，避开 ReferenceError。
export const tools_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
  name: "Tools",
  sources: { tools: toolsSource },
  description: `
Tools 是 LLM 在每一轮 ThinkLoop 中可以直接调用的原语集合。
OOC 把"行动"建模为这些原语；具体能做什么由 open 时携带的 command 决定。

按子字段展开：

- primitives — 6 个原语的作用一览（open / refine / submit / close / wait / compress）
- universalParams — 任意 tool 调用都可携带的附加参数（mark / deps）
- formPipeline — open → refine → submit → close 在 FormManager 上的串联
- contextWindowRepresentation — command_exec form 在 thread.contextWindows 中的形态
- protocolNotes — 容易踩坑的两条协议细节
`,

  primitives: {
    title: "primitives",
    content: `
6 个原语；每个在子字段独立展开。

| 原语 | 作用 |
|---|---|
| open    | 打开一次行动的入口（开启 form / 加载 knowledge / 加载 file） |
| refine  | 累积 / 修改 form 参数（不执行） |
| submit  | 提交 form，触发对应 command 执行 |
| close   | 取消 form / 关闭任意 ContextWindow |
| wait    | 声明等待指定 window (talk/do) 上的未来 IO；无合法 on 时被 reject |
| compress | 压缩本线程的 process events |
    `,

    openPrimitive: {
      title: "open",
      content: `
行动入口；按 type 分支创建 command_exec form / 挂 knowledge / 挂 file。
详见 actions/tools/open 子文档。
      `,
    },

    refinePrimitive: {
      title: "refine",
      content: `
向已有 form 累积 / 修改参数；不执行 command。
触发 command path 重算与 knowledge 增量激活。
详见 actions/tools/refine 子文档。
      `,
    },

    submitPrimitive: {
      title: "submit",
      content: `
提交一个已 open 的 form，触发对应 command 执行。
不接受新的业务参数——所有业务参数走 refine 累积。
详见 actions/tools/submit 子文档。
      `,
    },

    closePrimitive: {
      title: "close",
      content: `
关闭任意 ContextWindow（command_exec / do / todo / talk / ...）。
reason 必填，避免无说明的反复振荡。
详见 actions/tools/close 子文档。
      `,
    },

    waitPrimitive: {
      title: "wait",
      content: `
声明等待指定 window 上的未来 IO 事件，把当前线程切到 waiting。
on 必填且必须 resolve 到一个 open 且可产生未来 IO 的 window。
详见 actions/tools/wait 子文档。
      `,
    },

    compressPrimitive: {
      title: "compress",
      content: `
压缩本线程的 process events，控制 transcript 体积。
      `,
    },
  },

  universalParams: {
    title: "universal Params",
    content: `
任意 tool 调用都可携带的两个附加参数，与具体 tool 语义正交。
    `,

    markParam: {
      title: "mark",
      content: `
任意 tool 调用都可以携带 mark 参数，用来标记 inbox 消息已读（ack / ignore / todo）。
详见 actions/tools/mark。
      `,
    },

    depsParam: {
      title: "deps",
      content: `
任意 tool 调用都可以携带 deps 参数，用于声明执行这个 tool 时是基于哪些信息而作出的决定。
      `,
    },
  },

  formPipeline: {
    title: "form Pipeline",
    content: `
4 个 form 原语在 FormManager 上的串联。每一步在 thread.contextWindows / 事件流
中留下可观察痕迹。
    `,

    openStage: {
      title: "open(type=command, command=X, ...) → FormManager.open",
      content: `
form 进入 status=open 活跃状态；根据 command 路径激活相关 knowledge。

open(type=command, command=X, ...)   →  FormManager.open(command=X)
                                          ↓
                                       form 进入活跃状态（status=open）
                                       根据 command 路径激活相关 knowledge

      `,
    },

    refineStage: {
      title: "refine(form_id, form_args) → FormManager.refine",
      content: `
累积参数；若 args 触发新的 command 路径，增量激活对应 knowledge。

refine(form_id, form_args)           →  FormManager.refine(formId, form_args)
                                          ↓
                                       累积参数；若 args 触发新的 command 路径，
                                       增量激活对应 knowledge

      `,
    },

    submitStage: {
      title: "submit(form_id, ...) → FormManager.submit + executeCommand",
      content: `

submit(form_id, ...)                 →  FormManager.submit(formId)
                                          ↓
                                       form 状态切到 executing（仍在 active_forms）
                                       executeCommand(form.command, finalArgs)
                                       FormManager.markExecuted(formId, result)
                                       form 状态切到 executed，result 进入 context
                                       （form 不自动关闭，由 LLM 显式 close）

      `,
    },

    closeStage: {
      title: "close(form_id, reason) → FormManager.close",
      content: `

close(form_id, reason)               →  FormManager.close(formId)
                                          ↓
                                       form 真正离开 active_forms（任何状态都可关）
                                       非 pinned 的 knowledge 自动卸载

      `,
    },

    waitStage: {
      title: "wait(on=<window_id>) → setNodeStatus(\"waiting\")",
      content: `

wait(on=<window_id>)                 →  setNodeStatus("waiting") + waitingOn=on
                                          ↓
                                       on 必须 resolve 到 open 的 talk_window
                                       或 do_window；否则 reject（无合法 on
                                       通常意味着应该 end，不是 wait）

      `,
    },
  },

  contextWindowRepresentation: {
    title: "context Window Representation",
    content: `
form 在 thread.contextWindows 中的形态与可见性规则。
    `,

    commandExecWindow: {
      title: "command_exec window",
      content: `
form 在 ContextWindow 体系中即 command_exec window，是 ContextWindow 的一种 type。
每个 open 创建的 command_exec form 都会出现在 thread.contextWindows 中
（详见 thinkable/context），让 LLM 看到自己手头还挂着哪些行动。
      `,
    },

    autoRemoveOnSubmit: {
      title: "submit 成功 → 自动移除",
      content: `
submit 成功后该 form **自动从 contextWindows 移除**，无需 close；
失败时保留 status=executed + result，等 LLM 显式 close。
      `,
    },

    todoFastPath: {
      title: "todo 的一步直建路径",
      content: `
todo 不走 open → refine → submit 三步——open(command="todo", title=..., args={ content })
在 args 给齐时 open 立即提交 form，产出独立的 todo_window；
完成时 close(window_id="<todo_window_id>")。
      `,
    },
  },

  protocolNotes: {
    title: "protocol Notes",
    content: `
两条容易在 prompt / 实现侧踩坑的协议细节。
    `,

    refineArgsField: {
      title: "refine 业务参数字段名",
      content: `
refine 的业务参数真实字段名是 form_args，不是某些早期文档写的顶层 args。
      `,
    },

    submitSchemaMetaMix: {
      title: "submit 不接业务参数但运行时会合并 tool 元参数",
      content: `
submit 的 schema 不接受新的业务参数；
运行时内部仍会把 tool 顶层参数（如 title / mark）并入最终执行参数，
因此 command 实现需要自己区分"业务参数"和"tool 元参数"。
      `,
    },
  },
};
