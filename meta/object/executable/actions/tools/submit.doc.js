import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as submitSource from "@src/executable/tools/submit";

export const submit_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Submit",
  get description() { return this.index; },
  index: `
\`submit\` 用于提交一个已 open 的 form，触发对应 command 执行。

\`\`\`
submit(
  form_id="…"                // 必填，open 返回的 form id
)
\`\`\`

**submit 不接受新的业务参数**——所有业务参数必须通过此前的 refine（或 open 时填充的 args）累积完成。
这强制 LLM 在执行前完整审视参数。

协议约束：
- 如果 form 还缺业务参数，先 \`refine(form_id, args={...})\`
- 不要把 \`language / code / function\` 等业务参数塞进 submit

## 行为

所有可提交的 form 都来自 \`open(type=command)\`：

1. submit 把 form 状态从 \`open\` 切到 \`executing\`，**form 仍保留在 active_forms** 中
2. 系统执行 command，把返回字符串写入 \`form.result\`，状态切到 \`executed\`
3. LLM 在下一轮 context 中能直接看到 \`<form status="executed"><result>…</result></form>\`，看完后用 \`close\` 显式释放
4. \`close\` 触发时再卸载该 form 引入的 knowledge（若不再被其他活跃 form 命中、且未 pinned）
5. 若该 command 是 \`todo\`，则 executed 状态视为"该待办已完成"

当前实现还有两个边界：

- submit 内部会把 form 的 accumulatedArgs 与 tool 顶层参数合并后再交给 command，因此 command 侧可能看到 \`title\` / \`mark\` / \`form_id\` 这类 tool 元参数。
- submit 不会替 command 预校验“业务参数是否完整”；很多 command 在参数不全时会返回提示字符串作为 result，而不是直接阻止 submit。

## 与 refine 的协作

典型流程：

\`\`\`
open(type=command, command=program, description="写一段代码读文件")
  → form_id = "f_001"
  → 临时激活 program 相关 knowledge

refine(form_id="f_001", form_args={ language="ts", code="const data = await readFile('foo.txt'); print(data);" })
  → 累积 args

submit(form_id="f_001")
  → form 切到 executing，inject "[form executing] formId=f_001 ..."
  → 执行 program command（如 shell mode 跑 sh -c code）
  → form 切到 executed，result 字段写入命令输出
  → inject "[form executed] formId=f_001 + 提醒：等到下一轮 think 再读 <result>，
     同一轮立即 close 会让 result 随 form 一并消失"

close(form_id="f_001", reason="结果已读取")
  → form 真正离开 active_forms
  → 临时加载的 knowledge 卸载（若无其他 program form 在）
\`\`\`
`,
  sources: {
    submit: submitSource,
  },
};
