# OOC-4 L5c：talk 塌缩（talk_window → talks.json + window-free deliverMessage）

> ⚠️ **POST-DUAL-REVIEW 修正 scope（必读，原下文设计在此被纠正）**：双路对抗 review 揭示本增量**远比原 plan 大且原方向有致命错**。talk+do 是**并发核心 + 多子系统大改**，建议**专项 fresh 会话**做（深并发核心重写不在长上下文做；关键路径 agent↔agent wait/wake 当前无 e2e 网兜）。修正要点：
> 1. **【致命方向错】跨 object 唤醒在 `src/app/server/runtime/worker.ts:syncCrossObjectCalleeEnds`（:254-325），不在 scheduler**——它遍历 caller 的 `talk_window`（filter type==="talk" && targetThreadId），对每个 callee 检查 done/failed 写 system message 唤醒 caller。**删 talk_window → talkWindows=[] → caller 永久卡死 waiting**。原 plan「不动 scheduler」框定错误。**worker.ts 必须改为从 talks.json 读 peer 路由**（进 File Structure + Task）。scheduler 确实不读 waitingOn（M3 确认），但 wake 的 inbox 新消息部分依赖 worker 的 cross-object end-sync。
> 2. **保留 `TalkWindow` 类型 + `"talk"` WindowType 不删**（reviewer1 C1）：service.ts（HTTP chat 入口 :432/:562/:822 建 TalkWindow + deliverTalkMessage）、relation/index.ts、adapter 都 load-bearing。L5c **只删 talk-window behavior**（registry 注册/render/compress/filter hooks/say/wait/close 方法/root.talk 的 window 创建），**保留 TalkWindow type + delivery**。全类型擦除延后（de-risk C1/C2/C3）。
> 3. **`tools/wait.ts:listValidWaitTargets`（:25-62）硬依赖 talk_window**——删后 LLM wait talk reply 全断 + 误 nudge end。须改 talks.json peer 成合法 wait 候选（进 scope）。
> 4. **callee 回信路由（双向断点）**：deliverMessage 接收方分支须写 `talks.json[caller].targetThreadId = caller thread id`（精确命中，取代 initContextWindows 注入的 creator talk_window 的 targetThreadId）；callee `root.talk(callerObjectId)` 读它路由回 caller。须显式实现 + 单测。
> 5. **deriveRelationWindow（synthesizer.ts:300/336）由 talk_window 播种**（reviewer1 C2）——删 talk_window 会让 active-talk peer 静默丢 relation 注入（越界 L6a）。保留 TalkWindow 类型 + deriveRelationWindow 工作到 L6a（配合要点 2）。
> 6. **talks.json 改 routing-only**（reviewer H1/M2）：inbox **不 drain**（thinkloop 不删 inbox，render.ts:270 fallback 渲染持久 inbox/outbox）——会话历史已在 inbox/outbox。故 talks.json 只存路由 `{[peer]: {targetThreadId, conversationId}}`，**不存 message log**（避双写 + 渲染重复）。自视 talk 切片直接从 inbox/outbox 按 peer 分组渲染（msg 加 peerObjectId 字段或经 conversationId 配对）。
> 7. **pairing 重设计（H2，talk 正确性核心）**：现 resolveCalleeReplyToWindowId + windowId/replyToWindowId 配双向。window-free 后用 conversationId（**不是 peerObjectId 单 key**——同 peer 多会话会串话）；ThreadMessage 加/改字段。talks.json key 定死 = (peerObjectId) 但路由值含 conversationId，或 key=conversationId。
> 8. **前端 formatter.ts:394-411 + service.ts 3 个 user 入口 + reflectable-knowledge.ts:260-299 + super-flow-channel.integration + 多测试** 进 scope（H1/H3/H4）。测试清单用 `rg -l 'TalkWindow|type:\s*"talk"|deliverTalkMessage|window::talk|command::root::talk'` 闭包，非手列。
> 9. **必补 agent↔agent 双向 wait/wake e2e**（A talk B wait=true → B reply/end → A 唤醒）——现 backend-multi-turn-followup 只测 user→assistant 单向，**不覆盖会静默断的 agent↔agent 路径**。
>
> 〔下方原设计保留作专项会话输入，但要点 1/2/6/7 纠正了它：worker.ts 是真 wake、保留 TalkWindow 类型、talks.json routing-only、conversationId 配对。〕

> 执行 sub-agent **不要自己 commit**。复用 L5a/b 自视切片机制 + L5a/b 删 window type 范式。这是**最难类之一**（跨 object + 并发/路由核心）——务必谨慎 + 重 e2e。

