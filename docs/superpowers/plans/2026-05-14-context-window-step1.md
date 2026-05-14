# Context Window Step 1 Implementation Plan

> Goal: 把 spec `2026-05-14-context-window-unification-design.md` 中 **Step 1（本次工作范围）** 的 9 项落地。
>
> **Architecture:** flat `contextWindows: ContextWindow[]` 取代 `activeForms` + `windows`；root window 隐含；`command_exec` 是 form 的新身份；`do_window` 替代隐式子线程感知；`todo_window` / 初始 creator window 同步引入；`waitingType` 取消；`open` tool 落 C 规则。

> **强制工程基线（来自 spec §工程质量基线）：**
>
> - 不允许双轨字段（旧 `activeForms`/`windows` 一次性删，不与新 `contextWindows` 并存）
> - 每个非显然抉择点必须在源码注释里指向 spec 章节
> - 老 do/talk/program 集成测试不允许退化（在 Task 14 集中修复）
> - 不留 TODO；step 1 列表里每条都要有源码或测试落点

> **执行节奏：**
>
> 本次改动跨多个核心模块（context/forms/tools/commands/scheduler/persistable），强行"每个 task 边写边修测试"会造成多轮反复 + 阶段性测试套件不可运行的尴尬。
>
> 因此采用 **"先改代码、最后统一修测试"** 节奏：
>
> - **Task 1 ~ Task 13**：只动产品代码与 meta 文档；中间允许 `bun test` 不绿；仅保证 `bunx tsc --noEmit` clean
> - **Task 14（最后）**：集中修复 / 重写所有受影响测试，单元测试 + 集成测试一次性收口
>
> 每个 Task 仍各自 commit，便于回溯；commit message 不带 test 改动除非该 commit 必须连带测试才能 tsc clean。

---

### Task 1: 数据类型 — `ContextWindow` 抽象 + 各 type narrow

**Files:** `src/executable/windows/types.ts`（新）、`src/thinkable/context/index.ts`（改 ThreadContext）

- [ ] 新建 `src/executable/windows/types.ts`，定义：
  - `WindowType = "root" | "command_exec" | "do" | "todo"`（step 1 范围；talk/program/file/knowledge 留 step 2 不在 union 里出现，避免假装实现）
  - `WindowStatus`（per-type 状态机；command_exec 沿用 open/executing/executed）
  - `BaseContextWindow` 接口（id / type / parentWindowId? / title / status / createdAt / windowKnowledgePaths）
  - 各 type 的 narrow：`CommandExecWindow` / `DoWindow` / `TodoWindow` / `RootWindow`
  - `ContextWindow` discriminated union
- [ ] 改 `src/thinkable/context/index.ts` 的 `ThreadContext`：
  - **删** `activeForms` / `windows` / `pinnedKnowledge` / `waitingType` / `awaitingChildren`
  - **加** `contextWindows: ContextWindow[]`（必填）
  - **加** `threadLocalData?: Record<string, unknown>`（program_window step 2 用，先占位）
- [ ] `bunx tsc --noEmit` 通过（其他文件不可避免要调用方更新；本任务只把签名改对，不动其余逻辑）
- [ ] Commit `feat(windows): introduce ContextWindow types and ThreadContext reshape`

---

### Task 2: WindowRegistry — 统一 window 行为表

**Files:** `src/executable/windows/registry.ts`（新）、`src/executable/windows/index.ts`（新 barrel）

- [ ] 定义 `WindowTypeDefinition`：
  - `type`：window 类型名
  - `commands?: Record<string, CommandTableEntry>` —— 该 window 注册的 command（沿用 `CommandTableEntry`）
  - `onClose?(window, thread)`：close 时副作用（do_window 的 archive 子线程、todo_window 的释放等）
  - `renderXml?(window, thread)`：返回 XmlNode，渲染层调用
- [ ] 实现 `WINDOW_REGISTRY: Record<WindowType, WindowTypeDefinition>`
  - `root`：commands = 现有 `COMMAND_TABLE`（do/talk/program/plan/end/todo 全集）
  - `command_exec`：commands 空（form 上不能再 open command）
  - `do`：commands = { continue, wait, close }；do_window 的 close 副作用走 onClose
  - `todo`：commands 空；只能被 close
- [ ] Commit `feat(windows): window registry with per-type commands and lifecycle hooks`

---

### Task 3: WindowManager — 替换 FormManager

**Files:** `src/executable/windows/manager.ts`（新）、`src/executable/forms/`（**整目录删除**）

