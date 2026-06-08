# /flows URL 路由模型重构 + RightPanel 接管 thread 视图

## Context

当前 `/flows/<sessionId>?objectId=&threadId=` 把 sessionId 编进 path，objectId/threadId 进 query；user-home 的"右栏"和站点级 `RightPanel` 同时承担 thread 内容展示，存在重复。

目标重构：
- **URL 语义分层**：path 决定 MainPanel 展示哪种**视图**；query 记忆**会话状态**（sessionId / 当前 thread）。
- **新 path 形态**：
  - `/flows/index?sessionId=...&objectId=...&threadId=...` —— user home（SessionThreadsIndex）
  - `/flows/thread_context?sessionId=...&objectId=...&threadId=...` —— Context Tree（ThreadDetailTabs）
- **去重**：user home 不再渲染右半部分，所有 thread chat 内容统一走站点 `RightPanel`。
- **导航按钮**：MainPanel 的 Home 按钮 → `/flows/index`；RightPanel 的"查看 context windows" → `/flows/thread_context`；两者都**保留** query，让 RightPanel 持续显示同一 thread。
- **RightPanel 显隐**：query 缺 sessionId/objectId/threadId 任一 → 不渲染 RightPanel。
- **user.root 收敛**：breadcrumb thread-switcher 的下拉里隐藏 user.root；user home 的 SessionThreadsIndex 里 user.root 节点不可点击。

## 关键决策

1. **RouteState 模型**：删 `kind: "session"`，新增 `kind: "flowsView"; view: "index" | "thread_context"; sessionId?, objectId?, threadId?, selected?`。`view` 决定 MainPanel 渲染哪种视图；`sessionId/objectId/threadId` 是会话状态；`selected` 仍承载左栏选中（只对 `view==="index"` 有意义）。
2. **路径选择 literal segments** `/flows/index` 和 `/flows/thread_context`，不参数化为 `:view`，避免拼错的 path 命中 unknown view。
3. **legacy 兼容**：parseRoute 检测旧形态 `/flows/:sessionId`（含 `/threads/...`）→ 派发为 `flowsView({ view: "index" 或 "thread_context", ... })`，让旧 URL 仍可解析。**不**写 redirect effect（直接命中旧 URL 时浏览器地址栏保留旧形态，下一次导航会被 toPath 改写到新形态——这是有意的、最小破坏的迁移）。
4. **空 sessionId 行为**：`/flows/index`（无 query）展示 "Pick a session" 的 EmptyState，与现有 `/flows` scope 空态对齐；用户从 sidebar 选 session 后 query 自动填上。`/flows/thread_context`（无 query）同样空态，因为没有 thread 上下文可展示。
5. **RightPanel 显隐条件**：shell 现在用 `activeObjectId && activeObjectId !== "user"` 判定是否渲染 RightPanel；改为 `activeSessionId && activeObjectId && activeThreadId`，并去掉 `!== "user"`——user.root 这个 thread 永不会进 query（user home 的 user.root 节点不可点击 + breadcrumb-switcher 不暴露 user.root），所以无需过滤；如果 query 真的写了 user.root（旧书签），可以照常显示。
6. **SessionThreadsIndex 行为变更**：
   - 列表项点击不再写 `?selected=...`，而是写 `?objectId=...&threadId=...`（peer thread）。RightPanel 自动接管渲染。
   - 左栏 Chats 项 → `objectId=peer.target, threadId=peer.targetThreadId`。
   - 左栏 Threads（其它 object）项 → `objectId=item.objectId, threadId=item.threadId`。
   - user.root 行渲染但点击禁用（`disabled` 或 `aria-disabled`，配 muted 样式）。
   - `SelectionDetail` / `ThreadInspectDetail` 调用从 SessionThreadsIndex 删除（右栏内容下沉到 RightPanel）。`?selected=` query param 暂留兼容，但不再驱动 UI。
7. **selected query 退役**：本轮**不**全删 `selected` 解析与 toPath 写入（避免链接断裂），但 SessionThreadsIndex 不再产出/消费它。后续清理可单独拆。
8. **测试范围**：routing.test.ts 改写既有 `kind: "session"` 用例为 `flowsView`；加新用例：`/flows/index?sessionId=` round-trip、`/flows/thread_context` round-trip、legacy `/flows/<sid>` 解析、Home/Network 按钮目标 URL。

## 改动文件清单

### 路由 / 导航

