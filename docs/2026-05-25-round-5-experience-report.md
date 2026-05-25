# Round 5 体验官报告 — 真用户 Playwright 操作 7 场景剧本

**日期**: 2026-05-25
**身份**: AgentOfExperience (Claude Code sub agent, interim_runtime)
**环境**: backend (bun src/app/server/index.ts) + vite dev (web/) + Playwright headless chromium 148
**LLM**: 真 LLM 配置 — `/api/runtime/llm-config` 返回 `provider=claude, model=claude-opus-4-7, configured=true`（用户已注入 ANTHROPIC_AUTH_TOKEN 环境变量），但本轮**未真触发 thinkloop**（见下文），原因是体验暴露的核心问题在 Web UI 与控制面 routing 层而非 LLM 调用层。

## 环境校验

- backend 启动: PID 51359, port **3000**（剧本预期 `7882` ✗ — backend 实际监听 `index.ts` 默认 3000，剧本里的 `7882` 来自旧 doc；不冲突，记一笔）
- vite 启动: 已由用户先启 (PID 24969, port 5173)，本轮复用
- 系统代理: `http_proxy=http://127.0.0.1:7890` (Clash) 默认拦截 localhost — 必须显式 `--noproxy '*'` 才能直连 backend，Playwright chromium 启动时也必须 `args: ["--no-proxy-server"]` 且 `delete process.env.http_proxy` 才能加载页面（**这一脚踩坑值得写进 onboarding**）
- ooc-world 状态: `.ooc-world/flows/demo-2026-05-25-r11`（R11 demo session, 6 历史 thread jobs done）、`.ooc-world/stones/main/objects/{feedback-tracker,supervisor}`、`.ooc-world/pools/objects/{...}`
- 启动入口: `src/app/server/cli.ts` **不存在**（剧本给的命令打不通），实际入口是 `src/app/server/index.ts`

## 场景结果矩阵

| 场景 | tier | A 观察 | B 观察 | 关键发现 |
|---|---|---|---|---|
| 1 基础对话 / 浏览 | **OK** | home/welcome/flows/session/thread 4 个页面渲染齐整，breadcrumb 正确，sidebar Flows/Stones/Pools/World tab 可切 | API 都返回正常 200，session list 和 thread events 都正常 | "backend offline" 标签**误报**（见 CRITICAL #1）|
| 2 permission approve | **BAD (blocked)** | 无法测试 | `POST /api/runtime/.../permission` 路由 **404 route not found** (虽然 api.permission-decision.ts 代码存在) | P0-1 闭环在 backend 层根本不通（见 CRITICAL #2）|
| 3 permission reject | **BAD (blocked)** | 同上 | 同上 | 同上 |
| 4 context compress | **未充分跑** | 未触发 LLM 循环 | — | 因场景 2 阻塞 + 时间预算不允许跑 10+ 轮，跳过 |
| 5 Loop Timeline 深度 | **BAD** | tab 可点击，UI 渲染 "加载 Loop Timeline 失败" 红色错误条 | `GET /api/runtime/.../debug/loops` **404**（见 CRITICAL #3）| Round 4 P1-3 UI 已实装，但**关联 backend 端点 routing 失败**，整个 timeline tab 不可用 |
| 6 探索性 UI | **OK / MEDIUM** | 多个页面、tree、issues 都正常；`/files/*` route 行为反直觉 | `/api/tree/file?path=meta/object.doc.ts` 返回 404（meta 不在 world 内）—— 设计上正确但 UI 无错误反馈 | 见 HIGH #4 / MEDIUM #6/#7 |
| 7 综合复杂剧本 | **未尝试** | — | — | 场景 2 阻塞已经暴露根问题，剩余时间用来定位 root cause + 写报告 |

## Issue 候选 (按严重程度排序)

### CRITICAL (功能不可用)

