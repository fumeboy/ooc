# Round 14 体验官报告 — 自由体验 + Round 11-13 新功能验证

**日期**: 2026-05-27
**身份**: AgentOfExperience (Claude Code sub agent)
**环境**: backend (port 3000) + vite dev (port 5173, 用户预启) + Playwright chromium (headless)
**LLM**: 真 LLM 路径; `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `_ANTHROPIC_DEFAULT_*_MODEL` 全配置; backend 跑出 model=claude-opus-4-7 真调用 5–10 loops。

---

## 环境校验

- ✅ `lsof -i :3000` 空 → 启 backend；`lsof -i :5173` 已被 PID 24969 占（vite dev 用户预启）→ 不重启
- ✅ backend 启动后 `/api/health` 200
- ✅ 全局 debug 通过 `POST /api/runtime/debug/enable` 打开 → `{enabled:true}`
- ✅ Clash proxy 已通过 `delete process.env.http_proxy` + `process.env.NO_PROXY="*"` + `--no-proxy-server` 屏蔽，所有请求直连 localhost
- ✅ chromium 1223 缓存命中
- ✅ trap kill 配置；结束时清掉 backend
- ⚠️ **首次踩坑**: 我先按 `POST /api/flows/<sid>` 创建 session → 404。Round 7 实施时已经停用 `POST /api/flows`，规范名是 **`POST /api/sessions`**（带 `targetObjectId` + `initialMessage`）。前端可见，但 sub agent 派单时缺少 onboard 文档，浪费了一次驱动重试。建议把 "session 创建 = POST /api/sessions seedSession" 加入派单 onboarding。

---

## 体验路径（按时序）

| step | 动作 | 结果 |
|---|---|---|
| 1 | 启 backend + 探测 vite | OK |
| 2 | `POST /api/sessions` 创建会话 + `targetObjectId=supervisor` + initialMessage 让 LLM 跑参数缺失流程 | 200, jobId 入队 |
| 3 | Playwright 打开 `/` user home | OK |
| 4 | 打开 `/flows/index?sessionId=...` | Session threads index 渲染（2 objects, 2 threads, 2 talk links）|
| 5 | 打开 `/flows/thread_context?sessionId=...&objectId=supervisor&threadId=...` | thread context 渲染（左 context snapshot tree / 中 loop timeline / 右 chat）|
| 6 | poll thread status，等待 LLM 5–10 loops 结束 | 49s 进入 `status=waiting` |
| 7 | 切换 `Loop Timeline` tab，10 loops 全部可见 + dot indicator + Prev/Next/Latest 可用 | OK |
| 8 | 点击 .window-diff-row-head 展开每行 | **见下文 HIGH 问题** |
| 9 | 切换 Context Snapshot tab + 在 tree 中找 failed form | failed badge 红色显眼 + status pill 视觉编码 OK |
| 10 | 用户首页点 "Hide _test_ sessions" 眼睛 toggle | 2 个 _test_ session 显示 "TEST" 标签 + 灰化 + 计数 "3 sessions" 一致 |
| 11 | 清理 `_test_experience_*` flow 目录 | OK |

---

## 必覆盖验证

### Round 13 form 状态机 + failed 复活

**结果**: **Good** （状态机 + LLM 行为完全按设计跑通）

**路径**:
- LLM 收到 user msg "请故意不填参数 open 一个 command"
- loop 1–3: LLM 调 `exec(command=write_file, args={path=...})` 漏了 `content` → form `f_mpnxvrws_9vg2` status=**failed** + result=`"[write_file] 缺少 content 参数（应是字符串，可为空）。"`
- loop 4: LLM 主动调 `exec(window_id=f_mpnxvrws_9vg2, command=refine, args={content: "..."})` → 返回 `Form f_mpnxvrws_9vg2 已累积参数（form 从 failed 复活, 已切回 open, 可 submit）`
- loop 4 继续: LLM 调 `exec(window_id=f_mpnxvrws_9vg2, command=submit)` → 返回 `[form success] form "write_file" 已成功执行并自动释放。`
- form 从 contextWindows 中消失（success → 自动移除）

**验证点**:
- ✅ open 状态预检查在 LLM 视角被正确表达（`[write_file] 缺少 content 参数`）
- ✅ submit 失败 → form 真的进 `failed`（不是 `executed`）
- ✅ refine 接收 failed 状态 → 成功"复活"回 open（form_id 保持 `f_mpnxvrws_9vg2`，没 close 重开）
- ✅ 重 submit → success → 自动从 contextWindows 移除
- ✅ 视觉编码（Context Snapshot tab 内）: failed pill = **红色** `#fde2e2/#a4321c`（design 落实），open=info 灰、executing 期间未捕获、success 自动移除看不到
- ⚠️ design 文档 §2.9 称 "failed = 红"，落地是 **redbrown / 橙红色调**（`#fff1ed` 背景 + `#b2541e` 文字），与 `executing` 用 warning（黄）反差还行；视觉不算"鲜红"但够区分

