import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as programSource from "@src/executable/commands/program";

export const program_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`program\` 用于在执行一段代码 / 调用 Object 的某个函数方法。

## 调用形式

### 模式 A：执行一段临时代码

\`\`\`
open(type=command, command=program, title="…", description="…")
refine(form_id, {
  code: "const data = await readFile('foo.txt'); print(data);",
  language?: "ts" | "js" | "shell"
})
submit(form_id)
\`\`\`

### 模式 B：调用对象函数方法

\`\`\`
open(type=command, command=program, description="…")
refine(form_id, {
  function: "readFile",              // 对象的 server 模块导出的 llm_methods 函数索引中注册的函数名
  args:   { path: "foo.txt" }
})
submit(form_id)
\`\`\`

## Path 列表

\`\`\`
program                         （bare path，总是激活）
program.shell                   （language === "shell"）
program.typescript
program.javascript
program.function                （模式 B）
\`\`\`

## 当前实现阶段

当前实现支持 3 种 language + 1 种 function 路径：

- \`language="shell"\`：通过 \`sh -c\` 执行 code 字符串
  - cwd 固定为 \`process.cwd()\`，env 继承 parent process
  - 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断

- \`language="ts" / "typescript" / "js" / "javascript"\`：in-process 动态 import 执行
  - 用户代码被包成 \`async function(console, self) { let _result_; ... return _result_; }\`
  - 注入的 \`self\` 是 ProgramSelf 对象：\`self.dir\` / \`self.callMethod\` / \`self.getData\` / \`self.setData\`
  - console.log/warn/error 进 result 的 [stdout] 段
  - \`_result_\` 变量进 result 的 [returnValue] 段（JSON.stringify）
  - 用户代码可以直接 \`import { ... } from "node:fs/promises"\` 等标准 Bun/Node API

- \`function="<name>"\`（不需要 language）：直接调用 server/index.ts 中 llm_methods 注册的方法
  - 等价于 \`language="ts", code="_result_ = await self.callMethod(name, args)"\`
  - 推荐用于"我已经知道方法名只想调它"的场景
  - **自动激活方法知识**：open/refine 时若 \`function="<name>"\` 命中已注册方法，系统调用该方法的 \`knowledge(args)\` 函数
    （缺省按 \`description\` + \`params\` 自动生成），把返回文本写到 form 的 \`<method_knowledge>\` 段。
    下一轮 LLM 直接看到方法说明（且可以随 args 动态变化），不需要先翻 server/index.ts 源码再 refine \`args\`。
    method 改名 / 删除时，knowledge 在下一次 refine 自动失效。
    设计同构：\`server method.knowledge(args) → text\` ↔ \`command.match(args) → paths\`，都是基于当前 args 动态派生上下文。

## 元编程：编辑自己的 server/index.ts

你可以用 program.shell 写 \`<self.dir>/server/index.ts\`，新方法在下次调用立即生效（按 mtime 自动 reload）。

\`\`\`
open(program, language=shell, code='cat > <self.dir>/server/index.ts <<EOF
export const llm_methods = {
  greet: {
    description: "向某人问好",
    params: [{ name: "name", type: "string", required: true }],
    fn: async (ctx, { name }) => "Hello, " + name + "!",
  },
};
EOF') → submit

open(program, function="greet", args={ name: "world" }) → submit
# returnValue 段会包含 "Hello, world!"
\`\`\`

## 当前不支持

- 代码沙箱隔离（in-process 与内核共享进程）
- ui_methods 的 HTTP 暴露
- 命令白名单 / 沙箱隔离
`,
  sources: {
    program: programSource,
  },
};
