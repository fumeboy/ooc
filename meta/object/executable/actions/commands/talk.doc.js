import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as talkSource from "@src/executable/windows/root/talk";

export const talk_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Talk",
  sources: { talk: talkSource },
  description: `
talk 开启一个对外会话窗口（talk_window）；不直接发消息——发消息走 talk_window 上
注册的 say command。

按子字段展开：

- callShape — root.talk 的调用形态
- submitEffects — submit 副作用与多开规则
- talkWindowCommands — talk_window 上的 say / wait / close
- waitSemantics — talk_window 的 wait 语义与唤醒规则
- userReplyRouting — control plane user-reply API 的路由规则
- pathList — root.talk 与 talk_window 的 path 列表
- targetConstraints — 当前 target 限制
`,

  callShape: {
    title: "call Shape",
    content: `

open(command="talk", title="发布计划确认", args={
  target: "user",          // 必填，当前阶段仅 "user"
  title:  "发布计划确认"   // 必填，多窗口区分用
})


args 给齐时 open 立即提交 form，无需 refine/submit。
    `,
  },

  submitEffects: {
    title: "submit Effects",
    content: `
submit 在 thread.contextWindows 下挂一个 type=talk 的 window
（target=user, conversationId=windowId）。

**允许同 target 多开**——同一对象与同一对端可有多个并行话题，
每个 talk_window 用 title 区分。
    `,
  },

  talkWindowCommands: {
    title: "talk Window Commands",
    content: `
talk_window 上注册的 3 个 sub-command。
    `,

    sayCmd: {
      title: "say",
      content: `
写一条消息到 thread.outbox（source=talk, windowId=本 window）；
可选 wait=true 让父线程进入 waiting。


open(parent_window_id="<talk_window_id>", command="say",
     args={ msg: "明天发布可以吗？", wait: true })

      `,
    },

    waitCmd: {
      title: "wait",
      content: `
不发新消息，仅让父线程进入 status="waiting" 等对端回复。
      `,
    },

    closeCmd: {
      title: "close",
      content: `
释放 window；不影响 user 端（user 端无对应运行实体）。
      `,
    },
  },

  waitSemantics: {
    title: "wait Semantics",
    content: `
talk_window 的 wait 唤醒条件统一为 thread.inbox 出现新消息——
没有独立 waitingType 字段。对端回复进入 inbox 即触发唤醒。
    `,
  },

  userReplyRouting: {
    title: "user Reply Routing",
    content: `
control plane 的 user-reply API（POST /api/flows/.../continue）接受可选
targetWindowId，把 user 回复路由到指定 talk_window。
    `,

    frontendChoosesWindow: {
      title: "前端选择回复窗口",
      content: `
用户在 UI 上选择回复某个 talk_window 时，前端把该 window id 作为
targetWindowId 传入 user-reply API。
      `,
    },

    backendInboxWrite: {
      title: "后端 inbox 写入",
      content: `
后端把新消息写入 thread.inbox，携带 replyToWindowId = targetWindowId。
      `,
    },

    renderGrouping: {
      title: "render 层归并",
      content: `
render 层据 replyToWindowId 把消息归入对应 talk_window 的 transcript。
      `,
    },
  },

  pathList: {
    title: "path List",
    content: `
root.talk 与 talk_window 的 command path 列表。
    `,

    rootTalkPaths: {
      title: "root.talk",
      content: `

talk

      `,
    },

    talkWindowPaths: {
      title: "talk_window",
      content: `

say
say.wait
wait
close

      `,
    },
  },

  targetConstraints: {
    title: "target Constraints",
    content: `
当前 target 范围与限制：

- target 当前仅支持 "user"；其它 target 在 root.talk 阶段会被拒绝
- 跨 object talk 在 root.talk 范围之外，由其他通信机制承载
- user 不是普通 object，没有自己的 thread；回复路径靠 control plane 显式投递
    `,
  },
};
