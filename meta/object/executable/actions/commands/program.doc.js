import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const program_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`program\` 用于在 sandbox 中执行一段代码 / 调用 Object 的某个 server 方法。

## 调用形式

### 形态 A：执行一段临时代码

\`\`\`
open(type=command, command=program, description="…")
refine(form_id, {
  code: "const data = await readFile('foo.txt'); print(data);",
  language?: "ts" | "js" | "shell"   // 默认 ts
})
submit(form_id)
\`\`\`

### 形态 B：调用 server 方法

\`\`\`
open(type=command, command=program, description="…")
refine(form_id, {
  trait:  "kernel:computable",       // server 模块 id
  method: "readFile",                // 方法名
  args:   { path: "foo.txt" }
})
submit(form_id)
\`\`\`

形态 B 等价于 sandbox 里 \`await callMethod(trait, method, args)\`，但参数更结构化。

## Path 列表

\`\`\`
program                         （bare path，总是激活）
program.shell                   （language === "shell"）
program.method                  （形态 B）
\`\`\`

## 触发的 knowledge

默认激活 \`kernel:computable\`（show_content_when 含 \`program\`）。
其子 knowledge（program_api / file_ops / shell_exec / web_search / code_index）
默认以 description 形式可见，LLM 可显式 \`open(type=knowledge, name=...)\` 加载完整正文。

## 沙箱环境

执行环境提供：
- 路径常量：\`self_dir\` / \`world_dir\` / \`files_dir\` 等只读路径
- 基础 API：\`readFile\` / \`writeFile\` / \`print\` / \`getData\` / \`setData\` 等（始终注入）
- \`callMethod(id, name, args)\` 调用任意已注册 server 方法
- \`talk(target, msg, opts?)\` 同步 / 异步给其他对象发消息

详见 kernel:computable 系列 knowledge。

## 输出与副作用

- \`print(...)\` / \`console.log(...)\` 的输出被收集，作为 program event 写入 thread.events
- 文件写入路径会被记录在 program event 的 written_paths 字段
- 失败时栈记录在 program event 的 error 字段，但**不**自动 fail 整个线程——LLM 决定如何处理
`,
};
