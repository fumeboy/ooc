# Collaborable: cross-object talk + user-as-flow-object

**日期：** 2026-05-15

## 目标

落地 collaborable 第一阶段：让 talk command 能跨对象工作，并把 web session 的"user 给 supervisor 发消息"统一到这条机制上。

参考：todo.md（7 条）、collaborable/index.doc.js、windows/root/talk.ts、windows/talk.ts。

## 关键决策

### 1. talk_window.target 改为任意 objectId

旧：target 只能是 `"user"`。  
新：`target: string` 表示目标 flow object 的 objectId（"user" 也是一个 flow object）。

### 2. user 是一个特殊但形态统一的 flow object

- 创建 web session 时：默认在 `flows/{sid}/objects/user/` 下建 flow object 与 root thread
- user object 是**被动**的：scheduler / worker 不调度它的 thread（thread.persistence.objectId === "user" 时 worker 跳过）
- 用户在 UI 上输入 = 控制面把消息写入 user.root.outbox + 派送到 target callee thread（等价于 user 这个 thread 上有 LLM 调用了 talk_window.say）

### 3. talk 派送机制

新增模块 `src/executable/windows/talk-delivery.ts`：

```ts
deliverTalkMessage({
  caller: { thread, talkWindow, baseDir },
  content,
  source: "talk" | "user",
}): Promise<{ calleeThreadId: string }>
```

行为：

1. 解析 target objectId（来自 talkWindow.target）
2. 若 `talkWindow.targetThreadId` 已存在 → 拿到 callee thread；否则在 `flows/{sid}/objects/{target}/threads/{newId}/` 创建新 thread（含 creator talk_window 指向 caller）
3. 把 message 追加到 callee.inbox（携带 `windowId`/`replyToWindowId` 让两侧 transcript 各归各位）
4. callee 状态翻 running，worker 自然调度
5. 把 `targetThreadId` 写回 caller talk_window；caller thread 持久化

### 4. callee 的 creator window 是 talk_window，不是 do_window

旧 `initContextWindows` 总是建 do_window。改成接受一个 `creatorKind: "do" | "talk"` 参数：

- do（fork 子线程）：创建 creator do_window，targetThreadId = creator
- talk（跨对象）：创建 creator talk_window，target = caller objectId, targetThreadId = caller threadId

both 标 `isCreatorWindow: true`（TalkWindow 也加这个字段），close 拒绝。

### 5. session 创建路径

新增/改造 `POST /api/sessions`（或 `POST /api/flows/{sid}/seed`）：

入参：
```ts
{ sessionId: string; title?: string; targetObjectId: string; initialMessage: string }
```

流程：
1. `createFlowSession(baseDir, sessionId, title)`
2. `createFlowObject(user)` + 建 user.root thread（status=running 但 worker 会跳过）
3. 在 user.root 下挂 talk_window targeting targetObjectId
4. 调 `deliverTalkMessage` 派送 initialMessage → 在 target 上建 callee thread
5. callee 状态 running → worker 调度 → LLM 跑

### 6. 控制面"user 回复"重写

旧 `continueThread(text, targetWindowId)` 把消息写进当前 thread 的 inbox。  
新 `continueUserTalk({ sessionId, targetWindowId, text })`：

- 找到 user.root + 对应 talk_window
- 调 `deliverTalkMessage`（source="user"）
- 老 continueThread API 保留兼容（其它路径暂时还在用），但 web 上的 chat 输入走新 endpoint

### 7. web UI

- 取消 "createSession 第一步只问 sessionId/objectId/initialMessage" 的形态，改成必选 targetObjectId + initialMessage
- 创建后默认展示 user.root（左中：context tree；右：chat）
- 增加 thread 切换器：右侧顶部加一个 thread dropdown，列出当前 session 下所有 thread（user.root / target/{threadId}/...），点击切换 state.activeThread

## 不在范围内

- 多 user / 多 supervisor 协调（kanban）
- relation 文档自动维护
- "user 的 thread 自己也走 LLM"——user 永远被动

## 实现节奏

- Step 1：types + delivery + initContextWindows 变体
- Step 2：talk_window.say 接通 delivery；root.talk 放开 target
- Step 3：worker 跳过 user object
- Step 4：seedSession API + service.createSession 改造
- Step 5：UI 表单 + thread 切换
- Step 6：测试与回归

每步独立 commit；中间允许测试短暂红，最后统一收口。