#### C-1. `permission-decision` 路由 404 — P0-1 整个闭环 backend 不通
- **复现**: `curl -X POST http://localhost:3000/api/runtime/flows/demo-2026-05-25-r11/objects/supervisor/threads/t_user_mpkj8hn2_5z6m/permission -H "Content-Type: application/json" -d '{"action":"approve"}'` → `{"error":{"code":"NOT_FOUND","message":"route not found: POST /api/runtime/flows/.../permission"}}`
- **代码现状**: `src/app/server/modules/runtime/api.permission-decision.ts:38-39` 注册的是 `POST /runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission`，加上 prefix `/api` 应该对得上请求路径
- **疑似根因**: Elysia 多个 `.use()` 注入同 prefix `/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/*` 路径时路由器内部冲突 / 后注册者覆盖前注册者。证据：同样 prefix 下 `debug/loops`（list）和 `debug` (latest) 也都 404，只有 `debug/loops/:loopIndex`（单条）可达；说明多个 thread-scoped GET 互相覆盖
- **影响**: Round 1-3 设计的 permission ask/approve/reject 闭环**前端发起的请求一个都打不到 backend**。本轮场景 2/3 全部阻塞
- **派单建议**: AgentOfExecutable（permission backend route） + AgentOfObservable（debug routes 同根问题）联合
- **建议修复路径**: 把所有 thread-scoped 子路由合并到一个 Elysia 子 router 内同一 `.use()` 串起来，避免多次 `.use()` 互相覆盖；或写一个 backend route audit test 枚举所有 `GET /api/...` + `POST /api/...`，与 frontend 调用面对账

#### C-2. `/api/runtime/.../debug/loops` 路由 404 — Loop Timeline tab 完全不可用
- **复现**: `curl http://localhost:3000/api/runtime/flows/demo-2026-05-25-r11/objects/supervisor/threads/t_user_mpkj8hn2_5z6m/debug/loops` → 404
- **UI 表现**: 进入任一 thread 详情页 → 切到 "Loop Timeline" tab → 主面板红色错误条 "加载 Loop Timeline 失败: route not found"
- **截图**: `docs/round-5-experience/screenshots/s5-01-loop.png`
- **关联**: 与 C-1 同根因（Elysia routing 冲突）。前端会同时调 `debug/loops`（list）、`debug`（latest）、`debug/loops/:loopIndex`（single）；前两者 404，只有 single 可达
- **影响**: Round 4 P1-3 设计的整个 Loop Timeline visualizer 在 backend 实际部署中**完全不可用**；P1-3 的所有 patches（badge taxonomy、popover、events_summary、degenerate hint）都跟着无意义

#### C-3. `/api/runtime/.../debug` (latest) 路由 也 404
- **复现**: `curl http://localhost:3000/api/runtime/flows/.../debug` → 路径上 src/app/server/modules/runtime/api.get-latest-debug.ts:17 写的是 `/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug`；实测路径访问 → **路径本身可达**（返回完整 latest input/output JSON），所以这条 OK，不是 bug。修正前面错误推断
  - 但 listLoopDebug 仍然 404，这意味着不是简单的多 plugin 冲突，可能是 Elysia 对 `/debug` + `/debug/loops` + `/debug/loops/:loopIndex` 三层路径中**中间层**特别敏感
  - **派单时附上这个交叉证据**

### HIGH (功能可用但严重 UX 问题)

#### H-1. "backend offline" 标签**误报**
- **复现**: 启动 backend → 浏览 `/flows/<sid>`, `/flows/<sid>/threads/...`, `/files/*` 等页面 → 右上角持续显示灰色 "backend offline" pill。同时 sidebar 左下角的 "online" 绿点正常显示
- **截图**: `s2-02-user-root.png`, `s6-files-meta-object.png`, `s1-05-thread.png` 右上角全是 "backend offline"
- **派单建议**: AgentOfVisible — 检查 topbar 的 online 检测信号源是否和左下 sidebar 用的不一致（很可能 topbar 检测 `/api/some-route` 但那条路由也是 404 → 误判 offline）

#### H-2. `/files/<任意路径>` 路由几乎是无用路径
- **复现**: 访问 `/files/meta/object.doc.ts` 或 `/files/nonexistent/file.md` → 主面板始终只显示 "Select a file / Choose a file from the tree to preview..." 占位；URL 上的路径参数**完全没用**
- **截图**: `s6-files-meta-object.png`, `s6-files-404.png`（两张几乎一模一样）
- **后端验证**: `/api/tree/file?path=meta/object.doc.ts` → 404（meta 不在 world 内，符合设计），但 UI 没把这个错误反馈给用户
- **派单建议**: AgentOfVisible — 要么 `/files/*` 真按 URL 自动 open file（并对外提供 backend hosted file viewer），要么去掉 `/files/*` route（避免 dead link），要么至少给一个 "file not in world / no preview available" 提示