- [ ] 实现 `WindowManager` 类，方法对齐 spec 5 原语：
  - `openCommandExec(parentId, command, title, args?)` —— 返回 windowId；处理 C 规则判定（详见 Task 5，本任务先留接口，C 规则在 Task 5 接进来）
  - `refine(formId, args)` —— 仅 command_exec window 能 refine；累积 args + 重算 commandPaths
  - `submit(formId)` —— open → executing → executed；调 command.exec；**成功自动从 contextWindows 移除**；失败保留
  - `close(windowId)` —— 触发 type 的 onClose；级联关闭 sub-window；释放 knowledge 引用
  - `openTypedWindow(type, title, init)` —— 用于 do_window / todo_window 等非 form 的 window 创建
  - `getWindow(id)` / `getChildren(parentId)` / `toData()` / `fromData()`
- [ ] **删** `src/executable/forms/form.ts` + `__tests__/`；所有引用方（submit tool / open tool / context 渲染 / commands）下面任务里逐个改
- [ ] Commit `feat(windows): WindowManager replacing FormManager`

---

### Task 4: 改造 5 原语 tool — open / refine / submit / close / wait

**Files:** `src/executable/tools/open.ts` `refine.ts` `submit.ts` `close.ts` `wait.ts`（全部重写）

- [ ] **open**：
  - 入参 schema：`window_id?`（parent，默认 root）、`command`、`title`（必填）、`args?`、`description?`
  - 删 type=knowledge / type=file 分支（step 2 再回归）
  - 调 `WindowManager.openCommandExec`，C 规则判定在 Task 5 接进来；本任务先把 args 透传到 refine
- [ ] **refine**：参数照旧（form_id, args），底层改调 WindowManager
- [ ] **submit**：
  - 删 form 不存在 / 不在 open 的判断分支（WindowManager 内部已处理）
  - submit 后**不再返回 result 文本**——result 已写到 form.result 字段，渲染层自然投影；返回值仅是确认 message
  - 成功后系统层移除 form，工具返回提示"form 已成功执行并自动释放"
- [ ] **close**：参数 `window_id`，调 WindowManager.close；删原有 form-only 逻辑
- [ ] **wait**：仅设置 `thread.status = "waiting"`；删 waitingType 相关字段写入
- [ ] 每个 tool 文件顶部加 docstring，注明对应 spec § 5 原语在新模型下的精确语义
- [ ] Commit `refactor(tools): rewrite 5 primitives against ContextWindow model`

---

### Task 5: open tool 落地 C 规则

**Files:** `src/executable/tools/open.ts`、`src/executable/windows/manager.ts`

- [ ] 在 `WindowManager.openCommandExec` 中实现 C 规则：
  ```
  baselinePaths     = command.match({})
  baselineKnowledge = command.knowledge({}, "open")
  if args 非空:
      apply_refine(form, args)
      nextPaths     = command.match(args)
      nextKnowledge = command.knowledge(args, "open")
      if setEqual(baselinePaths, nextPaths) and setEqual(baselineKnowledge keys, nextKnowledge keys):
          submit(form)  // 走与 LLM 显式 submit 相同的路径
  ```
- [ ] open tool 返回值区分两种情况：
  - 常规：`Form ${formId} 已创建（${command}），后续 refine/submit/close 引用该 form_id`
  - C 规则触发：`Form ${formId} 已基于完整参数自动 submit；执行结果见下一轮 context`
- [ ] 源码注释指向 spec § C 规则的判定算法
- [ ] Commit `feat(open): C-rule auto-submit when args fully specify command`

---

### Task 6: do command 重写为 do_window 产物

**Files:** `src/executable/commands/do.ts`、`src/executable/windows/do.ts`（新 do_window 实现）

- [ ] `src/executable/windows/do.ts`：
  - 实现 do_window 的注册：commands = { continue, wait, close }
  - `continue` command：args = { msg, wait? }；写 child inbox + 父 outbox + 记 inbox_message_arrived；wait=true 父 status="waiting"
  - `wait` command：args 空；父 status="waiting"
  - `close`（onClose hook）：标记 child thread paused（若 running）/ 保持 done|failed；释放 do_window
- [ ] `src/executable/commands/do.ts`（root 上的 do command）：
  - submit 副作用：
    1. 在 root 下创建 child thread（id 生成、persistence ref 派生）
    2. 创建 do_window（type=do, targetThreadId=childId, title=args.msg 或 description 截断），加入父的 contextWindows
    3. 在 child 的 contextWindows 中自动放入指向父 thread 的初始 creator do_window（详见 Task 7）
    4. 写 inbox/outbox + inbox_message_arrived 事件
    5. wait=true 则父 status="waiting"
  - knowledge() 增加 form 状态提示（对照 talk 已有写法），覆盖 executing/executed 状态