**Goal:** talk_window（渲染 + 路由构造 over inbox/outbox + delivery）塌缩为 **`talks.json`**（object-scoped owner flow，持路由 + 持久会话）+ root 方法 `talk(target, content, wait?)`（写 talks.json + window-free 派送）+ 自视 talk 切片。删 talk_window type。wait/wake 复用现 scheduler（**不动 scheduler**）。**附带产出 window-free `deliverMessage`**（解 L6a C2）。

**Architecture（镜像 L5a/b + delivery 重构）**：
- 新增 `src/persistable/flow-talks.ts`：`talks.json` = `{ [peerObjectId]: { targetThreadId, conversationId, messages: TalkMsg[] } }`（持路由 + 会话；serial-queue 写）。
- 重构 `talk/delivery.ts`：`deliverTalkMessage({caller:{thread,talkWindow},...})` → **window-free `deliverMessage({thread, target, conversationId?, targetThreadId?, content, source})`**（research §9 草案）；内部派送/创建 callee/inbox/outbox/状态翻转/notifyThreadActivated **不变**。deliverMessage 额外：append 发送方 talks.json[target] + 接收方 talks.json[caller]（持久会话，独立于 transient inbox）。
- root.talk(target, content, wait?)：读 talks.json[target] 拿路由 → deliverMessage → 回填 targetThreadId/conversationId → 写 talks.json → wait=true 则进 waiting（复用现 inboxSnapshotAtWait/waitingOn + scheduler wakeWaitingThreadsOnInbox，**不动 scheduler**）。
- 自视 talk 切片：renderSelfView 加 `<talks>`（按 peer 分组，最近 N 条，从 talks.json）。
- 删 talk_window type + say/wait/close/set_transcript_window + renderTalkWindow/compressTalkWindow/filterMessagesForTalkWindow + TalkWindow + windows/talk/index.ts（保留 delivery.ts 重构后）。

**基线**（L5b 后）：1094 pass / 0 fail / 3 skip，tsc 0。

---

## 设计决策
### D1 talks.json（object-scoped，持路由 + 持久会话）
`flows/<sid>/objects/<oid>/talks.json` = `{ [peerObjectId]: { targetThreadId?: string; conversationId: string; messages: TalkMsg[] } }`。`TalkMsg = { msgId, role: "out"|"in", content, createdAt }`。
- **为何 talks.json 持久会话而非渲 inbox/outbox**：inbox 是 transient 处理队列（可能被 drain/compress），talks.json 是**持久会话记录**（不依赖 inbox 持久化语义，robust）。**执行前须验证 inbox drain 行为**——若 inbox 不 drain 且持久，可考虑直接渲 inbox/outbox（更省），但默认走 talks.json 持久日志最稳。
- 持路由（targetThreadId/conversationId per peer）= relocate 旧 talk_window 持有的会话路由状态。
- `flow-talks.ts`：readTalks/writeTalks/appendTalkMsg/setRouting（serial-queue）。

### D2 window-free deliverMessage（解 L6a C2）
重构 `talk/delivery.ts`：核心 `deliverMessage({thread, target, conversationId?, targetThreadId?, content, source})`（去 TalkWindow 参数）。内部读 callerWindow 的 target/targetThreadId/id 改为读参数（windowId 缺省生成临时逻辑 id 标记 outbox）。**保留 `deliverTalkMessage(legacy adapter)`** 包装 deliverMessage（供过渡期残留 caller：reflection / 任何未迁的；relation.edit 是 L6a 才迁）。super 路径（SUPER_ALIAS_TARGET）逻辑不变。

### D3 root.talk（替换 talk_window）
ROOT_METHODS `talk: talkCommand`（现创建 window）→ 改为 `talk(target, content, wait?)`：校验 target stone 存在（super 豁免）→ 读 talks.json[target] 路由 → deliverMessage(thread, target, routing.targetThreadId?, content, source:"talk") → 回填路由 + append talks.json → wait=true 则 thread.status="waiting"+inboxSnapshotAtWait+waitingOn（waitingOn 用 conversationId/peer 替代旧 windowId）。in-character knowledge（`internal/executable/talk/basic`）。
- **wait/wake**：复用现 scheduler wakeWaitingThreadsOnInbox（inbox 新消息唤醒，不区分来源——不动 scheduler）。waitingOn 语义：旧用 window.id，新用 peer/conversationId（仅作标记，scheduler 按 inbox 长度唤醒，不读 waitingOn 内容——确认）。

