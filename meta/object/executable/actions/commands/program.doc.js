import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as programSource from "@src/executable/windows/root/program";

export const program_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`program\` 用于执行一段代码或调用 server 方法。Step 2（spec 2026-05-14）后产出 **program_window**，
首次 exec 立即跑完，后续可通过 program_window 的 \`exec\` command 在同一窗口反复执行。

## 调用形式

### 模式 A：执行一段临时代码（首次 exec）

\`\`\`
open(command="program", title="…", args={
  language: "ts" | "js" | "shell",
  code: "..."
})
\`\`\`

> args 给齐时 C 规则触发自动 submit，无需再 refine/submit。

### 模式 B：调用对象函数方法（首次 exec）

\`\`\`
open(command="program", title="…", args={
  function: "readFile",              // 对象的 server 模块导出的 llm_methods 函数索引中注册的函数名
  args:   { path: "foo.txt" }
})
\`\`\`

### 后续多次执行：通过 program_window 上的 exec command

\`\`\`
open(parent_window_id="<program_window_id>", command="exec", args={
  language: "ts",
  code: "_result_ = await self.getThreadLocal('counter');"
})
\`\`\`

## Path 列表

\`\`\`
program                         （bare path，总是激活）
program.shell                   （language === "shell"）
program.typescript
program.javascript
program.function                （模式 B）
\`\`\`

## program_window 的注册命令

- \`exec\` (args: language+code | function+args) — 起独立 sandbox 跑一次，结果追加到 history
- \`close\` — 释放 window；不影响任何外部进程

## 当前实现阶段

支持 3 种 language + 1 种 function 路径：

- \`language="shell"\`：通过 \`sh -c\` 执行 code 字符串
  - cwd 固定为 \`process.cwd()\`，env 继承 parent process
  - 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断
  - 注入 env \`OOC_SELF_DIR\` 用于在 shell 中定位当前对象目录

- \`language="ts" / "typescript" / "js" / "javascript"\`：in-process 动态 import 执行
  - 用户代码被包成 \`async function(console, self) { let _result_; ... return _result_; }\`
  - 注入的 \`self\` 是 ProgramSelf 对象
    - \`self.dir\` / \`self.callMethod\` / \`self.getData\` / \`self.setData\` 不变
    - **\`self.getThreadLocal(key)\` / \`self.setThreadLocal(key, value)\`**：跨 exec 共享 thread-local 数据（仅 ts/js；shell 不接此通道）
  - console.log/warn/error 进 result 的 [stdout] 段
  - \`_result_\` 变量进 result 的 [returnValue] 段

- \`function="<name>"\`：直接调用 server/index.ts 中 llm_methods 注册的方法
  - 自动激活方法知识：method 的 \`knowledge(args)\` 写入 form 的 command_knowledge

## program_window 的 history

每次 exec（无论首次还是后续）都生成一条 ProgramExecRecord：

\`\`\`ts
{ execId, language, code?, function?, args?, output, ok, startedAt }
\`\`\`

渲染时：history 列出所有 exec 一行摘要 + 最近一条 last_output 全文（按 32KB 截断）。

## 不在范围内

- 代码沙箱隔离（in-process 与内核共享进程）
- ui_methods 的 HTTP 暴露
- 命令白名单 / 真正的沙箱隔离
- shell 之间的 thread-local 共享（OS 进程隔离）
`,
  sources: {
    program: programSource,
  },
};