- [ ] 注释指向 spec § do_window 章节
- [ ] Commit `feat(do): rewrite do command to produce do_window with continue/wait/close`

---

### Task 7: 初始 creator do_window — thread 启动钩子

**Files:** `src/thinkable/context/index.ts`（或新增 `src/thinkable/context/init.ts`）、`src/app/server/runtime/*`（凡是创建 thread 的入口）

- [ ] 新增 `initContextWindows(thread, opts)`：
  - 任何新 thread 创建时必调
  - 根据 `opts.creatorThreadId` 派生固定 windowId（约定 `w_creator_${threadId}`）
  - title = opts.initialTaskTitle（root thread 来自 session 任务；child thread 来自 fork msg）
  - targetThreadId = creatorThreadId（root thread 用约定值 `"__session__"`）
  - status = "running"，**不可被 close**（onClose hook 拒绝并写 inject 事件提示）
- [ ] 找到所有创建 thread 的入口并接入：
  - root thread：`src/app/server/modules/flows/service.ts` 中 makeRootThread / 启动逻辑
  - child thread：`src/executable/commands/do.ts` 中 submit 的 fork 副作用（Task 6 同步落）
  - 反序列化恢复（readThread）：若旧数据没有 creator window 字段，启动时补一次（容忍历史数据）
- [ ] 注释指向 spec § 初始 creator 对话 window
- [ ] Commit `feat(thread): auto-create creator do_window on thread init`

---

### Task 8: todo command 升级为 todo_window

**Files:** `src/executable/commands/todo.ts`、`src/executable/windows/todo.ts`（新）

- [ ] 新 `src/executable/windows/todo.ts`：注册 todo_window；commands 空；onClose 释放 window
- [ ] 改 root 的 todo command：
  - submit 副作用 = 创建 todo_window（title=args.content 截断、保存 on_command_path）
  - knowledge() 在 args.content 已具备时不再追加 input 提示（让 C 规则在 open 时直接命中 → 自动 submit 直建 todo_window）
- [ ] Commit `feat(todo): upgrade todo to todo_window with direct creation via C-rule`

---

### Task 9: 渲染层 `<context_windows>` 替换 `<active_forms>` / `<windows>`

**Files:** `src/thinkable/context/render.ts`

- [ ] 删 `renderActiveFormsNode` / `renderWindowsNode`
- [ ] 新增 `renderContextWindowsNode(thread)`：
  - 按 parentWindowId 折叠成树（parent → sub_windows[]）
  - 每个 window 调 `WINDOW_REGISTRY[type].renderXml(window, thread)`
  - 默认渲染：`<window id type status title><sub_windows>...</sub_windows></window>`
  - command_exec 渲染：accumulated_args / command_paths / loaded_knowledge / result（仅 status=executed 时）
  - do_window 渲染：target_thread / topic / transcript（按 targetThreadId 过滤 inbox+outbox 子集）
  - todo_window 渲染：content / on_command_path
- [ ] inbox/outbox 顶层渲染只展示**未被任何 window 视图收纳**的兜底消息（避免重复）
- [ ] 注释指向 spec § 渲染示例
- [ ] Commit `refactor(context): render context_windows replacing active_forms and windows`

---

### Task 10: scheduler / wait 简化 — 取消 waitingType

**Files:** `src/thinkable/scheduler.ts`

- [ ] 重写 `wakeParentsWaitingForChildren` → `wakeWaitingThreadsOnInbox`：
  - 收到 inbox 新消息（`inbox.length > 入眠时刻 snapshot.length` 或 createdAt > thread.lastWaitedAt）即唤醒
  - 系统层在子线程结束时主动给父线程 inbox 写 system 消息（替代旧 await_children 隐式唤醒）
- [ ] 删 ThreadContext 上对 `waitingType` / `awaitingChildren` 的所有引用（之前 Task 1 已删字段，本任务清扫遗留逻辑）
- [ ] 注释指向 spec § 等待语义的简化
- [ ] Commit `refactor(scheduler): drop waitingType, wake on inbox message`

---

### Task 11: 持久化字段迁移

**Files:** `src/persistable/thread-json.ts`

- [ ] readThread 反序列化兼容：
  - 旧 thread.json 含 `activeForms` / `windows` / `pinnedKnowledge` / `waitingType` / `awaitingChildren` 时 → 转换：
    - activeForms → contextWindows（type=command_exec）
    - windows → 丢弃并记 warn（step 2 才回归 file/knowledge window）
    - pinnedKnowledge → 丢弃（step 2 再做）
    - waitingType / awaitingChildren → 丢弃；status=waiting 自然由 inbox 唤醒
  - 同时启动 `initContextWindows` 兜底补 creator window（如果 contextWindows 不含）
