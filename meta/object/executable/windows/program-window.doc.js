import * as program from "@src/executable/windows/program";
import * as programRuntime from "@src/executable/windows/program-runtime";

/**
 * program_window 概念：代码执行窗口（REPL 风格）。
 *
 * sources:
 *  - program        — exec / close 命令注册 + match paths + 渲染
 *  - programRuntime — ts/js sandbox + shell exec + function 调用 + threadLocalData
 */
export const program_window_v20260515_1 = {
  name: "ProgramWindow",
  description: `program_window 是代码执行窗口，由 root.program submit 创建并立即跑首次 exec；后续 exec 通过 program_window 上注册的 exec command 追加到 history。`,
  sources: { program, programRuntime },

  fields_v20260517_1: {
    index: `
关键字段：

- history — 每次 exec 的记录数组（含 args 与 result）
- threadLocalData 通过 thread.threadLocalData 跨 exec 共享 ts/js 数据
  （self.getThreadLocal / self.setThreadLocal API）
`,
  },

  executionModes_v20260517_1: {
    index: `
args.language 决定执行路径（与 root.program 同一 runtime）；4 种 mode 详见子节点。
match() 据此追加 path：exec / exec.shell / exec.ts / exec.js / exec.function。
`,

    shell_v20260517_1: {
      index: `#### shell — language="shell" + code=<shell>：起新系统 shell 进程执行 code，每次 exec 全新进程。详细约束见各子节点。`,

      timeoutAndTruncate_v20260517_1: {
        index: `##### timeoutAndTruncate — 30 秒超时（exit code 124）；stdout / stderr 各 4KB 截断；超过的部分直接丢弃，避免淹没 context。`,
      },

      cwdAndEnv_v20260517_1: {
        index: `##### cwdAndEnv — cwd 固定为 process.cwd()，env 继承 parent process；额外注入 env OOC_SELF_DIR 让 shell 中可定位当前对象目录。`,
      },

      noThreadLocal_v20260517_1: {
        index: `##### noThreadLocal — shell 之间**不**共享 thread-local 数据（OS 进程隔离）；需要跨 exec 共享数据请用 ts/js + self.getThreadLocal/setThreadLocal。`,
      },
    },

    ts_v20260517_1: {
      index: `#### ts — language="ts" / "typescript" + code：sandbox 内执行 ts；每次 exec 重新加载用户代码模块。详见各子节点。`,

      reloadEachExec_v20260517_1: {
        index: `##### reloadEachExec — 每次 exec 都重新动态 import 用户代码模块，不缓存；避免上一次 exec 的副作用残留。`,
      },

      threadLocalChannel_v20260517_1: {
        index: `##### threadLocalChannel — 可通过 self.getThreadLocal(key) / self.setThreadLocal(key, value) 跨 exec 共享数据；数据存 thread.threadLocalData，是 ts/js mode 独有的能力（shell 不接此通道）。`,
      },
    },

    js_v20260517_1: {
      index: `
#### js

language="js" / "javascript" + code：与 ts 同一 sandbox 路径，按 js 解析。共享 threadLocalData 同上。
`,
    },

    function_v20260517_1: {
      index: `
#### function

function=<name> + args=<params>：调 server method（按 name 解析）。每次 exec 是 fresh callMethod 调用。
签名 knowledge 自动加进 form 协议。
`,
    },
  },

  commands_v20260517_1: {
    index: `program_window 注册 2 个 command。`,

    exec_v20260517_1: {
      index: `
### exec

在已打开的 program_window 中再次执行。参数与 root.program 相同（language / code / function / args）。

执行体见 exec.execution；缺参数时 input knowledge 见 exec.inputKnowledge；
match path 见 executionModes。
`,

      execution_v20260517_1: {
        index: `
#### execution（executeProgramWindowExec）

1. 校验：parentWindow 必须是 type=program；同时要求 function 或 (language && code) 二选一
2. 调 runOneExec(thread, args) 得到一条 record
3. 把 record 追加到 window.history（通过 Object.assign mutate 让 manager.toData() 写回）
4. window 自身保留打开，可继续 exec
`,
      },

      inputKnowledge_v20260517_1: {
        index: `
#### inputKnowledge

formStatus==="open" 且 args 既无 function 又缺 (language && code) 时，
knowledge 表追加 key internal/windows/program/exec/input，提示
refine(args={language,code}) 或 refine(args={function,args})。
`,
      },
    },

    close_v20260517_1: {
      index: `
### close

释放 window 与 history。

- 等价于 close tool
- 不会停止任何外部进程（每次 exec 都已经结束）
- exec 体 no-op；释放由 WindowManager 完成
`,
    },
  },
};
