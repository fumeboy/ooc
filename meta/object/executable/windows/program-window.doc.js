import * as program from "@src/executable/windows/program";
import * as programRuntime from "@src/executable/windows/program-runtime";

/**
 * program_window 概念：代码执行窗口（REPL 风格），exec 历史保留。
 *
 * sources:
 *  - program        — exec / close 命令注册 + render
 *  - programRuntime — ts/js sandbox + shell exec + function 调用实现
 */
export const program_window_v20260515_1 = {
  name: "ProgramWindow",
  description: `
program_window 是代码执行窗口，由 root.program submit 创建并立即跑首次 exec。

支持的执行模式（args.language）：
- "shell" — 调用系统 shell
- "ts" / "js" — sandbox 内执行；ts/js 可通过 thread.threadLocalData 跨 exec 共享数据
- "function" — 调 server method（按 name 解析；签名 knowledge 自动加进 form 协议）

后续 exec 通过 program_window 上注册的 \`exec\` command；history[] 保留所有执行记录。
`.trim(),
  sources: { program, programRuntime },
};
