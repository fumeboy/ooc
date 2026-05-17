import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as programSource from "@src/executable/windows/root/program";

export const program_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Program",
  sources: { program: programSource },
  description: `
program 执行一段代码或调用 server 方法。产出 **program_window**，
首次 exec 立即跑完，后续可通过 program_window 的 exec command 在同一窗口反复执行。

按子字段展开：

- callShapes — 两种首次调用模式（临时代码 / 调用对象函数方法）
- subsequentExec — 通过 program_window.exec 反复执行
- pathList — root.program 注册的 command path
- programWindowCommands — program_window 上的 exec / close
- languageBackends — 4 种 language / function 路径的实现细节
- executionHistory — program_window 的 history 与渲染规则
- outOfScope — 不在范围内的能力
`,

  callShapes_v20260517_1: {
    title: "call Shapes",
    content: `
program 首次调用有两种模式；args 给齐时 open 立即提交 form，无需再 refine/submit。
    `,

    modeAInlineCode_v20260517_1: {
      title: "模式 A：执行一段临时代码",
      content: `

open(command="program", title="…", args={
  language: "ts" | "js" | "shell",
  code: "..."
})

      `,
    },

    modeBFunctionCall_v20260517_1: {
      title: "模式 B：调用对象函数方法",
      content: `

open(command="program", title="…", args={
  function: "readFile",              // 对象 server 模块 llm_methods 中注册的函数名
  args:   { path: "foo.txt" }
})

      `,
    },
  },

  subsequentExec_v20260517_1: {
    title: "subsequent Exec",
    content: `
后续多次执行通过 program_window.exec 在同一窗口内进行：


open(parent_window_id="<program_window_id>", command="exec", args={
  language: "ts",
  code: "_result_ = await self.getThreadLocal('counter');"
})


每次 exec 都共享 program_window 的 thread-local 通道（ts/js）。
    `,
  },

  pathList_v20260517_1: {
    title: "path List",
    content: `
root.program 注册的 command path 集合：


program                         （bare path，总是激活）
program.shell                   （language === "shell"）
program.typescript
program.javascript
program.function                （模式 B）


每条路径独立激活对应的 knowledge——shell 帮助在 shell 模式才进入 context。
    `,

    bare_v20260517_1: { index: `### program — bare path，总是激活` },
    shell_v20260517_1: { index: `### program.shell — language === "shell" 时激活` },
    typescript_v20260517_1: { index: `### program.typescript — language === "ts" / "typescript" 时激活` },
    javascript_v20260517_1: { index: `### program.javascript — language === "js" / "javascript" 时激活` },
    functionPath_v20260517_1: { index: `### program.function — 模式 B（function="<name>"）时激活，附带 method knowledge` },
  },

  programWindowCommands_v20260517_1: {
    title: "program Window Commands",
    content: `
program_window 上注册的两个 sub-command。
    `,

    execCmd_v20260517_1: {
      title: "exec (args: language+code | function+args)",
      content: `
起独立 sandbox 跑一次，结果追加到 history。
      `,
    },

    closeCmd_v20260517_1: {
      title: "close",
      content: `
释放 window；不影响任何外部进程。
      `,
    },
  },

  languageBackends_v20260517_1: {
    title: "language Backends",
    content: `
当前支持 3 种 language + 1 种 function 路径；各自语义、隔离边界与可用 API 不同。
    `,

    shellBackend_v20260517_1: {
      title: "language=\"shell\"",
      content: `
通过 sh -c 执行 code 字符串：
- cwd 固定为 process.cwd()，env 继承 parent process
- 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断
- 注入 env OOC_SELF_DIR 用于在 shell 中定位当前对象目录
- shell 之间**不**共享 thread-local 数据（OS 进程隔离）
      `,
    },

    tsJsBackend_v20260517_1: {
      title: "language=\"ts\" / \"typescript\" / \"js\" / \"javascript\"",
      content: `
in-process 动态 import 执行：
- 用户代码被包成 async function(console, self) { let _result_; ... return _result_; }
- console.log/warn/error 进 result 的 [stdout] 段
- _result_ 变量进 result 的 [returnValue] 段
      `,

      selfApi_v20260517_1: {
        title: "注入的 self 对象（ProgramSelf）",
        content: `
- self.dir — 当前对象目录
- self.callMethod — 调用 llm_methods 注册的方法
- self.getData / self.setData — 对象级数据
- self.getThreadLocal(key) / self.setThreadLocal(key, value) — 跨 exec
  共享 thread-local 数据（仅 ts/js；shell 不接此通道）
        `,
      },
    },

    functionBackend_v20260517_1: {
      title: "function=\"<name>\"",
      content: `
直接调用 server/index.ts 中 llm_methods 注册的方法：
- 自动激活方法知识：method 的 knowledge(args) 写入 form 的 commandKnowledgePaths
- 在 open / refine 阶段就开始影响下一轮 context
      `,
    },
  },

  executionHistory_v20260517_1: {
    title: "execution History",
    content: `
每次 exec（无论首次还是后续）都生成一条 ProgramExecRecord：

ts
{ execId, language, code?, function?, args?, output, ok, startedAt }


渲染时：history 列出所有 exec 一行摘要 + 最近一条 last_output 全文（按 32KB 截断）。
    `,
  },

  outOfScope_v20260517_1: {
    title: "out Of Scope",
    content: `
当前实现明确不覆盖的能力：

- 代码沙箱隔离（in-process 与内核共享进程）
- ui_methods 的 HTTP 暴露
- 命令白名单 / 真正的沙箱隔离
- shell 之间的 thread-local 共享（OS 进程隔离）
    `,
  },
};