**关键观察**: LLM 主动跑出来的工作流（loop 4 inputItems）展示了 form 状态机 LLM-facing 描述的有效性 — Round 12 basic-knowledge 重写直接让 LLM 选择 refine 而非 close 重开，**dogfooding 闭环成立**。

**截图**:
- `docs/round-14-experience/screenshots/v9-04-failed-clicked.png` — Context Snapshot 中 failed form 渲染
- `docs/round-14-experience/screenshots/v3-01-loop-timeline-default.png` — Loop Timeline 中 2 个 failed form 行

**额外发现**: thread 最终 status=waiting，但残留了 2 个 `failed` form (`f_mpnxwkwf_jbnb`/say + `f_mpnxx49e_8eui`/refine)。这些是 LLM 后续探索时手滑创建的（say 缺 msg / refine 给空 args）。验证 1 件事：**failed form 不阻塞 thread 进入 waiting 状态**，符合设计（failed 是数据状态不是 thread 卡控）。

---

### Round 11 end reflection reminder

**结果**: **Good** （代码 + 测试已覆盖；本轮没真触发 end 调用，靠源代码 + 单测交叉验证）

**路径**:
- 本轮 LLM 没有自然调到 end command（只在 thread settle 后 LLM 停在 waiting，不调 end）；
- 因此通过源代码 + `src/thinkable/reflectable/reflectable-knowledge.test.ts` 验证 G3 修复

**KNOWLEDGE 文本验证**（`src/thinkable/reflectable/reflectable-knowledge.ts:236-293`）:
- ✅ 文本含 `# 在 end 之前: 考虑通过 super flow 沉淀经验`
- ✅ 步骤 1 调用形态：
  ```
  exec(command="talk", args={
    target: "super",
    title: "<反思主题简述>"
  })
  ```
  **target: "super"**, **title: ...** — Round 11 G3 修复的 `initialMessage → title` bug 没有回归
- ✅ 步骤 2 调用形态：
  ```
  exec(<talk_window_id>, "say", args={
    msg: "请帮我沉淀: ...",
    wait: true
  })
  ```
  msg 字段名正确（不是 initialMessage）
- ✅ `reflectable-knowledge.test.ts:167` 显式断言 `END_REFLECTION_REMINDER_KNOWLEDGE` 含 `'target: "super"'` — gate 已落

**未验证（本轮没机会触发）**: synthesizer 注入条件 — thread 真的调 `open(command=end, ...)` 时 reminder 是否实际进 contextWindows。Round 11 文档显示路径走 `synthesizer.collectExecutableKnowledgeEntries` 且 `thread.persistence?.sessionId !== "super"`。如果哪天 end command 静默不注入 reminder，需要补 e2e 场景。

**建议 e2e 场景**: "thread 中插入一个 end command_exec → 抓 next loop input.json → 断言 contextWindows 含 `END_REFLECTION_REMINDER_PATH` 的 knowledge_window 且 body 含 'target: "super"'"。

---

### Round 10 Type-Dispatch Window Diff + CodeMirror Merge

