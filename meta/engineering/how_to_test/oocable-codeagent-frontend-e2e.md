# OOC as CodeAgent — frontend e2e tests

> 必读前置：`docs/testing/strategy.md`。本文档不重复策略 / 观察孔 / Good-OK-Bad 判定规则；只列出前端入口下的具体场景集与触发方式。

---

## 范围

测试对象：**Web UI → 前端发出 HTTP → 后端 worker → 真 LLM → 回到前端渲染**。即真正打开浏览器（或浏览器自动化），用键盘鼠标级别的操作完成用户故事，验证用户视角下的端到端体验。

测试**不**关心：

- 单元级 React 组件行为（属各组件 `__tests__/*.test.tsx`，本期前端单测几乎缺失，另立工作流补）
- 纯 backend API 通路（属 `oocable-codeagent-backend-e2e.md`；前端 e2e 出 Bad 时，先去 backend e2e 自查同一场景是否绿，区分"通路坏" vs "UI 坏"）
- 跨浏览器兼容（只针对当前主开发浏览器 Chromium）
- 响应式 / 移动端（OOC 当前定位是桌面开发工具）

每个场景的判定按 `strategy.md §2`：Good / OK / Bad；通过门槛 ≥ OK。

---

## 工具栈

| 项 | 选择 | 理由 |
|---|---|---|
| 浏览器自动化 | Playwright（`@playwright/test`）| 跨平台、稳定、Bun 兼容、可截图 |
| 测试运行器 | playwright 自带（`npx playwright test`，不走 `bun:test`）| 与 Playwright 生态一致；本端独立调度 |
| Web app | Vite dev server | 真 dev 体验；与开发者本地用法一致 |
| Backend | 后端进程独立起，`--world` 指向临时 mkdtemp baseDir | 与 backend e2e 同形态；前端 e2e 不复用 backend e2e 的 baseDir |
| LLM | 真 LLM via `.env` | 主线 e2e 必须真 |
| Gate | `RUN_FRONTEND_E2E=1` 环境变量 | 默认 skip |

测试文件位置：`tests/e2e/frontend/*.spec.ts`（Playwright 习惯后缀 `.spec.ts`）。

---

## 启动模型

前端 e2e 要同时跑两个进程 + 浏览器。约定：

1. 测试启动 spawn 一个临时后端：`bun --env-file=.env src/app/server/index.ts --world <mkdtemp>`，端口随机
2. 测试启动 spawn 一个临时 Vite dev：`bun run web:dev --port <random>`，通过环境变量把后端 URL 注给前端
3. Playwright 打开 `http://localhost:<vite-port>/`
4. 测试结束清理两个进程 + 临时 baseDir
5. 跨场景串行（不并发），避免 LLM 资源争抢

由 `tests/e2e/frontend/_fixture.ts` 封装成 Playwright `beforeAll/afterAll`。

---

## 公共 fixture (`tests/e2e/frontend/_fixture.ts`)

提供：

- `startBackend({ seedFiles? }) → { baseDir, port, kill() }` — spawn 后端 + 等就绪
- `startWeb(backendUrl) → { port, kill() }` — spawn Vite + 注入 backend URL
- Playwright `test.beforeAll` 把两步连起来，把 `baseURL` + `baseDir` 暴露给场景
- `createSessionVia(page, { targetObjectId, firstMessage })` — 操作 SessionCreator 表单提交、等跳转
- `waitForReply(page, { since })` — 等 ChatPanel 出现新一条 assistant 消息
- `sendFollowup(page, text)` — 在右下角 composer 输入并点 send，等响应
- `readFsState(baseDir, relPath)` — 直读文件系统，验 LLM 真改了文件
- `readThreadJson(baseDir, sid, objectId, threadId)` — 给 OOC 机制观察孔
- `scoreScenario({ uiEvents, fs, thread, rules }) → { tier, details }` — 同 backend 风格评分裁判

---

## 场景集索引