### D4 自视 talk 切片
renderSelfView 加 `renderTalksSlice(thread)`：读 talks.json → 按 peer 分组，每 peer 最近 N 条 → `<self_view><talks><conversation peer=...><msg role=...>...</msg></conversation></talks>`。空→不渲。段序：plan→talks→todos（或合理）。

### D5 删 talk_window（tsc 枚举，**面大**）
- WindowType union 去 `"talk"`；删 `TalkWindow` + generateWindowId 前缀。
- 删 say/wait/close/set_transcript_window（command.say/wait/close/set-transcript-window.ts）+ renderTalkWindow/compressTalkWindow/filterMessagesForTalkWindow/onCloseTalkWindow + TALK_WINDOW_BASIC_KNOWLEDGE + registerWindowType("talk") + REGISTRY.set("talk") 静态 seed + windows/talk/index.ts + windows/index.ts import。**保留 talk/delivery.ts**（重构为 deliverMessage）+ talk/super-constants 等。
- render.ts 的 filterMessagesForTalkWindow 消费点（render.ts:238 consumed.add talk 消息）——改为 talk 消息不再经 window 渲染（自视切片渲）。
- tsc 枚举所有 `type:"talk"`/`TalkWindow`/talkCommand/say/wait/close(talk)/conversationId(window) 引用。

### D6 持久化迁移
旧 thread.json 含 talk_window → dev world 重生（同 L5a/b）。**creator talk_window**（callee 初始注入指向 caller，initContextWindows）——塌缩后 callee 怎么知道回复给谁？→ callee 的 talks.json[caller] 路由（deliverMessage 在 callee 侧也建 talks.json[caller] + targetThreadId=caller thread）。initContextWindows 不再注入 creator talk_window；callee 回复经 root.talk(caller-objectId) 走 talks.json 路由。**这是 talk 塌缩最微妙处，重 e2e 验证双向 round-trip**。

---

## File Structure
```
src/persistable/flow-talks.ts                     # 新增：talks.json（路由+会话）
src/persistable/index.ts                          # 改：export
src/thinkable/context/self-view.ts                # 改：renderSelfView 加 <talks> 切片
src/executable/windows/talk/delivery.ts           # 改：deliverMessage（window-free）+ deliverTalkMessage adapter + 写 talks.json
src/executable/windows/root/command.talk.ts        # 改：talk(target,content,wait?)（写 talks.json + deliverMessage，去 window 创建）
src/executable/windows/root/index.ts              # 改：ROOT_KNOWLEDGE 表（talk 行更新）
src/executable/windows/_shared/types.ts           # 改：WindowType 去 "talk"，删 TalkWindow + 前缀
src/executable/windows/_shared/registry.ts        # 改：删 REGISTRY.set("talk")
src/executable/windows/talk/{index.ts,command.say.ts,command.wait.ts,command.close.ts,command.set-transcript-window.ts}  # 删（保留 delivery.ts/super-constants）
src/executable/windows/index.ts                   # 改：去 import "./talk/index.js"
src/thinkable/context/render.ts                   # 改：去 filterMessagesForTalkWindow 消费（talk 走自视）
src/thinkable/knowledge/basic-knowledge.ts        # 改：scrub talk_window prose + window::talk 触发示例
src/thinkable/scheduler.ts                         # **不动**（wait/wake 复用；仅确认 waitingOn 语义不依赖 window.id）
meta/object.doc.ts                                 # 改：method 表 + talk_window 节点
# 测试迁移 + 新建：talk delivery/wait-wake/cross-object e2e（现无专项单测，须补）；commands/commands-execution/context/thinkloop/relation-write-on-talk.integration（用 talk）/ initContextWindows 相关
```

---

## Task 1：flow-talks 持久化 + 单测
- [ ] flow-talks.ts（talks.json：readTalks/writeTalks/appendTalkMsg/setRouting，serial-queue）+ TalkMsg type + 单测。export。
- [ ] **先验证 inbox drain 行为**（grep thinkloop/scheduler 是否 drain inbox）——决定 talks.json 是否必要 vs 渲 inbox/outbox。默认 talks.json。

## Task 2：window-free deliverMessage（delivery 重构）
- [ ] delivery.ts：抽 `deliverMessage({thread,target,conversationId?,targetThreadId?,content,source})`；deliverTalkMessage 改 adapter 包装。内部 + 写发送方/接收方 talks.json。super 路径不变。
- [ ] 单测：deliverMessage 跨 object 派送（callee inbox + caller outbox + 双方 talks.json）+ super 路径 + 复用 targetThreadId（不重建 callee）。

