import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as programSource from "@src/executable/commands/program";

export const program_v20260506_1 = {
  parent: commands_v20260506_1,
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

## 沙箱环境 (面向模式A)

执行环境提供：
- 路径常量：\`self_dir\` / \`world_dir\` 等只读路径
- 基础 API：\`readFile\` / \`writeFile\` / \`print\` / \`getData\` / \`setData\` 等（始终注入）
- \`callMethod(id, name, args)\` 调用任意已注册对象函数方法

## 输出与副作用

- \`print(...)\` / \`console.log(...)\` 的输出被收集，记录到 process event 中
- 失败时栈记录在 program event 的 error 字段，但**不**会自动 fail 整个线程——LLM 决定如何处理

## 当前实现阶段

当前实现仅支持 \`language="shell"\`：
- 通过 \`sh -c\` 执行 code 字符串
- cwd 固定为 \`process.cwd()\`（项目根）；env 继承 parent process
- 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断
- 输出归一化为单一字符串赋给 \`form.result\`，供 LLM 在下一轮 active_forms 中读取

当前不支持：
- \`language="ts"\` / \`"js"\`（脚本沙箱）
- \`function\` 模式（调用 server export 方法）
- 命令白名单 / 沙箱隔离
`,
  sources: {
    program: programSource,
  },
};
