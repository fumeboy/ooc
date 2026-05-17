import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as closeSource from "@src/executable/tools/close";

export const close_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Close",
  sources: { close: closeSource },
  description: `
close 关闭一个已 open 的 ContextWindow。


close(
  window_id="…",            // 必填，同时支持 form_id 作为兼容别名
  reason="…"                // 必填，简短解释为什么关闭
)


按子字段展开：

- reasonRequired — reason 为什么强制必填
- scope — close 覆盖的 window 类型范围与级联规则
- onCloseHooks — 不同 window 类型的 onClose 副作用
- formExecAutoRemove — command_exec form 的自动移除规则
`,

  reasonRequired: {
    title: "reason Required",
    content: `
reason 强制必填，避免 LLM 反复 open → close → open → close 振荡而不留下原因。
reason 帮助下一轮 LLM 理解"上一轮我为什么放弃了这个行动"。
    `,
  },

  scope: {
    title: "scope",
    content: `
close 覆盖的 ContextWindow 类型与级联规则。
    `,

    coveredTypes: {
      title: "覆盖的 window 类型",
      content: `
任意 ContextWindow 都可被 close：command_exec / do / todo / talk / file /
knowledge / search / program。
window_id 与 form_id 入参等价，前者是统一形态、后者是 command_exec form
的兼容写法。
      `,
    },

    cascadeClose: {
      title: "级联关闭",
      content: `
关闭一个 window 时，挂在其下的所有 sub-window 也一并关闭。
典型例子：close 一个 do_window，其下的 command_exec sub-window 也随之释放。
      `,
    },

    knowledgeRefCount: {
      title: "knowledge 引用计数释放",
      content: `
close 会减少该 window 引用的 knowledge 计数；
若 knowledge 不再被其他活跃 window 引用且未 pinned → 卸载出 Context。
      `,
    },
  },

  onCloseHooks: {
    title: "on Close Hooks",
    content: `
不同 window 类型在 close 时注册不同 onClose hook。
    `,

    doWindowArchive: {
      title: "do_window onClose",
      content: `
do_window 关闭时归档子线程对话（B=ii archive）：
子线程不再继续 think，历史保留供后续回看。
      `,
    },

    creatorDoReject: {
      title: "creator do_window onClose",
      content: `
子线程持有的指向父的 creator do_window 不允许 close——
LLM 触发 close 时直接 reject 并写一条 inject 提示。
      `,
    },
  },

  formExecAutoRemove: {
    title: "form Exec Auto Remove",
    content: `
command_exec form 成功 submit 后系统自动从 contextWindows 移除，**不需要显式 close**；
失败保留 status=executed + result，等 LLM 主动 close 释放。
这条规则让"已成功的行动"不留尾，避免 active_forms 无限增长。
    `,
  },
};
