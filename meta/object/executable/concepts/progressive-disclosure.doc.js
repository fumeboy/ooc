import * as executable from "@src/executable/index";

/**
 * 渐进式披露概念：context 每一刻只装载"当前必需"的知识。
 *
 * sources:
 *  - executable — collectExecutableKnowledgeEntries 把 protocol/activator/explicit
 *    三类 knowledge 合成为 KnowledgeWindow 的入口
 */
export const progressive_disclosure_v20260515_1 = {
  name: "ProgressiveDisclosure",
  description: `整个行动机制围绕渐进式披露设计：意图通过 open 表达 → 知识进入 context → LLM 在已知信息基础上 refine → submit 执行。`,
  sources: { executable },

  flow_v20260517_1: {
    index: `典型行动序列的 7 个步骤；每步独立子节点。`,

    step1Open_v20260517_1: {
      index: `
##### step1Open

\`open(parent_window_id?, command=X, args?)\` 表达意图，分配 form_id。
若 args 给齐且满足 auto-submit 条件，open 立即提交 form 而无需再额外 submit
（详见 \`commandExecLifecycle.autoSubmitRule\`）。
`.trim(),
    },

    step2KnowledgeEntry_v20260517_1: {
      index: `
##### step2KnowledgeEntry

新 form 触发 \`entry.knowledge(args, "open")\` 派生条目，并把 form 持有的
\`commandKnowledgePaths\` 记入 knowledge 引用计数。LLM 下一轮即看到完整 API、注意事项、示例。
`.trim(),
    },

    step3Refine_v20260517_1: {
      index: `
##### step3Refine

\`refine(form_id, args)\` 在已知信息基础上累积参数。可多次调用；每次都重算
\`accumulatedArgs\` 与 \`commandPaths\`。
`.trim(),
    },

    step4ActivatorExpansion_v20260517_1: {
      index: `
##### step4ActivatorExpansion

refine 触发新的 commandPath 时，下一轮 \`computeActivations\` 命中更多 stones knowledge，
增量激活进 context（详见 \`knowledgeActivation.sources.activator\`）。
`.trim(),
    },

    step5Submit_v20260517_1: {
      index: `
##### step5Submit

LLM 想清楚后 \`submit(form_id)\` 执行；form 切到 executing 状态，跑 \`entry.exec(ctx)\`。
`.trim(),
    },

    step6Success_v20260517_1: {
      index: `
##### step6Success

成功完成 → form 自动从 contextWindows 移除；若 command 产出新 window（do_window / todo_window /
file_window 等），新 window 挂在 root 下。
`.trim(),
    },

    step7Failure_v20260517_1: {
      index: `
##### step7Failure

失败 → form 保留 \`status="executed"\` + \`result\` 字段，等 LLM 显式 close 清理。
失败判定见 \`commandExecLifecycle.failureDetection\`。
`.trim(),
    },
  },

  designIntent_v20260517_1: {
    index: `
context 每一刻只装载"当前必需"的知识，而不是预先塞满所有可能用到的能力描述。
具体落地由 \`collectExecutableKnowledgeEntries\` 把 protocol / activator / explicit
三类合成为 KnowledgeWindow（详见 \`knowledgeActivation\`）。
`.trim(),
  },

  windowKindsProduced_v20260517_1: {
    index: `submit 副作用产出的持久 window 4 类，挂在 root 下；详见各 \`windows.*\` 概念。`,

    doWindow_v20260517_1: {
      index: `##### doWindow — root.do submit 产出；fork 子线程的对话窗口。`,
    },

    talkWindow_v20260517_1: {
      index: `##### talkWindow — root.talk submit 产出；跨对象会话窗口。`,
    },

    programWindow_v20260517_1: {
      index: `##### programWindow — root.program submit 产出；首次 exec 已在 submit 时跑完。`,
    },

    typedSideEffectWindows_v20260517_1: {
      index: `##### typedSideEffectWindows — root.todo / root.open_file / root.open_knowledge / root.glob / root.grep 通过 \`insertTypedWindow\` 直建 todo / file / knowledge / search window。`,
    },
  },
};