| 文件 | 变更 |
|---|---|
| `web/src/app/routing.ts` | RouteState：删 `session`，加 `flowsView`；toPath 处理 `/flows/index` 与 `/flows/thread_context`，sessionId 进 query；parseRoute 解析新 path + legacy 旧形态兼容；`extractThreadContext` / `scopeOf` 同步 |
| `web/src/app/routing.test.ts` | 改 17 个 `kind: "session"` 测例 → `flowsView`；加新用例覆盖 view 切换、sessionId 在 query、legacy 解析 |
| `web/src/app/routes.tsx` | 加 `/flows/index` 与 `/flows/thread_context`；保留 legacy `/flows/:sessionId` 与 `/flows/:sessionId/threads/:objectId/:threadId`；保留 `/flows/:sessionId/objects/:objectId/pages/:page`（flowPage） |

### shell 取数 / 派发

`web/src/app/shell.tsx`：

- `activeSessionId` 从 query（`route.kind === "flowsView"` 取 `route.sessionId`）取，不再从 path
- `activeObjectId` / `activeThreadId` 同理；缺省**不再**自动补 `"user"` / `"root"`，因为只有 query 显式带才视为有 thread 上下文
- `handleSession(flow)`：navigate `flowsView({ view: "index", sessionId: flow.sessionId })`（不带 objectId/threadId）
- `handleSelectThread`：navigate `flowsView({ view: route.view, sessionId: activeSessionId, objectId: sel.objectId, threadId: sel.threadId })`，**保留当前 view kind**（在 thread_context 视图切换 thread 不切回 index）
- `handleShowContextWindows`：navigate `flowsView({ view: "thread_context", sessionId, objectId, threadId })`（参数全部从当前 query 抄过来）
- `handleCreate` 成功后 navigate `flowsView({ view: "index", sessionId, objectId: created.targetObjectId, threadId: created.targetThreadId })`
- RightPanel 渲染条件：`activeSessionId && activeObjectId && activeThreadId`（删 `!== "user"`）
- 旧 `kind: "session"` 分支替换；URL polling effect 的依赖项继续用三元变量

### MainPanel

`web/src/app/layout/MainPanel.tsx`：

- `isUserThreadHome` = `route.kind === "flowsView" && route.view === "index"`；进入条件不再判 objectId
- `isPeerThreadDetail` = `route.kind === "flowsView" && route.view === "thread_context" && route.sessionId && route.objectId && route.threadId`
- Home 按钮：`toPath({ kind: "flowsView", view: "index", sessionId: activeSessionId, objectId: activeObjectId, threadId: activeThreadId })`（保留 query；activeSessionId 等从 props/route 取）
- breadcrumb / headerTitle / pill 的 `case "session"` 改 `case "flowsView"`：根据 `view` 派生 label（"user home" / "thread context"）
- UserThreadHome 调用：去掉旧 `route.sessionId` 取 path 的写法，用 `route.sessionId`（query）；缺失时跳到 EmptyState

### RightPanel "查看 context windows" 按钮

`web/src/app/layout/RightPanel.tsx:onShowContextWindows` 的实际实现在 shell.tsx：

- `handleShowContextWindows`（shell.tsx:405）改 navigate `/flows/thread_context?...`（同一份 query），不动 RightPanel 组件本身

### SessionThreadsIndex（user home）

`web/src/domains/sessions/components/SessionThreadsIndex.tsx`：

- 左栏列表项点击改写 navigate target：写 `objectId=...&threadId=...`，**不**写 `?selected=...`
- 当前 active 项判定从 `route.selected.kind === "chat" && windowId === w.id` 改为 `route.objectId === w.target && route.threadId === w.targetThreadId`（chat 项）/ `route.objectId === item.objectId && route.threadId === item.threadId`（thread 项）
- user.root 行：渲染但 `disabled` + 不绑 onClick / 加 muted 样式（视觉提示"主入口不可切换"）
- 删除右栏 SelectionDetail / ThreadInspectDetail / ChatPanel inline 渲染分支（`SessionThreadsIndex.tsx:195` 起的那块），整体改成单栏左列布局（占满 user-home 容器宽）
- 同文件内的 `SelectionDetail` 函数删除；`SessionThreadsIndex.test.ts` 同步删 / 调相关用例

### ThreadHeader（breadcrumb thread-switcher）

`web/src/app/layout/ThreadHeader.tsx`：