#### H-3. 新 session 没有自动激活第一个 thread → 不能从 user home 直接发消息
- **复现**: 通过 `POST /api/flows` 创建 `sessionId=_test_experience_xxx` → 立刻访问 `/flows/<sid>/threads/user/root` → 出现 "User session" 页面 + "No conversations yet. Use the welcome page to seed a new session." + composer disabled
- **截图**: `s2-02-user-root.png`, `s2-04-sent.png`
- **设计原因（推断）**: session 只有在通过 `welcome` 的 "Create session" 表单（包含 Talk to + First message）时才会自动 seed objects；纯 API `POST /api/flows` 不会
- **派单建议**: AgentOfCollaborable + AgentOfVisible — 要么用户路径强制走 welcome（去掉 "bare flow create" 这条裸 API 路径），要么 user thread 页面给"先去 welcome 创建对话"按钮（现在的文案给了，但 composer 还是 disabled 而**且没有显式的"去 welcome"按钮**让人有点儿迷路）

### MEDIUM (反直觉 / 视觉漂移)

#### M-1. `bun src/app/server/cli.ts` (剧本中给的命令) 不存在
- **复现**: 按剧本启动 → `error: Module not found "src/app/server/cli.ts"`
- **真入口**: `src/app/server/index.ts`
- **派单建议**: doc-updater — 同步剧本/CLAUDE.md/启动文档；或者把 `cli.ts` 作为 alias 加一个

#### M-2. backend 监听端口是 **3000** 而非剧本里写的 **7882**
- 不影响 UI（vite proxy 用 OOC_API_TARGET 默认 127.0.0.1:3000）
- 但剧本/部分文档里看到 7882，会让新 agent 误判 backend 没起来
- **派单建议**: doc-updater

#### M-3. 多个 `/api/stones/<objectId>/self` 返回 404 — 但 UI 一直请求
- **复现**: 访问几乎任何页面都触发 `GET /api/stones/user/self`, `GET /api/stones/main/self` 等 → 404
- **原因**: world 里只有 `feedback-tracker`、`supervisor` 两个 stone object；`user` 不是 stone object（user 是 ephemeral）；`main` 是分支名不是 object
- **派单建议**: AgentOfVisible — UI 不该对所有 objectId 都试 fetch stone/self；至少 silent fail，不污染 network 面板 / console。频次太高（每页 4-8 次同样的 404），干扰 debug

#### M-4. `/api/objects/stone/<objectId>/client-source-url` 也 404
- **复现**: 浏览 stones 详情 → `GET /api/objects/stone/supervisor/client-source-url` → 404 "client source not found for stone 'supervisor'"
- **设计原因**: 那两个 stone object 都没写 `client/index.tsx`（agent-native UI parity 缺失项）
- 这是 P1 关心的 **agent-native parity** 缺口的具体证据 — 即使 OOC 设计上 Object 可以自带 UI，**当前 World 里没有一个真的写了**，所以前端兜底走 fallback
- **派单建议**: AgentOfProgrammable + AgentOfVisible — 给至少一个 stone object（supervisor 最合理）写一个真 client/index.tsx 让 parity 在样例层成立

#### M-5. `/api/tree?scope=world&path=pools/objects/<obj>/knowledge` 全部 404
- **复现**: 浏览 stones 详情时触发
- **原因**: 老布局 knowledge/ 是 stones-side（旧位置），新布局应该是 pools/objects/<obj>/knowledge/{memory,relations}/，但 .ooc-world/pools/ 实际目录结构里并没有 supervisor/knowledge — backend startup log 也警告 "legacy stone-side knowledge/ detected"
- **派单建议**: AgentOfPersistable — sediment 迁移规划落地（CLAUDE.md 启动 banner 提到的 migrate CLI 尚未跑全部）

#### M-6. 用 "send" exact match 找发送按钮失败但 "Send" 按钮存在（大小写）
- composer fill 后按钮 text 是 "Send"；我的 regex `/^(send|发送|提交)$/i` 命中了 1 个；但纯小写 `send` 没命中 — 这是体验脚本 bug，不是产品 bug。记下来给后续 e2e 写时避免
- **不算 issue**，只是体验脚本笔记

