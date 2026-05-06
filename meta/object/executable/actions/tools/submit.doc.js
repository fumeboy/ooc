import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const submit_v20260506_1 = {
    parent: tools_v20260506_1,
    index: `
\`submit\` 用于提交一个已 open 的 form，触发对应 command 执行。

\`\`\`
submit(
  form_id="…"                // 必填，open 返回的 form id
)
\`\`\`

**submit 不接受新参数**——所有参数必须通过此前的 refine（或 open 时的 args 等价 refine）累积完成。
这强制 LLM 在执行前完整审视参数，避免"边执行边补"。

## 行为

按 form 的 type 分支：

### form 来自 open(type=command)

1. FormManager.submit 把 form 标记为完成、移出活跃集
2. 调 \`COMMAND_TABLE[command].exec(accumulatedArgs)\` 执行
   - command 内部决定如何推进线程状态、写入 events、产生副作用
   - 例：program 执行代码、talk 投递消息、do 派生子线程等
3. 该 form 引入的 knowledge：若不再被其他活跃 form 命中、且未 pinned，自动 deactivate
4. 在 process events 写一条 tool_use 记录

### form 来自 open(type=knowledge / type=file / type=todo)

- knowledge：submit 不适用（这类 form 通过 close 来 unpin/释放）
- file：submit 不适用（同上）
- todo：submit 视为"该待办已完成"，删除 form

## 通用参数

- \`mark\` — 同 [mark](./mark.doc.js)

## 与 refine 的协作

典型流程：

\`\`\`
open(type=command, command=program, description="写一段代码读文件")
  → form_id = "f_001"
  → 激活 kernel:computable

refine(form_id="f_001", code="const data = await readFile('foo.txt'); print(data);")
  → 累积 args.code

submit(form_id="f_001")
  → 执行 program command
  → sandbox 执行代码
  → form 关闭
  → kernel:computable 卸载（若无其他 program form 在）
\`\`\`
`,
};