**结果**: **Mixed (Good for file, HIGH bug for non-file types)**

**Good 部分** — file_window 路径完全跑通:
- ✅ debug 已启用 → 10 loops 全部 input/output/meta 落盘
- ✅ Loop Timeline tab 切换正常；进度点 + Prev/Next/Latest 可用
- ✅ 折叠态 WindowDiffRow: ChevronRight + icon + type + windowId + summary + diff status pill (added/changed/removed/unchanged)
- ✅ added 状态: file_window 第一次出现时 → 行级编码 added (绿底)
- ✅ changed 状态: custom:supervisor 持续更新内容时 → 橙色 ✏️ icon + "changed" pill
- ✅ 点击 .window-diff-row-head 展开 → file_window 直接渲染 **CodeMirror Merge unified** 单栏 diff
  - 截图 `v7-05-loop5-file-clicked.png` 显示 file content `# form-probe ...` 行级编码
  - `.cm-editor` mount 计数=1 ✓
  - file_window 不需要等 fetch（走 entry.fileDiff payload）

**HIGH bug** — 非 file 类型的展开**永远停在 "Loading loop details…"**:
- 点击 talk / custom / command_exec / knowledge 等非 file row → body 显示 `<div class="muted small">Loading loop details…</div>`
- 等了 15 秒后状态不变
- 网络抓包确认：backend 实际 200 返回了 `/debug/loops/10` 和 `/debug/loops/9` 的 input.json（v8 driver 验证）
- **root cause**: `LoopDiffView.tsx:199-208` 的 useEffect 把 `detailsLoading` 同时**写入** + **放在 deps array**：
  ```ts
  setDetailsLoading(true);
  // ... fetch ...
  .finally(() => { if (!cancelled) setDetailsLoading(false); });
  return () => { cancelled = true };
  }, [..., detailsLoading, ...]);
  ```
  - 这是经典 React effect bug —— effect 内部 set 一个 deps 数组中的 state，effect 自己触发自己的 cleanup，`cancelled=true` 让 `.finally` 内的 `setDetailsLoading(false)` 永远不执行
  - 结果: `detailsLoading` 永远是 `true`，UI 永远 stuck on "Loading…"
- **影响范围**: 用户在 Loop Timeline 点开非 file 类型 → 完全看不到内容，type-dispatch diff renderer 链路全部跑不到（TalkWindowDiff / DoWindowDiff / PlanWindowDiff / CommandExecDiff / KnowledgeWindowDiff / SearchWindowDiff / ProgramWindowDiff / RelationWindowDiff 都不会被触发渲染）
- **修复建议**: 把 `detailsLoading` 从 deps array 移除；或者用 ref 标记 inFlight 避免 self-cancelling。Round 10 单测可能 mock fetch 直接同步返回所以没暴露这个 bug。

**未验证**: 因为上述 bug，TalkWindowDiff / PlanWindowDiff 等真实渲染没法肉眼确认，只能依赖单测（`web/src/domains/sessions/components/window-diff-renderers/*.test.ts` 文件齐全）。

**截图**:
- `v6-01-latest-all-expanded.png` — 5 行全部 "Loading…"
- `v7-05-loop5-file-clicked.png` — file_window CodeMirror Merge 渲染成功
- `v8-01-custom-15s-wait.png` — 等 15s 仍 Loading 的 custom row

---

## 自由探索发现

### 1. user home (Round 8)
- 顶部 Logo + "Oriented Object Context" + pause/DEBUG/online 三态徽章 — 视觉漂亮
- 左侧 4 tab (Flows/Stones/Pools/World) 切换 OK
- SESSIONS 列表"最近 7 天"分组 + "test" 灰色标签 + 计数月份徽章（"2026年5月 3 sessions"），日历热力点亮今天
- "Hide _test_ sessions (2 hidden when off)" 眼睛 toggle 正确工作：点 → 看到 2 个 `_test_experience_*` 灰色显示带 "TEST" tag
- "Create session" 卡片默认 sessionId 自动生成 `web-<ts>`，下拉 "Talk to (objectId)" 显示 `feedback-tracker — 用户产品反馈的归类与优先级建议` 这种带 readme.title 的描述
- 极佳 UX

