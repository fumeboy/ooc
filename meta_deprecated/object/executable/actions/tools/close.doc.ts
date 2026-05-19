import type { Concept, DocNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as closeSource from "@src/executable/tools/close";

/* ────────────────────────────────────────────────────────────────
 *  目录页：close 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * close 概念：关闭一个已 open 的 ContextWindow。
 *
 * sources:
 *  - close — handleCloseTool 实现
 */
export type CloseConcept = Concept & {
  sources: { close: typeof closeSource };

  /** reason 为什么强制必填 */
  reasonRequired: DocNode;

  /** close 覆盖的 window 类型范围与级联规则 */
  scope: {
    title: string;
    summary?: string;
    /** 可以被 close 的 window 类型集合 */
    coveredTypes: DocNode;
    /** 父窗口关闭时子窗口一并关闭 */
    cascadeClose: DocNode;
    /** close 减少 knowledge 引用计数 */
    knowledgeRefCount: DocNode;
  };

  /** 不同 window 类型注册的 onClose 副作用 */
  onCloseHooks: {
    title: string;
    summary?: string;
    /** do_window 关闭时归档子线程 */
    doWindowArchive: DocNode;
    /** 子线程不能 close 指向 creator 的 do_window */
    creatorDoReject: DocNode;
  };

  /** command_exec form 成功 submit 后自动移除 */
  formExecAutoRemove: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const close_v20260506_1: CloseConcept = {
  name: "Close",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { close: closeSource },
  description: `
close 关闭一个已 open 的 ContextWindow。

\`\`\`
close(
  window_id="…",            // 必填，同时支持 form_id 作为兼容别名
  reason="…"                // 必填，简短解释为什么关闭
)
\`\`\`
`.trim(),

  reasonRequired: {
    title: "reason 强制必填",
    summary: "防止反复 open → close 振荡时无法回溯原因",
    content: `
reason 强制必填，避免 LLM 反复 open → close → open → close 振荡而不留下原因。
reason 帮助下一轮 LLM 理解"上一轮我为什么放弃了这个行动"。
    `.trim(),
  },

  scope: {
    title: "适用范围",
    summary: "close 覆盖的 ContextWindow 类型与级联规则",

    coveredTypes: {
      title: "覆盖的 window 类型",
      content: `
任意 ContextWindow 都可被 close：command_exec / do / todo / talk / file /
knowledge / search / program。
window_id 与 form_id 入参等价，前者是统一形态、后者是 command_exec form
的兼容写法。
      `.trim(),
    },

    cascadeClose: {
      title: "级联关闭",
      content: `
关闭一个 window 时，挂在其下的所有 sub-window 也一并关闭。
典型例子：close 一个 do_window，其下的 command_exec sub-window 也随之释放。
      `.trim(),
    },

    knowledgeRefCount: {
      title: "knowledge 引用计数释放",
      content: `
close 会减少该 window 引用的 knowledge 计数；
若 knowledge 不再被其他活跃 window 引用且未 pinned → 卸载出 Context。
      `.trim(),
    },
  },

  onCloseHooks: {
    title: "onClose 钩子",
    summary: "不同 window 类型在 close 时注册不同 onClose hook",

    doWindowArchive: {
      title: "do_window onClose",
      content: `
do_window 关闭时归档子线程对话（B=ii archive）：
子线程不再继续 think，历史保留供后续回看。
      `.trim(),
    },

    creatorDoReject: {
      title: "creator do_window onClose",
      content: `
子线程持有的指向父的 creator do_window 不允许 close——
LLM 触发 close 时直接 reject 并写一条 inject 提示。
      `.trim(),
    },
  },

  formExecAutoRemove: {
    title: "command_exec form 自动移除",
    summary: "成功 submit 后系统自动从 contextWindows 移除，不需要显式 close",
    content: `
command_exec form 成功 submit 后系统自动从 contextWindows 移除，**不需要显式 close**；
失败保留 status=executed + result，等 LLM 主动 close 释放。
这条规则让"已成功的行动"不留尾，避免 active_forms 无限增长。
    `.trim(),
  },
};
