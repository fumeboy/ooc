import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as submitSource from "@src/executable/tools/submit";

export const submit_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`submit\` 用于提交一个已 open 的 form，触发对应 command 执行。

\`\`\`
submit(
  form_id="…"                // 必填，open 返回的 form id
)
\`\`\`

**submit 不接受新参数**——所有参数必须通过此前的 refine（或 open 时填充的 args）累积完成。
这强制 LLM 在执行前完整审视参数。

## 行为

所有可提交的 form 都来自 \`open(type=command)\`：

1. submit 把 form 标记为完成、从 context 移出
2. 该 form 引入的 knowledge：若不再被其他活跃 form 命中、且未 pinned（主动 open 的 knowledge 标记为 pinned），自动移出 context
3. 提交执行 form 内容；若该 command 是 \`todo\`，则视为"该待办已完成"

## 与 refine 的协作

典型流程：

\`\`\`
open(type=command, command=program, description="写一段代码读文件")
  → form_id = "f_001"
  → 临时激活 program 相关 knowledge

refine(form_id="f_001", language="ts", code="const data = await readFile('foo.txt'); print(data);")
  → 累积 args

submit(form_id="f_001")
  → 执行 program command
  → 执行 ts 代码
  → form 关闭
  → 因为 open command 临时加载的 knowledge 卸载（若无其他 program form 在）
\`\`\`
`,
  sources: {
    submit: submitSource,
  },
};