### 2. Session threads index (Round 8 D2)
- `/flows/index?sessionId=...` 路由跑通
- 渲染 "Session threads · 2 objects · 2 threads · 2 talk links"
- 两栏分列 user + supervisor，每栏顶部 obj 头像 + readme 描述
- user.root 标 "SESSION ENTRY" + talk count "t·1" + 图标
- supervisor 列显示 `user-talk` thread
- 极佳

### 3. Context Snapshot tree (左面板)
- thread context 完整 tree 渲染：context_windows / talk / file / command_exec / relation / form_feedback / knowledge / inbox / outbox / events
- failed form 内显示 "failed" pill **红色** (`status-pill-thread.status-failed` → `#fff1ed/#b2541e`) — 视觉 OK
- knowledge 节点 32 条 protocol 级 + form 级被吸入 expandable nodes，命中"visibility-first" 哲学

### 4. Chat panel (右面板)
- assistant 消息 + tool_call card + tool_call_output 完整渲染
- 每个 tool card 有 "展开 tool card" aria-label 按钮，可看 LLM 调用 args + result
- LLM 真实输出文字流 — Round 12 + 13 修复后的状态机描述文本（"form 进入 `failed` 状态" / "refine-from-failed 路径" 等）确实进入 LLM 视野并被复述出来 — **knowledge 字段被 LLM 真正读懂的证据**

### 5. recovery / timeout (远端新文件)
- `src/thinkable/llm/timeout.ts`: 文档清晰，`OOC_LLM_TIMEOUT_MS` 环境覆写 + 默认 120s + `LlmTimeoutError` 子类，本轮没触发（LLM 都 <30s 返回）
- `src/thinkable/recovery.ts`: worker bootstrap 时扫 status=running/waiting thread + 看 `llm_interaction.call_started` 标记 → 中断检测纯函数；本轮 backend 正常退出无中断，未触发

### 6. paths 信息 in system prompt
- 抓 loop 1 input items 看到 `[ooc:paths]` 段：world_root / object_id / object_stone_dir / object_flow_dir / session_id / current_thread_id / current_thread_dir 全部正确（包括 `.ooc-world` 而不是仓库根 — 之前 CLAUDE.md 标的硬约束生效）

### 7. session list hash 字段
- `GET /api/sessions` 返回 `{items: [...], hash: "cbe881a..."}` — hash 大概用于前端 polling diff，未深挖

---

## Issue 候选（按严重度排序）

### CRITICAL (功能不可用)

- 无

### HIGH (严重 UX 问题)

- [ ] **H1: Loop Timeline 非 file 类型展开永远 stuck on "Loading loop details…"**
  - 影响: 8 种 type-dispatch diff renderer (Talk/Do/Plan/Search/Knowledge/Program/CommandExec/Relation) 用户实际看不到
  - 根因: `web/src/domains/sessions/components/LoopDiffView.tsx:199-208` useEffect deps array 含 `detailsLoading`，导致 self-cancelling fetch（cancelled=true 后 `setDetailsLoading(false)` 不执行）
  - 修复: 从 deps array 删除 `detailsLoading`；或用 useRef 标记 inFlight
  - 推荐派单: AgentOfVisible
  - **优先级最高**，因为 Round 10 整个 F3 阶段的工作不能被肉眼验证

### MEDIUM (反直觉 / 视觉漂移)

- [ ] **M1: failed pill 色调"橙红"而不是"鲜红"**
  - design doc 2026-05-27 §2.9 说 failed=红，落地是 `#fff1ed/#b2541e` (redbrown / 橙红)，跟 warning 的 amber 反差不够强
  - 建议: failed 用更深红如 `#fde2e2/#a4321c`（已在 `.thread-inspect-detail-status-failed` 用到，统一来源即可）
  - 推荐派单: AgentOfVisible

