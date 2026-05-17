import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as refineSource from "@src/executable/tools/refine";

export const refine_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Refine",
  sources: { refine: refineSource },
  description: `
\`refine\` 向已有 form 累积 / 修改参数；不执行 command。

\`\`\`
refine(
  form_id="…",            // 必填，open 返回的 form id
  form_args: {...}        // 任意键值对，按 form 的 command schema 累积
)
\`\`\`

协议约束：
- 业务参数必须放在 \`form_args\` 对象里
- 不要把业务参数展开到 tool 顶层
- refine 只补参数，不执行 command

按子字段展开：

- behaviorSteps — refine 单次调用执行的 4 个步骤
- separationRationale — 把"填参数"与"执行"分开的 3 个收益
- knowledgeIncrement — refine 触发的 knowledge 增量加载机制
`.trim(),

  behaviorSteps_v20260517_1: {
    index: `
refine 单次调用按顺序执行 4 个步骤；任一步骤抛错会让 form 状态保持不变。
`.trim(),

    findForm_v20260517_1: {
      index: `
### Step 1 — 找 form

按 form_id 在 \`thread.contextWindows\` 中定位 command_exec window。
找不到 → reject。
`.trim(),
    },

    mergeArgs_v20260517_1: {
      index: `
### Step 2 — 浅合并参数

把 form_args 浅合并到 form.accumulatedArgs（同名键覆盖）。
不做深 merge——嵌套对象整体替换。
`.trim(),
    },

    recomputePaths_v20260517_1: {
      index: `
### Step 3 — 重算激活路径

根据合并后的 accumulatedArgs 重新计算激活的 command path 集合。
路径计算逻辑由 command 自身定义（如 talk command 在 \`context="continue"\` 时
追加 \`talk.continue\` 路径）。
`.trim(),
    },

    incrementalActivate_v20260517_1: {
      index: `
### Step 4 — 增量激活 knowledge

对比新旧路径集合，对新增路径触发 knowledge 激活并写入 inject 事件，
让 LLM 在下一轮看到"我刚才的 refine 让 X knowledge 加入了视野"。
`.trim(),
    },
  },

  separationRationale_v20260517_1: {
    index: `
为什么 refine 是独立原语而不与 submit 合并：把"填参数"和"执行"分开有 3 个收益。
`.trim(),

    stepwiseThinking_v20260517_1: {
      index: `
### 分步思考

第一次 refine 只填部分参数，看激活了哪些新 knowledge，再决定剩余参数。
`.trim(),
    },

    progressiveDisclosure_v20260517_1: {
      index: `
### 渐进披露

每次 refine 都会触发 path → knowledge 重新计算，对话过程中 Context 动态变化。
`.trim(),
    },

    inFlightCorrection_v20260517_1: {
      index: `
### 撤销前修正

发现 args 写错了，再 refine 一次覆盖，无需 close 重开。
`.trim(),
    },
  },

  knowledgeIncrement_v20260517_1: {
    index: `
典型 refine 序列演示路径与激活的演化：

\`\`\`
open(command=talk, description="…")               → 路径=[talk]
                                                     激活: kernel:talkable
refine(form_id, form_args={ target: "user", msg: "..." })   → 路径=[talk]（不变）
                                                     无新增激活
refine(form_id, form_args={ context: "continue" })          → 路径=[talk, talk.continue]
                                                     若 knowledge 声明
                                                     show_content_when: ["talk.continue"]
                                                     则被激活
\`\`\`

每次激活变化会在 Context 的 process events 中 inject 一条提示。
对 \`program.function\` 这种 method-aware 路径，refine 还会重新抓取当前 method
knowledge——function 名称或 args 改变后，下一轮看到的方法说明同步变化。
`.trim(),
  },
};