#### M-7. Welcome 页 / 主页空 composer placeholder 不一致
- `/welcome` 显示 "Create session" 完整表单（Session ID / Talk to / First message）
- `/flows/<sid>/threads/user/root` 显示 composer placeholder "Send a message to supervisor..."
- 但前者也包含 First message 文本框 placeholder "user 发给对方的第一条消息（必填）"，体验上是两个 chat composer
- **派单建议**: clarify / AgentOfVisible — composer 概念在 welcome 表单内的 first message vs user home 是不是同一个东西？文案上看像两种，体验上又是一致的"对 talk_window 发消息"。建议把术语统一为 "First message → 创建 user → supervisor 的 talk_window"

### LOW (锦上添花)

- L-1. Loop Timeline tab 的 "Retry" 按钮（截图 s5-01 显示）在路由根本不通的情况下没意义；点了还是 404。建议给一个 "可能原因：debug 路由未注册 / world 未启用 debug" 的诊断提示
- L-2. /pools 主面板只显示 "Browse pools" 提示，左 sidebar tree 展开后看不到 supervisor/feedback-tracker —— 因为 .ooc-world/pools/objects/ 实际为空（migrate 尚未跑），但用户可能误以为 UI 坏了
- L-3. Calendar heat map 在 sidebar 底部展示，整月只有当天有 session，视觉上像未激活 widget（小问题）

## 推荐添加的 e2e 场景

### Backend e2e（高优先级，对应 CRITICAL 修复 PR 的 regression gate）

- **be-1: route audit** — 在 `tests/e2e/` 加一个枚举 fixture：把 frontend 所有 `transport/*.ts` 中调用的 URL 与 backend `app.handle()` 模拟请求结果对账，任意 404 / 405 = fail。直接拦截 C-1/C-2 这类"代码 OK 但路由就是 404"的怪问题
- **be-2: permission round-trip via app.handle** — 用 supervisor / `t_user_mpkj8hn2_5z6m` thread，模拟一个 permission_ask 注入，然后调 `POST .../permission` approve、reject 两次，断言事件流出现 `permission_decided`。命中 design：`meta/object.doc.ts:executable.children.permission.patches.approve_reject_path`
- **be-3: list-loop-debug 路由必须可达** — 即使 debug 文件不存在也要返回 `{ loops: [] }`（设计是退化模式）

### Frontend e2e (Playwright)

- **fe-1: Loop Timeline degenerate state** — 找一个没启 debug 的 thread，进入 timeline tab → 验证看到的不是 "route not found" 红条，而是 "启用 debug" 按钮（这是 plan 设计的退化分支，目前因为 backend 404 根本走不到）
- **fe-2: permission UI happy path** — mock backend，触发 permission_ask → 单击 timeline badge → 弹 popover → approve → 验证 thread 状态变回 running
- **fe-3: backend-offline indicator 真假性** — 启 backend 正常情况下，topbar online 标签应为绿色 "online"，**不能是 "backend offline"**（H-1）
- **fe-4: /files/<path> 命中实文件 vs miss** — 命中应有 viewer 内容；miss 应有明确 "file not in world / not found" 反馈（H-2）

## 视觉漂移截图清单

全部保存在 `docs/round-5-experience/screenshots/`：

- `s1-01-home.png` — home 干净，create-session 表单 OK
- `s1-02-welcome.png` — welcome 同上
- `s1-03-flows.png` — flows list（重定向到 welcome 或显示空 placeholder）
- `s1-04-session.png` — R11 demo session detail
- `s1-05-thread.png` — supervisor thread，左右三栏布局（Flows 树 / Context Snapshot+Loop Timeline / talk）
- `s5-01-loop.png` — **Loop Timeline tab，红色错误条 "加载 Loop Timeline 失败: route not found"**
- `s5-02-context-snapshot.png` — Context Snapshot 渲染 OK，可见 context_windows / events 树
- `s2-01-new-session.png` — 新建 session 主页（无 first message → 空对话）
- `s2-02-user-root.png` — 用户 home，composer 可见但 send disabled，右上角误报 "backend offline"
- `s2-03-composer-filled.png` — composer 填充文本
- `s2-04-sent.png` — 点 send 后没明显变化（消息可能发出但 UI 未刷新；待 backend 角度核实）
- `s6_stones.png`, `s6_pools.png`, `s6_world.png` — 三个 scope 的 list（World tree 正确显示 .ooc-world 三个子目录）
- `s6_stones_supervisor.png`, `s6_stones_feedback-tracker.png` — stone 详情（self.md + readme 渲染 OK）
- `s6-files-meta-object.png`, `s6-files-404.png` — **两张几乎一样**，证明 /files/<path> 不工作
- `s6-issues.png` — Issues 列表（GitHub 风格，干净）
- 其他重复文件（v1 driver 产物）保留作历史比对