| ID | 文件 | 类别 | 一句话 |
|---|---|---|---|
| F1 | `frontend-create-session-and-first-reply.spec.ts` | 多轮对话起点 | SessionCreator → 第一条回复出现在 chat panel |
| F2 | `frontend-rename-symbol-via-chat.spec.ts` | 改文件 | 用户说"改名"，文件真改，回复回来 |
| F3 | `frontend-search-and-open-match.spec.ts` | 纯读取 + UI 副作用 | grep 触发 search_window 在 context tree 出现 |
| F4 | `frontend-user-talk-window-composer.spec.ts` | UI 单点 | ContextSnapshotViewer talk_window 详情内 inline composer 回复 |
| F5 | `frontend-no-right-panel-on-user-thread.spec.ts` | UI layout 守护 | 切到 user.root 时右侧 chat 应消失 |

每个场景跑完必须 `tier !== "Bad"`；重试 1 次政策同 backend。

---

## F1 — `frontend-create-session-and-first-reply.spec.ts`

**类别**：多轮对话起点（"用户第一次接触 OOC"）

**Seed**：空 baseDir（或一个 README.md）

**用户操作脚本**：

1. 打开 web 首页
2. 在 SessionCreator 表单：Session ID 用默认，Talk to=`assistant`，First message=`"hi"`
3. 提交
4. 等左侧 session 列表出现新 session 项；中间区域切到 ContextSnapshotViewer；右侧出现 chat panel
5. 等右侧 chat panel 出现 assistant 第一条消息

**Good**：

- 步骤 5 在 30 秒内完成
- assistant 回复在 UI 中可见（DOM 含至少一条非空 assistant 消息）
- 中间 ContextSnapshotViewer 中能看到 callee thread 的 creator talk_window；transcript 至少 2 条（user hi + assistant 回复）
- 文件系统 callee thread.json 状态 = `done` 或 `waiting`
- `baseDir/.../user/threads/root/thread.json` outbox 含 user 的 hi；inbox 含 assistant 回复
- 浏览器端无 `console.error` / unhandled promise rejection

**OK**：

- 步骤 5 在 60 秒内完成（慢但成）
- 或 UI 出现回复，但 ContextSnapshotViewer 一开始只渲染 fallback inbox 没收到 transcript
- 或浏览器有非致命 `console.warn`

**Bad**：

- 30 秒内 chat panel 仍无回复
- assistant 回复出现在文件系统但 UI 不更新（前端 polling / refresh 链路坏）
- UI 出现 "backend offline" 等错误条
- 浏览器 `console.error`

---

## F2 — `frontend-rename-symbol-via-chat.spec.ts`

**类别**：改文件（user 通过 web 让 assistant 改代码的核心体验）

**Seed**：`baseDir/work/src/foo.ts` 含 `helperA` 跨 2–3 处。后端启动时 `--world` 指向 `baseDir`。

**用户操作脚本**：

1. 打开 web；建 session：target=`assistant`，first message=`"请把 src/foo.ts 中的函数 helperA 重命名为 helperZ；改完告诉我做了什么。"`
2. 等 assistant 回复
3. 不再操作 UI，直接读 fs 验证

**Good**：

- `baseDir/work/src/foo.ts` 中 helperA 计数=0、helperZ 计数 = 原来的 helperA
- assistant 在 UI 给出非空回复，提到 helperZ
- ContextSnapshotViewer 中能看到至少 1 个 file_window（走过 file_window 路径）
- thread.json 里 LLM 至少 open 过一次 `file_window.edit`
- 未用 `program(language="shell")` 改文件

**OK**：

- 文件改对 + 回复出现，但用了 `program(shell, sed -i ...)` 或 `write_file` 全覆盖
- 或 LLM 重试 ≥ 2 次后才成功

**Bad**：

- 文件没改 / 改错
- assistant 不回复 / UI 无更新
- thread 卡在 running / waiting

---

## F3 — `frontend-search-and-open-match.spec.ts`

**类别**：纯读取 + UI 副作用（验证 search_window 真渲染 + open_match 真 spawn file_window）

**Seed**：`baseDir/work/src/{a,b,c}.ts` 各含若干 `deprecatedFoo`。

**用户操作脚本**：

1. 打开 web；建 session：target=`assistant`，first message=`"找出 src/ 下所有用到 deprecatedFoo 的位置，告诉我有几处。不要修改代码。"`
2. 等 assistant 回复
3. 在中间 ContextSnapshotViewer 里查找 search_window 节点（左树 badge=`SEARCH`）
4. 点开它的详情面板，验证有 matches 列表

