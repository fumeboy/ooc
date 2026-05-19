import type { Concept, DocNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as refineSource from "@src/executable/tools/refine";

/* ────────────────────────────────────────────────────────────────
 *  目录页：refine 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * refine 概念：向已有 form 累积 / 修改参数；不执行 command。
 *
 * sources:
 *  - refine — handleRefineTool 实现
 */
export type RefineConcept = Concept & {
  sources: { refine: typeof refineSource };

  /** refine 单次调用执行的 4 个步骤 */
  behaviorSteps: {
    title: string;
    summary?: string;
    /** Step 1：按 form_id 定位 command_exec window */
    findForm: DocNode;
    /** Step 2：把 form_args 浅合并到 accumulatedArgs */
    mergeArgs: DocNode;
    /** Step 3：重新计算激活的 command path 集合 */
    recomputePaths: DocNode;
    /** Step 4：对新增路径触发 knowledge 激活 */
    incrementalActivate: DocNode;
  };

  /** 把"填参数"与"执行"分开的 3 个收益 */
  separationRationale: {
    title: string;
    summary?: string;
    /** 分步思考：先填一部分看激活什么 */
    stepwiseThinking: DocNode;
    /** 渐进披露：context 动态变化 */
    progressiveDisclosure: DocNode;
    /** 撤销前修正：发现写错再 refine 覆盖 */
    inFlightCorrection: DocNode;
  };

  /** refine 触发的 knowledge 增量加载机制 */
  knowledgeIncrement: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const refine_v20260506_1: RefineConcept = {
  name: "Refine",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { refine: refineSource },
  description: `
refine 向已有 form 累积 / 修改参数；不执行 command。

\`\`\`
refine(
  form_id="…",            // 必填，open 返回的 form id
  form_args: {...}        // 任意键值对，按 form 的 command schema 累积
)
\`\`\`

协议约束：
- 业务参数必须放在 form_args 对象里
- 不要把业务参数展开到 tool 顶层
- refine 只补参数，不执行 command
`.trim(),

  behaviorSteps: {
    title: "执行步骤",
    summary: "refine 单次调用按顺序执行 4 步；任一步骤抛错则 form 状态保持不变",

    findForm: {
      title: "Step 1 定位 form",
      content: `
按 form_id 在 thread.contextWindows 中定位 command_exec window。
找不到 → reject。
      `.trim(),
    },

    mergeArgs: {
      title: "Step 2 浅合并 args",
      content: `
把 form_args 浅合并到 form.accumulatedArgs（同名键覆盖）。
不做深 merge——嵌套对象整体替换。
      `.trim(),
    },

    recomputePaths: {
      title: "Step 3 重算 path",
      content: `
根据合并后的 accumulatedArgs 重新计算激活的 command path 集合。
路径计算逻辑由 command 自身定义（如 talk command 在 context="continue" 时
追加 talk.continue 路径）。
      `.trim(),
    },

    incrementalActivate: {
      title: "Step 4 增量激活 knowledge",
      content: `
对比新旧路径集合，对新增路径触发 knowledge 激活并写入 inject 事件，
让 LLM 在下一轮看到"我刚才的 refine 让 X knowledge 加入了视野"。
      `.trim(),
    },
  },

  separationRationale: {
    title: "拆分收益",
    summary: "为什么 refine 是独立原语而不与 submit 合并",

    stepwiseThinking: {
      title: "分步思考",
      content: `
第一次 refine 只填部分参数，看激活了哪些新 knowledge，再决定剩余参数。
      `.trim(),
    },

    progressiveDisclosure: {
      title: "渐进披露",
      content: `
每次 refine 都会触发 path → knowledge 重新计算，对话过程中 Context 动态变化。
      `.trim(),
    },

    inFlightCorrection: {
      title: "撤销前修正",
      content: `
发现 args 写错了，再 refine 一次覆盖，无需 close 重开。
      `.trim(),
    },
  },

  knowledgeIncrement: {
    title: "knowledge 增量加载",
    summary: "演示路径与激活随 refine 演化的典型序列",
    content: `
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
对 program.function 这种 method-aware 路径，refine 还会重新抓取当前 method
knowledge——function 名称或 args 改变后，下一轮看到的方法说明同步变化。
    `.trim(),
  },
};