- [ ] writeThread 不变（直接序列化新字段）
- [ ] Commit `feat(persistable): backward-compatible read for ContextWindow reshape`

---

### Task 12: meta 文档同步（最小集）

**Files:** `meta/object/executable/actions/commands/do.doc.js`、`meta/object/executable/actions/commands/todo.doc.js`、`meta/object/executable/index.doc.js`、`meta/iteration.doc.js`

- [ ] do.doc.js：写明新模型下 fork = open root.do + 自动产生 do_window；continue 走 do_window.continue
- [ ] todo.doc.js：写明 todo 通过 C 规则直建 todo_window
- [ ] executable/index.doc.js：补充 ContextWindow 抽象介绍 + 链接到本 spec
- [ ] iteration.doc.js：在阶段 8 之后追加阶段 9 节点："context-window-step1"，指向本 spec + 本 plan
- [ ] Commit `docs(meta): align command docs with ContextWindow step1`

---

### Task 13: 统一修复 / 重写所有测试（最后阶段）

**Files:**

- 单元测试：`src/executable/__tests__/*` `src/thinkable/__tests__/*` `src/persistable/__tests__/*` `src/app/server/runtime/*.test.ts`
- 集成测试：`tests/integration/*.integration.test.ts`

本任务集中处理 Task 1 ~ Task 12 累计造成的所有测试失败，按以下顺序：

- [ ] 第一轮：删除已不再适用的旧测试（FormManager 内部行为测试、awaitingChildren 测试、activeForms shape 测试）
- [ ] 第二轮：调整断言到新 shape：
  - `child.activeForms` → `child.contextWindows`
  - `parent.awaitingChildren === [...]` → `parent.status === "waiting"`
  - active_forms XML 节点 → `<context_windows>` 嵌套结构
- [ ] 第三轮：补新单元测试（每条对应 spec 的非显然抉择）：
  - **WindowManager 生命周期**：command_exec open → refine → submit → 自动消失；submit 失败保留 result；close 级联；knowledge 引用计数
  - **C 规则**：args 触发新 path 不自动 submit / 触发新 knowledge 不自动 submit / 完整且无新 path/knowledge 自动 submit / 自动 submit 后失败保留
  - **do_window**：fork 创建 do_window + child；continue 走 do_window.continue；wait 后 status=waiting；close 后 child paused
  - **初始 creator do_window**：root thread 创建后即有 creator window；fork child 后 child 自动有指向父的 creator window；close creator 失败
  - **todo_window**：直建（C 规则命中）；close 后释放
  - **scheduler 唤醒**：fork+wait → child end → 父 inbox 收到 system 消息 → 父唤醒；多次 wait 不丢消息
  - **持久化兼容**：旧 thread.json 反序列化后 contextWindows 正确填充，warn 输出 file/knowledge 字段被丢弃
  - **渲染**：空 contextWindows 不输出 `<context_windows>`；creator window 单独渲染；嵌套 sub_windows；inbox 顶层兜底过滤
- [ ] 第四轮：跑 `bunx tsc --noEmit` + `bun test`（不含 integration）全绿
- [ ] 第五轮：跑 `bun --env-file=.env test tests/integration` —— 9 个真 LLM 端到端场景全部 PASS；需要时同步调整 prompt 中描述的"continue 走法"（do command 的 KNOWLEDGE 文本说"通过 do_window 上的 continue command 追加"）
- [ ] Commit（一次或两次，最大 commit 不超过：1) 单元测试调整 + 新增；2) 集成测试调整）：
  - `test: rewrite unit tests for ContextWindow model`
  - `test(integration): adapt do/program scenarios to ContextWindow model`

---

## 完成判据

1. `bun test` 全绿（含 `tests/integration`）
2. `bunx tsc --noEmit` clean
3. 全文搜索：源码与 meta 中不再出现 `activeForms` / `pinnedKnowledge` / `waitingType` / `awaitingChildren`（持久化反序列化兼容代码除外）
4. 新建一个 root thread → 第一轮 buildContext 输出的 `<context_windows>` 至少含一个 creator do_window
5. LLM 用 `open(root, "do", args={msg:"...", wait:true})` 一次调用即完成 fork + wait（C 规则触发自动 submit）
6. spec 中 Step 1 的 9 项每条都有源码或测试落点