**Good**：

- assistant 回复中数字与实际命中数一致
- 文件未被修改
- ContextSnapshotViewer 中至少 1 个 type=search 的 window 节点；点开后右侧详情显示 matches[] 含 path + line + snippet
- 左树该 search 节点右侧的 message-count badge 显示 0 inbox / 0 outbox（search_window 不参与消息流；这条防止 badge 与 transcript 串了）
- LLM 至少 open 过一次 `root.grep`

**OK**：

- 数字 / 位置正确，但走了 `program(shell, grep -rn)`，导致 ContextSnapshotViewer 里**没有** search_window 节点（机制偏，但用户视角能用）
- 或 search_window 出现但 matches 渲染缺 snippet（只有 path / line）

**Bad**：

- 数字错 / 没回复
- 修改了文件
- 浏览器 `console.error`（render 层崩了）

---

## F4 — `frontend-user-talk-window-composer.spec.ts`

**类别**：UI 单点（验证我们上周加的 inline composer 真能用）

**Seed**：空

**用户操作脚本**：

1. 建 session（同 F1，first message=`"hi"`）；等首轮回复
2. 中间 ContextSnapshotViewer 切到 user.root thread（点左树切换器）
3. 在 user.root 的 contextWindows 里找到 target=assistant 的 talk_window 节点；点开
4. 在右侧详情面板底部的 inline talk composer 输入 `"再说一句"`，点 Send
5. 等 assistant 回复

**Good**：

- 步骤 5 在 30 秒内完成
- assistant 第二条回复出现在 UI（在中间 ContextSnapshotViewer 的 talk_window transcript 内可见）
- 文件系统：user.root.outbox 长度=2；callee assistant thread.inbox 中 source=user 的也 = 2

**OK**：

- 完成但需要刷新页面才看到第二条回复
- 或 inline composer 输入有滞涩 / 焦点跳

**Bad**：

- inline composer 不可见 / 不可输入 / Send 按钮没响应
- assistant 不回复
- 浏览器 `console.error`

---

## F5 — `frontend-no-right-panel-on-user-thread.spec.ts`

**类别**：UI layout 守护（user 不能跟自己对话，所以 user thread 视角不应该有右侧 chat panel）

**Seed**：空

**用户操作脚本**：

1. 建 session；等首轮回复
2. 切换 thread switcher 到 user.root
3. 截图整页

**Good**：

- 右侧 chat panel **不存在**（DOM 里没有 `.right-panel` 或它处于隐藏 / collapsed 状态）
- 中间 MainPanel 占据原右侧空间（grid 切到 `app-layout-no-right`）
- ThreadHeader（objectId / status / switcher）仍在 breadcrumb-bar 里可见
- 浏览器无 `console.error`

**OK**：

- 右侧 chat panel 仍在 DOM 但被 CSS 隐藏（功能上 ok，视觉上也 ok，但留了未来的脆点）

**Bad**：

- 右侧 chat panel 出现并显示 ChatComposer（user 跟自己对话的 UX 漏洞）
- 切换后 layout 错乱（中间 panel 被压缩 / overflow）

---

## 推进顺序建议

1. **F1 先做** — 跑通整套（spawn 后端 + Vite + Playwright + 真 LLM），后续场景共享这套 fixture
2. **F2 / F3 是 CodeAgent 核心体验** — 与 backend e2e 的 S1 / S2 一起验证两条路径
3. **F4 / F5 是上周 UI 改动的护栏** — 防止"用户视角 ok 但机制漂移" / "机制 ok 但 UI 错乱"

---

## 与 backend e2e 的关系

- 同一用户故事在 backend e2e（S1/S2/S3/S4）与 frontend e2e（F1–F5）应**能映射到对方**——这是分层的初衷：backend 先绿 → frontend 才有底气
- 调试失败时：先看 backend e2e 同一场景是否绿。若 backend 绿、frontend Bad → 锁定 UI 问题；若两端都 Bad → 后端 / LLM / 协议层
- 新增一个 backend e2e 场景时，思考是否在 frontend e2e 加对应；反之亦然——不强求 1:1，但显著的核心体验应两端都覆盖