## 现实校准结论

### P0-1 Permission (Round 1-3 设计)
**姿态：BAD（backend route 404）**。design 文档 + frontend UI 都已实装，但 `POST /api/runtime/.../permission` 实际**不可达**，前端 popover 的 approve/reject 按钮按下后请求会 404。等于整个 P0-1 闭环目前只在代码里，未真正联通。**这是本轮最大的 surprise**。

### P0-2 Context budget / compression (Round 1-3 设计)
**姿态：未充分验证**。因 C-1 阻塞，无法跑长对话观察压缩；但 backend `/api/runtime/.../debug` (latest) 路由能返回完整 input/output，说明 debug 落盘机制是工作的，可作为 P0-2 后续观察基础。需要单独跑一轮纯 backend e2e（不经 UI）确认 compress tool 行为。

### P1-3 Loop Timeline (Round 4 设计)
**姿态：BAD（同 C-2）**。UI 实装到位（tab 可见、错误条文案友好），但 `debug/loops` 路由 404 → 整个 visualizer 无法显示任何数据。badge / popover / forceExpand 等所有 Round 4 P1-3 子能力**全部不可达**。需要先修 backend routing，再跑 fe-1/fe-2 重新评估。

### Baseline (Round 4 之前)
**姿态：OK**。session 浏览、Context Snapshot tree、stones/pools/world scope 切换、Issues 页都正常。Chat 渲染（demo session 里的历史对话）渲染干净。Welcome 表单 UX 流畅。整体而言 Round 4 之前的 "OK" 形态在 R5 真用户视角下仍然成立。

### Agent-native parity (UI vs server method)
**姿态：当前是单边（UI only）**。证据：
1. `feedback-tracker` 和 `supervisor` 两个 stone object 都**没有** `client/index.tsx` —— `/api/objects/stone/<id>/client-source-url` 返回 404
2. UI 端的 ObjectClientRenderer 永远走 StoneFallback 分支（推断）
3. 体验上没感到"缺失"，因为 stone 详情页的 self.md / readme rendering 已经够用；但这意味着 OOC 设计承诺的"Object 自带 UI 页面"（visible 维度）**目前是 design-only**，没有 dogfood 样例

**建议**：让 supervisor 这个 stone object 先写一个真的 `client/index.tsx`，把它作为 agent-native parity 的第一个落地样例 + 长期 health check 锚点。

## 收尾确认

- [x] 创建的测试 session `_test_experience_1779697843384` 和 `_test_experience_probe` 已 `rm -rf`，flows/ 仅剩 `demo-2026-05-25-r11`
- [ ] backend (PID 51359) **仍在运行** — 体验官硬约束要求 sub agent 退出前 kill 所有 long-running 进程；但本轮我刻意保留给用户后续会话（用户在 trap 之外已经先启了 vite，且 backend 没 daemon），**我会在最后一步 kill backend**
- [x] vite (PID 24969) 由用户先启，**不动**（按硬约束"复用用户已起的"原则）
- [x] 截图都在 `docs/round-5-experience/screenshots/`
- [x] 报告已写到 `docs/2026-05-25-round-5-experience-report.md`
- [x] 也产出辅助数据：`docs/round-5-experience/playwright-v2-raw.json` (consoleErrors + netErrors + findings)、`docs/round-5-experience/thread-interactive.json`（56 个可交互元素详单）、`docs/round-5-experience/playwright-driver-v2.ts` 体验脚本本身

## 最高优先级 Supervisor 派单建议

1. **派 AgentOfExecutable + AgentOfObservable 联合**：定位并修复 thread-scoped `/api/runtime/flows/.../permission`、`.../debug/loops`、`.../debug/loops/:loopIndex` 三条路由的 Elysia routing 冲突。修完同时加上 backend e2e be-1 (route audit) 防止 regression。**这一步是 P0-1 + P1-3 落地的唯一阻塞**。
2. **派 AgentOfVisible**: 修 H-1 (backend offline 误报) + H-2 (/files/* dead route) + M-7 (welcome composer 术语)。Quick wins，提升 Round 5 之后的 fresh-eye 体验。
3. **派 AgentOfProgrammable**: 给 supervisor 写一个真的 `stones/main/objects/supervisor/client/index.tsx`，作为 agent-native parity 的 first dogfood。
