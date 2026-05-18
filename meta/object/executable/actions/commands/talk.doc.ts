import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as talkSource from "@src/executable/windows/root/talk";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.talk command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Talk 概念：开启一个对外会话窗口（talk_window）。
 *
 * sources:
 *  - talk — root.talk command 实现
 */
export type TalkConcept = Concept & {
  sources: { talk: typeof talkSource };

  /** root.talk 的调用形态 */
  callShape: DocNode;

  /** submit 副作用与多开规则 */
  submitEffects: DocNode;

  /** talk_window 上的 say / wait / close */
  talkWindowCommands: {
    title: string;
    summary?: string;
    sayCmd: DocNode;
    waitCmd: DocNode;
    closeCmd: DocNode;
  };

  /** talk_window 的 wait 语义与唤醒规则 */
  waitSemantics: DocNode;

  /** control plane user-reply API 的路由规则 */
  userReplyRouting: {
    title: string;
    summary?: string;
    frontendChoosesWindow: DocNode;
    backendInboxWrite: DocNode;
    renderGrouping: DocNode;
  };

  /** root.talk 与 talk_window 的 path 列表 */
  pathList: {
    title: string;
    summary?: string;
    rootTalkPaths: DocNode;
    talkWindowPaths: DocNode;
  };

  /** 当前 target 限制 */
  targetConstraints: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const talk_v20260514_1: TalkConcept = {
  name: "Talk",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { talk: talkSource },
  description: `
talk 开启一个对外会话窗口（talk_window）；不直接发消息——发消息走 talk_window 上
注册的 say command。
`.trim(),

  callShape: {
    title: "调用形态",
    summary: "args 给齐时 open 立即提交 form",
    content: `
\`\`\`
open(command="talk", title="发布计划确认", args={
  target: "user",          // 必填，当前阶段仅 "user"
  title:  "发布计划确认"   // 必填，多窗口区分用
})
\`\`\`

args 给齐时 open 立即提交 form，无需 refine/submit。
    `.trim(),
  },

  submitEffects: {
    title: "submit 副作用",
    summary: "挂 talk_window；允许同 target 多开，title 区分",
    content: `
submit 在 thread.contextWindows 下挂一个 type=talk 的 window
（target=user, conversationId=windowId）。

**允许同 target 多开**——同一对象与同一对端可有多个并行话题，
每个 talk_window 用 title 区分。
    `.trim(),
  },

  talkWindowCommands: {
    title: "talk_window 子命令",
    summary: "talk_window 上注册的 3 个 sub-command",

    sayCmd: {
      title: "say",
      content: `
写一条消息到 thread.outbox（source=talk, windowId=本 window）；
可选 wait=true 让父线程进入 waiting。

\`\`\`
open(parent_window_id="<talk_window_id>", command="say",
     args={ msg: "明天发布可以吗？", wait: true })
\`\`\`
      `.trim(),
    },

    waitCmd: {
      title: "wait",
      content: '不发新消息，仅让父线程进入 status="waiting" 等对端回复。',
    },

    closeCmd: {
      title: "close",
      content: "释放 window；不影响 user 端（user 端无对应运行实体）。",
    },
  },

  waitSemantics: {
    title: "wait 语义",
    summary: "唤醒条件统一为 thread.inbox 出现新消息",
    content: `
talk_window 的 wait 唤醒条件统一为 thread.inbox 出现新消息——
没有独立 waitingType 字段。对端回复进入 inbox 即触发唤醒。
    `.trim(),
  },

  userReplyRouting: {
    title: "user 回复路由",
    summary: "前端选窗 → 后端写 inbox → render 归并",

    frontendChoosesWindow: {
      title: "前端选择回复窗口",
      content: `
用户在 UI 上选择回复某个 talk_window 时，前端把该 window id 作为
targetWindowId 传入 user-reply API。
      `.trim(),
    },

    backendInboxWrite: {
      title: "后端 inbox 写入",
      content: "后端把新消息写入 thread.inbox，携带 replyToWindowId = targetWindowId。",
    },

    renderGrouping: {
      title: "render 层归并",
      content: "render 层据 replyToWindowId 把消息归入对应 talk_window 的 transcript。",
    },
  },

  pathList: {
    title: "command path",
    summary: "root.talk 与 talk_window 各自的 path",

    rootTalkPaths: {
      title: "root.talk",
      content: `
\`\`\`
talk
\`\`\`
      `.trim(),
    },

    talkWindowPaths: {
      title: "talk_window",
      content: `
\`\`\`
say
say.wait
wait
close
\`\`\`
      `.trim(),
    },
  },

  targetConstraints: {
    title: "target 限制",
    summary: "当前仅支持 target=user",
    content: `
当前 target 范围与限制：

- target 当前仅支持 "user"；其它 target 在 root.talk 阶段会被拒绝
- 跨 object talk 在 root.talk 范围之外，由其他通信机制承载
- user 不是普通 object，没有自己的 thread；回复路径靠 control plane 显式投递
    `.trim(),
  },
};