## Task 3：root.talk + wait/wake
- [ ] command.talk.ts 重写：talk(target,content,wait?)（读路由→deliverMessage→回填→写 talks.json→wait 进 waiting）。ROOT_KNOWLEDGE talk 行更新。
- [ ] 单测：talk 写 talks.json + 派送；wait=true 进 waiting + 回复后 scheduler 唤醒（双向 round-trip）。

## Task 4：自视 talk 切片
- [ ] self-view.ts renderTalksSlice（talks.json→按 peer 最近 N 条）。插 `<self_view>`。单测。

## Task 5：删 talk_window（tsc 枚举，大面）
- [ ] 删 say/wait/close/set-transcript + render/compress/filter/onClose + BASIC_KNOWLEDGE + registerWindowType/REGISTRY.set + windows/talk/index.ts + windows/index.ts import + WindowType "talk" + TalkWindow + 前缀。**保留 delivery.ts/super-constants**。
- [ ] render.ts 去 filterMessagesForTalkWindow 消费。initContextWindows 去 creator talk_window 注入（callee 回复经 talks.json 路由）。
- [ ] basic-knowledge.ts scrub talk prose + window::talk 示例。
- [ ] tsc 枚举补齐。

## Task 6：测试迁移 + 新建 e2e + meta + 回归
- [ ] grep 全 `type:"talk"`/TalkWindow/talkCommand/say|wait|close(talk)/deliverTalkMessage/creator talk 的测试迁移：commands.test（sorted toEqual：talk 仍在但形态变；say/wait/close 不再是 method——核对 ROOT_METHODS 仍含 talk）、commands-execution、context、thinkloop、relation-write-on-talk.integration、initContextWindows 相关、step2-windows（talk 段）。
- [ ] **新建 talk e2e**（现无专项）：cross-object talk round-trip（A talk B，B 回复，A wait→唤醒，双方 talks.json 正确）+ super talk。
- [ ] meta/object.doc.ts：method 表（talk 形态变，count 核对）+ talk_window 节点 + window-type list。tsc 该文件。
- [ ] `bun test src/`（0 fail）、`bun tsc --noEmit`（0）、`bun tsc --noEmit meta/*.doc.ts`、`RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 bun test tests/e2e/backend/route-audit.e2e.test.ts` + 新 talk e2e。

---

## 验证 gate
- [ ] talk(target,content)→talks.json 落盘 + deliverMessage 派送（callee inbox + 双方 talks.json）。
- [ ] wait/wake：talk wait=true 进 waiting，回复后 scheduler 唤醒（双向 round-trip e2e）。
- [ ] deliverMessage window-free（不需 TalkWindow）；deliverTalkMessage adapter 仍工作（过渡 caller）。
- [ ] talk_window type 彻底删（WindowType 无 "talk"，windows/talk/index.ts 删，delivery.ts 保留）。
- [ ] 自视 talk 切片渲染。
- [ ] scheduler 不动 + 现有 do/talk 并发测试不破。
- [ ] bun test src/ 0 fail；tsc 0；meta tsc PASS；route-audit + talk e2e PASS。

## 开放点（feasibility review 核查，**talk 是最难类，重点审**）
1. **inbox drain 行为**：thinkloop 处理 inbox 后是否移除消息？决定 talks.json（持久日志）vs 渲 inbox/outbox。
2. **creator talk_window 删除**：callee 初始不再注入 creator talk_window，回复经 talks.json[caller] 路由——双向 round-trip 是否仍通？这是最微妙处。
3. **waitingOn 语义**：旧 = window.id；新 = peer/conversationId。scheduler wakeWaitingThreadsOnInbox 是否只看 inbox 长度不读 waitingOn 内容（若读则需适配）。
4. **deliverMessage 的 windowId 标记**：messages 现有 windowId（标记属哪个 talk_window）；window-free 后 outbox 消息怎么标记会话（peerObjectId? conversationId?）——影响双向配对（resolveCalleeReplyToWindowId 逻辑）。
5. **talks.json 双向一致性**：deliverMessage 在 caller + callee 双方都写 talks.json，并发/串行一致性（serial-queue per object）。
6. ROOT_METHODS：talk 仍是 method（形态变 say→talk(content)），say/wait/close 不再是 method——count 核对。
7. relation-write-on-talk.integration：用 talk + relation.edit——L5c 改 talk 形态，该测试怎么调整（relation.edit 是 L6a，此处 talk 部分迁移）。