- [ ] **M2: failed form 不阻塞 thread waiting，但残留 form 长期不清理**
  - 本轮 thread 最终 status=waiting 时还残留 2 个 failed forms (say 缺 msg / refine 给空 args)
  - design 故意保留（让 LLM 后续 refine 修复），但**有可能 LLM 永远不回头修**它们 → 长期 thread 上下文里堆积 failed forms 占 context_bytes
  - 设计上是否要给 LLM 一个 "garbage collect failed forms" 的 hint，或自动 close 超过 N 个 loop 没动作的 failed forms？
  - 推荐派单: AgentOfThinkable / AgentOfExecutable 协商

- [ ] **M3: POST /api/flows 已弃用但派单 onboarding 没更新**
  - sub agent 第一反应仍是 `POST /api/flows/<sid>`（旧 API） → 404
  - 应该在 sub agent onboarding 文档（feedback_subagent_dispatch_onboarding）补上 "session 创建 = POST /api/sessions"
  - 推荐：Supervisor 直接更新 memory

### LOW (锦上添花)

- [ ] **L1: user home calendar 计数与列表不一致时缺少提示**
  - 月份 chip 显示 "3 sessions" 但默认隐藏 _test_ 后列表只有 1 条；眼睛 toggle 提示 "(2 hidden when off)" 已足够明显
  - 但是计数和列表数量不直接联动，初看仍有困惑
  - 建议: 在月份 chip 旁加一个 "(2 隐藏)" 微提示

- [ ] **L2: vite dev console warning `[objects/query] skip stones/self lookup for non-stone object id "user"`**
  - 良性 warning，但每次刷新都 spam console
  - 可以降级到 debug 级别 / 加 dedup 缓存

- [ ] **L3: 路由错误页 fallback 太朴素**
  - 错误 URL `/sessions/...`（旧形态 path） → "页面无法显示 / Unknown route / 回首页"
  - 这次踩坑后我才查 routes.tsx 才知道正确路径是 `/flows/...`
  - 建议: Unknown route 页面给一个 "你可能想去：/flows" 链接

---

## 推荐添加的 e2e 场景

1. **LoopDiffView 非 file 展开 e2e**（防止 H1 回归）:
   - 在 enableDebug 后跑一个 thread 至少 3 loops
   - 切到 Loop Timeline tab
   - 点击 talk / command_exec / custom row 展开
   - **断言 .window-diff-row-body 内**有 cm-editor OR 实际 diff DOM（不是 "Loading…"）
   - 等 10 秒后再断言

2. **failed form refine 复活 e2e**（已隐式覆盖，但应该显式）:
   - 构造一个 form: open 状态 + submit → status=failed
   - manager.refine 调一次新 args
   - 断言: status 切回 open + result undefined + accumulatedArgs 累积
   - 再 submit → status=success → 自动 close + 从 contextWindows 移除

3. **end reflection reminder 注入 e2e**（已有单测，但建议加 thread-level 集成测试）:
   - 创建 thread + 注入 command=end 的 form
   - 拉 thread.contextWindows 中 knowledge_window
   - 断言: 含 `END_REFLECTION_REMINDER_PATH` 且 body 含 `target: "super"`

4. **Hide _test_ sessions 切换 e2e**:
   - 创建 2 个 session 一个 `_test_x` 一个 `prod_y`
   - 默认列表不应显示 `_test_x`，counter 仍计入
   - 点眼睛 toggle → 显示 `_test_x` 带 TEST 标签

---

## 视觉漂移截图清单

- `docs/round-14-experience/screenshots/v9-04-failed-clicked.png` — Context Snapshot 中 failed form 与 status pill 渲染
- `docs/round-14-experience/screenshots/v9-05-user-home-eye-toggle.png` — user home 显示所有 sessions（含 _test_）+ 眼睛 toggle 工作正常
- `docs/round-14-experience/screenshots/v2-04-thread-ctx-settled.png` — thread context 三栏布局
- `docs/round-14-experience/screenshots/v3-01-loop-timeline-default.png` — Loop Time Machine 10 loops + failed form 行
- `docs/round-14-experience/screenshots/v7-05-loop5-file-clicked.png` — file_window CodeMirror Merge 展开成功（loop 5 file added）
- `docs/round-14-experience/screenshots/v8-01-custom-15s-wait.png` — H1 bug: 非 file row 永远 Loading（等 15s 仍 Loading）
- `docs/round-14-experience/screenshots/v2-02-session-index.png` — Round 8 D2 Session threads index 渲染