- `threads.filter((t) => !(t.objectId === "user" && t.threadId === "root"))` —— 过滤 user.root 后再算 `threads.length` 决定是否渲染 select；`threads.length <= 1` 的单 thread 兜底分支照旧

### 端到端清理

CSS 上 user-home 旧的 `.user-home-split` / `.user-home-right` / `.user-home-chat-host` 等右栏专属规则在 SessionThreadsIndex 单栏化后变成 dead rules——本轮**不**删（避免误伤；styles.css 体量大，留给单独清理任务）。

## 关键复用点

| 用 | 在 | 用法 |
|---|---|---|
| `useRouteState()` / `toPath()` | `web/src/app/routing.ts` | 所有 navigate 仍走 `navigate(toPath(state))`；新 RouteState 加分支即可 |
| `RightPanel` | `web/src/app/layout/RightPanel.tsx` | 不动组件；改 shell 的渲染条件 |
| `ChatPanel` | `web/src/domains/chat/components/ChatPanel.tsx` | RightPanel 已经在用；user-home 内联渲染删除 |
| `ThreadDetailTabs` | `web/src/domains/sessions/components/ThreadDetailTabs.tsx` | thread_context view 直接渲染它（已在 MainPanel 用） |
| `usePollingThread` | `web/src/domains/chat/use-polling-thread.ts` | shell 既有 polling 替代 SessionThreadsIndex 内部独立轨；user-home 不再起独立 polling |

## 落地顺序

1. routing.ts 改 RouteState + toPath + parseRoute（含 legacy 兼容）；`bun test web/src/app/routing.test.ts` 跑出失败列表
2. routing.test.ts 改 / 增测例直至全部 pass
3. routes.tsx 加新 path 注册
4. shell.tsx 取数派发改造（`activeSessionId/Object/Thread` 从 query；handleSession / handleSelectThread / handleShowContextWindows / handleCreate 调整；RightPanel 显隐条件）
5. MainPanel.tsx 路由分支与 Home 按钮改 toPath；breadcrumb / headerTitle 同步
6. SessionThreadsIndex.tsx 单栏化、点击 navigate 改写、user.root 禁用；test 同步
7. ThreadHeader.tsx 过滤 user.root
8. `cd web && bun tsc --noEmit` 干净；前端 build OK
9. 手动 e2e（见下）
10. 重启后端 + vite 让用户验

## 验证

**自动化**：
- `bun test web/src/app/routing.test.ts`：所有用例通过；新加的 round-trip 锁住 `?sessionId=&objectId=&threadId=` 双向解析
- `bun test web/src/domains/sessions/components/SessionThreadsIndex.test.ts`：右栏移除后的剩余用例通过
- `cd web && bun tsc --noEmit` 干净

**手动 e2e**（重启后）：

1. 打开 `http://localhost:5173/flows/lark-chat-oc_xxx?objectId=supervisor&threadId=t_user_xxx`（旧 URL）→ 应 parseRoute 兼容解析为 flowsView({ view: "index", ... })，UI 表现正常；下一次导航后地址栏改写为 `/flows/index?sessionId=...`
2. 打开 `/flows/index?sessionId=lark-chat-oc_xxx&objectId=supervisor&threadId=t_user_xxx` → user home + RightPanel 都显示
3. 点 RightPanel 的 ⊙ 网络图标（"查看 context windows"）→ URL path 切到 `/flows/thread_context?...`（query 不变）；MainPanel 切到 ThreadDetailTabs；RightPanel 仍显示 supervisor chat
4. 点 Home（房子）按钮 → URL path 切回 `/flows/index?...`（query 不变）；MainPanel 切回 user home；RightPanel 仍显示 supervisor chat
5. 在 `/flows/index` user home 左栏点击其它 chat / thread → query 的 objectId/threadId 切换；RightPanel 切到新 chat
6. 在 `/flows/index` user home 左栏点 user · root 行 → 不响应（disabled）
7. breadcrumb 的 thread-switcher dropdown 不出现 user · root 选项；只有 supervisor / 其它 callee
8. URL 手动改成 `/flows/index`（无 query）→ MainPanel 显示 EmptyState（"Pick a session"）；RightPanel 不渲染
9. URL 手动改成 `/flows/thread_context`（无 query）→ MainPanel 显示空态；RightPanel 不渲染
10. polling hash 仍稳定（前一轮的修复无回归）
