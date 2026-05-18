import type { Concept, DocNode } from "@meta/doc-types";
import * as executable from "@src/executable/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：渐进式披露 7 步流程 + 设计意图
 * ──────────────────────────────────────────────────────────────── */

/**
 * ProgressiveDisclosure 概念：context 每一刻只装载"当前必需"的知识。
 *
 * sources:
 *  - executable — collectExecutableKnowledgeEntries 把 protocol/activator/explicit
 *    三类 knowledge 合成为 KnowledgeWindow 的入口
 */
export type ProgressiveDisclosureConcept = Concept & {
  sources: { executable: typeof executable };

  /** 典型行动序列的 7 个步骤 */
  flow: DocNode & {
    step1Open: DocNode;
    step2KnowledgeEntry: DocNode;
    step3Refine: DocNode;
    step4ActivatorExpansion: DocNode;
    step5Submit: DocNode;
    step6Success: DocNode;
    step7Failure: DocNode;
  };

  /** 设计意图：只装载"当前必需"知识 */
  designIntent: DocNode;

  /** submit 副作用产出的 4 类持久 window */
  windowKindsProduced: DocNode & {
    doWindow: DocNode;
    talkWindow: DocNode;
    programWindow: DocNode;
    typedSideEffectWindows: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const progressive_disclosure_v20260515_1: ProgressiveDisclosureConcept = {
  name: "ProgressiveDisclosure",
  sources: { executable },
  description: `
整个行动机制围绕渐进式披露设计：意图通过 open 表达 → 知识进入 context → LLM 在已知
信息基础上 refine → submit 执行。
`.trim(),

  flow: {
    title: "典型行动序列",
    summary: "7 步流程：open → knowledge → refine → activator → submit → 成败分支",

    step1Open: {
      title: "step1 open",
      summary: "open(parent_window_id?, command, args?) 表达意图",
      content: `
open(parent_window_id?, command=X, args?) 表达意图，分配 form_id。
若 args 给齐且满足 auto-submit 条件，open 立即提交 form 而无需再额外 submit
（详见 commandExecLifecycle.autoSubmitRule）。
      `.trim(),
    },

    step2KnowledgeEntry: {
      title: "step2 knowledge entry",
      summary: "新 form 触发 entry.knowledge() 派生条目",
      content: `
新 form 触发 entry.knowledge(args, "open") 派生条目，并把 form 持有的
commandKnowledgePaths 记入 knowledge 引用计数。LLM 下一轮即看到完整 API、注意事项、示例。
      `.trim(),
    },

    step3Refine: {
      title: "step3 refine",
      summary: "refine(form_id, args) 在已知信息基础上累积参数",
      content: `
refine(form_id, args) 在已知信息基础上累积参数。可多次调用；每次都重算
accumulatedArgs 与 commandPaths。
      `.trim(),
    },

    step4ActivatorExpansion: {
      title: "step4 activator expansion",
      summary: "新 commandPath 触发 activator 增量激活",
      content: `
refine 触发新的 commandPath 时，下一轮 computeActivations 命中更多 stones knowledge，
增量激活进 context（详见 knowledgeActivation.sources.activator）。
      `.trim(),
    },

    step5Submit: {
      title: "step5 submit",
      summary: "submit(form_id) 执行；切到 executing 状态",
      content:
        'LLM 想清楚后 submit(form_id) 执行；form 切到 executing 状态，跑 entry.exec(ctx)。',
    },

    step6Success: {
      title: "step6 success",
      summary: "form 自动移除；新产出 window 挂在 root 下",
      content: `
成功完成 → form 自动从 contextWindows 移除；若 command 产出新 window（do_window / todo_window /
file_window 等），新 window 挂在 root 下。
      `.trim(),
    },

    step7Failure: {
      title: "step7 failure",
      summary: "form 保留 executed + result，等 LLM 显式 close",
      content: `
失败 → form 保留 status="executed" + result 字段，等 LLM 显式 close 清理。
失败判定见 commandExecLifecycle.failureDetection。
      `.trim(),
    },
  },

  designIntent: {
    title: "设计意图",
    summary: "context 每一刻只装载'当前必需'的知识",
    content: `
context 每一刻只装载"当前必需"的知识，而不是预先塞满所有可能用到的能力描述。
具体落地由 collectExecutableKnowledgeEntries 把 protocol / activator / explicit
三类合成为 KnowledgeWindow（详见 knowledgeActivation）。
    `.trim(),
  },

  windowKindsProduced: {
    title: "submit 产出 window",
    summary: "submit 副作用产出的 4 类持久 window",

    doWindow: {
      title: "doWindow",
      summary: "root.do submit 产出；fork 子线程的对话窗口",
      content: "root.do submit 产出；fork 子线程的对话窗口。",
    },

    talkWindow: {
      title: "talkWindow",
      summary: "root.talk submit 产出；跨对象会话窗口",
      content: "root.talk submit 产出；跨对象会话窗口。",
    },

    programWindow: {
      title: "programWindow",
      summary: "root.program submit 产出；首次 exec 已跑完",
      content: "root.program submit 产出；首次 exec 已在 submit 时跑完。",
    },

    typedSideEffectWindows: {
      title: "typedSideEffectWindows",
      summary: "root.todo / open_file / open_knowledge / glob / grep 直建 typed window",
      content:
        "root.todo / root.open_file / root.open_knowledge / root.glob / root.grep 通过 insertTypedWindow 直建 todo / file / knowledge / search window。",
    },
  },
};