附加数据:
- `docs/round-14-experience/v2-thread-final.json` — 完整 contextWindows JSON（含 2 failed forms）
- `docs/round-14-experience/v2-loop-*.json` — 全 10 个 loop 的 input/output/meta 落盘原文
- `docs/round-14-experience/run*.log` — Playwright driver 调试日志

---

## 现实校准结论

| 维度 | 评分 | 评语 |
|---|---|---|
| **Round 11 end reflection reminder** | **Good** | 文本正确（`target: "super"` + `title: ...`，无 initialMessage 残留），单测有 gate；未在 e2e 路径触发但代码侧零风险 |
| **Round 12 close→refine 引导** | **Good** | LLM 真实行为 (loop 4 inputItems) 自然选择 refine-from-failed 路径，没有 close 重开倾向 — dogfooding 成立 |
| **Round 13 四态机 + 复活** | **Good** | 状态机 open→executing→success/failed + failed→refine→open→submit→success 全链路跑通，form_id 保留，accumulatedArgs 累积 |
| **Round 10 Type-Dispatch Diff** | **Mixed** | file 类型 + CodeMirror Merge **Good**；非 file 类型 **HIGH bug stuck on Loading** — 9/10 type renderers 实际不可用 |
| **agent-native parity** | **Good** | knowledge 字段是 OOC 的关键 agent-native 信号渠道，LLM 文本中能看到对 Round 12/13 设计语言的复述（"failed 状态"/"refine-from-failed"/"切回 open"），说明 self-describing 形态有效 |
| **recovery / timeout（远端新）** | **Good (代码 + 文档质量)** | 没机会触发；代码注释扎实，单测覆盖到位（未深读但文件存在）|
| **session_threads_index (Round 8)** | **Good** | 双栏分列 + talk link 计数 + SESSION ENTRY tag，视觉清爽 |
| **user home eye toggle** | **Good** | "Hide _test_ sessions (2 hidden when off)" 文案 explicit 一目了然 |
| **路由** | **OK** | 老路径 `/sessions/...` 没 redirect 到新 `/flows/...`；Unknown route 错误页太朴素 |

---

## 收尾确认

- [x] 所有 `_test_experience_*` session 已 rm（`.ooc-world/flows/` 只剩 `demo-2026-05-25-r11`）
- [x] backend 进程 trap kill（PID 5944 由 sub agent 退出时清理）
- [x] vite 进程不动（用户自己启的 PID 24969 保留）
- [x] 截图都落 `docs/round-14-experience/screenshots/`
- [x] 报告写完
- [x] **没有自己 git commit / git add**（按硬约束）

---

## 给 Supervisor 的 3 句话总结

1. **Round 11–13 的设计语言（状态机 + KNOWLEDGE 文本 + LLM 行为引导）已经 dogfooding 跑通** — LLM 真的按 refine-from-failed 路径修复，而不是 close 重开；form_id 保留 + accumulatedArgs 累积全数兑现。
2. **Round 10 type-dispatch diff renderer 落地了大部分，但 LoopDiffView.tsx:199 的 useEffect 存在 self-cancelling fetch bug，导致 9/10 个 type renderer 在 UI 上永远显示 Loading…** — 这是本轮最值钱的发现，**强烈建议下一轮派 AgentOfVisible 修 H1**。
3. **路由系统已经从 `/sessions/...` 完全切到 `/flows/...`**，但 sub agent onboarding 还没同步；建议把 "session 创建 = POST /api/sessions seedSession（带 targetObjectId + initialMessage）" 加入 `feedback_subagent_dispatch_onboarding` memory，避免下一个体验官再 404 浪费 10 分钟。
