import type { Concept, DocNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as submitSource from "@src/executable/tools/submit";

/* ────────────────────────────────────────────────────────────────
 *  目录页：submit 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * submit 概念：提交一个已 open 的 form，触发对应 command 执行。
 *
 * sources:
 *  - submit — handleSubmitTool 实现
 */
export type SubmitConcept = Concept & {
  sources: { submit: typeof submitSource };

  /** 与 refine 的职责边界约束 */
  protocolConstraints: DocNode;

  /** submit 内部的 5 步执行流程 */
  executionPipeline: {
    title: string;
    summary?: string;
    /** Step 1：form 状态从 open 切到 executing */
    statusToExecuting: DocNode;
    /** Step 2：执行 command 业务逻辑 */
    executeCommand: DocNode;
    /** Step 3：form 状态切到 executed */
    statusToExecuted: DocNode;
    /** Step 4：result 在下一轮 context 可见 */
    resultVisibility: DocNode;
    /** Step 5：close 时卸载相关 knowledge */
    closeAndUnload: DocNode;
  };

  /** 实现层面的两条边界 */
  runtimeBoundaries: {
    title: string;
    summary?: string;
    /** 顶层参数与 accumulatedArgs 合并 */
    paramMerge: DocNode;
    /** submit 不预校验业务参数完整性 */
    noPreValidation: DocNode;
  };

  /** 与 refine / close 协作的典型流程 */
  typicalFlow: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const submit_v20260506_1: SubmitConcept = {
  name: "Submit",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { submit: submitSource },
  description: `
submit 提交一个已 open 的 form，触发对应 command 执行。

\`\`\`
submit(
  form_id="…"             // 必填，open 返回的 form id
)
\`\`\`

**submit 不接受新的业务参数**——所有业务参数必须通过此前的 refine（或 open 时
填充的 args）累积完成。这强制 LLM 在执行前完整审视参数。
`.trim(),

  protocolConstraints: {
    title: "协议约束",
    summary: "submit 与 refine 的职责边界",
    content: `
- 如果 form 还缺业务参数，先 refine(form_id, args={...})
- 不要把 language / code / function 等业务参数塞进 submit
- submit 只接 form_id；其它顶层参数（如 title / mark）属 tool 元参数
    `.trim(),
  },

  executionPipeline: {
    title: "执行流程",
    summary: "submit 触发的 5 步流程；所有可提交的 form 都来自 open(type=command)",

    statusToExecuting: {
      title: "Step 1 切 executing",
      content: `
form 状态从 open 切到 executing；form 仍保留在 active_forms 中可见。
inject 一条 [form executing] formId=... 让 LLM 知道这一轮 form 状态变化。
      `.trim(),
    },

    executeCommand: {
      title: "Step 2 执行 command",
      content: `
系统按 command 实现执行业务，把返回字符串写入 form.result。
不同 command 的执行行为见 actions/commands 下各自子文档。
      `.trim(),
    },

    statusToExecuted: {
      title: "Step 3 切 executed",
      content: `
form 状态切到 executed，inject 一条 [form executed] formId=... 提示。
该 inject 附带提醒：等到下一轮 think 再读 <result>，同一轮立即 close 会让
result 随 form 一并消失。
      `.trim(),
    },

    resultVisibility: {
      title: "Step 4 result 可见",
      content: `
LLM 在下一轮 context 中能直接看到 <form status="executed"><result>…</result></form>，
看完后用 close 显式释放。
      `.trim(),
    },

    closeAndUnload: {
      title: "Step 5 close 卸载",
      content: `
close 触发时卸载该 form 引入的 knowledge（若不再被其他活跃 form 命中、且未 pinned）。
若该 command 是 todo，则 executed 状态视为"该待办已完成"。
      `.trim(),
    },
  },

  runtimeBoundaries: {
    title: "运行时边界",
    summary: "影响 command 编写时的参数处理与缺参兜底",

    paramMerge: {
      title: "顶层参数与 accumulatedArgs 合并",
      content: `
submit 内部把 form.accumulatedArgs 与 tool 顶层参数合并后再交给 command，
因此 command 侧可能看到 title / mark / form_id 这类 tool 元参数。
command 实现需要自己区分"业务参数"和"tool 元参数"。
      `.trim(),
    },

    noPreValidation: {
      title: "不预校验业务参数完整性",
      content: `
submit 不替 command 预校验"业务参数是否完整"；很多 command 在参数不全时会
返回提示字符串作为 result，而不是直接阻止 submit。
      `.trim(),
    },
  },

  typicalFlow: {
    title: "典型流程",
    summary: "open → refine → submit → close 的完整调用序列",
    content: `
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
    `.trim(),
  },
};
