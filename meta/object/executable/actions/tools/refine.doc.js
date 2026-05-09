import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as refineSource from "@src/executable/tools/refine";

export const refine_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`refine\` 用于向已有 form 累积 / 修改参数。

\`\`\`
refine(
  form_id="…",               // 必填，open 返回的 form id
  args: {...}                    // 任意键值对，按 form 的 command schema 累积
)
\`\`\`

## 行为

1. 找到 form_id 对应的 ActiveForm
2. 把 args 合并到 form（同名键覆盖）
3. 重新根据参数计算激活的 command path
4. 若激活路径发生改变（如初始 \`open(command=talk)\` 仅激活 \`talk\` 路径，refine 加了 \`context="continue"\` 后多激活 \`talk.continue\` 路径），增量激活对应的 knowledge

## 为什么 refine 是单独的原语

把"填参数"和"执行"分开，让 LLM 可以：

- **分步思考**：第一次 refine 只填部分参数，看激活了哪些新 knowledge，再决定剩余参数
- **观察渐进披露**：每次 refine 都会触发 path → knowledge 重新计算，对话过程中 Context 动态变化
- **撤销前修正**：发现 args 写错了，再 refine 一次覆盖，无需 close 重开

## refine 的副作用：knowledge 增量加载

\`\`\`
open(command=talk, description="…")               → 路径=[talk]
                                                     激活: kernel:talkable
refine(form_id, { target: "user", msg: "..." })   → 路径=[talk]（不变）
                                                     无新增激活
refine(form_id, { context: "continue" })          → 路径=[talk, talk.continue]
                                                     若有 knowledge 声明
                                                     show_content_when: ["talk.continue"]
                                                     则被激活
\`\`\`

每次激活变化，会在 Context 的 process events 中 inject 一条提示，
让 LLM 知道"我刚才的 refine 让 X knowledge 加入了视野"。
`,
  sources: {
    refine: refineSource,
  },
};
