import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as talkSource from "@src/executable/commands/talk";

export const talk_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`talk\` 用于开启一个对外会话窗口（talk_window）。
Step 2（spec 2026-05-14）后，talk 不直接发消息——发消息走 talk_window 上注册的 \`say\` command。

## 调用形式

\`\`\`
open(command="talk", title="发布计划确认", args={
  target: "user",          // 必填，当前阶段仅 "user"
  title:  "发布计划确认"   // 必填，多窗口区分用
})
\`\`\`

> args 给齐时 C 规则触发自动 submit，无需 refine/submit。

submit 副作用：在 thread.contextWindows 下挂一个 type=talk 的 window
（target=user, conversationId=windowId）。**允许同 target 多开**。

## talk_window 的注册命令

| command | 行为 |
|---|---|
| say     | 写一条消息到 thread.outbox（source=talk, windowId=本 window）；可选 wait=true 进 waiting |
| wait    | 不发消息，仅父线程进入 status="waiting" 等对端回复 |
| close   | 释放 window；不影响 user 端（user 端无对应运行实体） |

例：

\`\`\`
open(parent_window_id="<talk_window_id>", command="say", args={ msg: "明天发布可以吗？", wait: true })
\`\`\`

## wait 语义

Step 1 起 waitingType 字段已取消，唤醒条件统一为 thread.inbox 出现新消息。
对端回复进入 inbox 即可触发唤醒。

## user 回复路由

control plane 的 user-reply API（POST /api/flows/.../continue）接受可选 \`targetWindowId\`：
- 用户在 UI 上选择回复某个 talk_window 时，前端把该 window id 作为 targetWindowId 传入
- 后端把新消息写入 thread.inbox，携带 \`replyToWindowId = targetWindowId\`
- render 层据此把消息归入对应 talk_window 的 transcript

## Path 列表（root.talk）

\`\`\`
talk
\`\`\`

## Path 列表（talk_window 上）

\`\`\`
say
say.wait
wait
close
\`\`\`

## 阶段限制

- target 当前仅支持 "user"；其它 target 在 root.talk 阶段会被拒绝
- 跨 object talk 留待后续阶段引入
- user 不是普通 object，没有自己的 thread；回复路径靠 control plane 显式投递
`,
  sources: {
    talk: talkSource,
  },
};
