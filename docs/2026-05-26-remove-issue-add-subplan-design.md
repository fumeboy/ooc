# Round 7 Design — 移除 issue + plan window 支持 sub plan 与 sharing

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-26
**性质**：design + 实施 plan（user 拍板后落地）
**触发**：user 决定 "issue 功能还没想清楚, 先移除"; "plan 升级为 ContextWindow + 支持 sub plan + 通过 do command share 给 sub thread"

---

## 1. 两段范围概览

| 段 | 性质 | 范围 |
|---|---|---|
| **A** 移除 issue | 减法 | 删除 backend + web + meta + tests 中 issue 看板相关全部代码与文档；保留 stone-versioning 中的 "PR-Issue" 概念（不同事物） |
| **B** plan window 升级 | 加法 | 新增 `plan_window` window type；`plan` 命令派生 plan_window；plan_window 支持 sub plan（嵌套）；通过 `do_window.move` / `do.share_windows` 共享给 sub thread |

A 与 B 互相独立但同一 Round 完成；A 先（清场）B 后（新增）。

---

## 2. A 段 — 移除 issue 完整盘点

### 2.1 后端代码（删 / 改）

**删整文件**：
- `src/persistable/issue.ts`
- `src/persistable/issue-service.ts`
- `src/persistable/__tests__/issue-service.test.ts`
- `src/persistable/__tests__/issue.test.ts`
- `src/persistable/__tests__/pr-issue.test.ts` ⚠️ 内容是 stone-versioning 的 "PR-Issue"（冲突决策命名），与 issue 看板**不是同一概念** —— **保留这个文件**，但里面的 import 可能引用 issue.ts —— 实施时核验
- `src/executable/windows/issue/` 整目录（`index.ts` + `types.ts`）
- `src/executable/windows/root/command.create-issue.ts`
- `src/executable/windows/root/command.open-issue.ts`
- `src/app/server/modules/issues/` 整 module（`index.ts` + `model.ts`）

**改文件（删 issue 引用）**：
- `src/executable/windows/_shared/types.ts` — `WindowType` 联合去 `"issue"`
- `src/executable/windows/_shared/registry.ts` — 去 issue 注册（如有）
- `src/executable/windows/index.ts` — 去 issue 模块 import
- `src/executable/windows/root/index.ts` — 去 create-issue / open-issue 引用
- `src/executable/tools/exec.ts` — 去 issue 相关 path 处理（如有）
- `src/persistable/index.ts` — 去 issue export
- `src/persistable/common.ts` — 去 issue ref 类型（如有）
- `src/persistable/thread-json.ts` — 去 issue 持久化处理
- `src/persistable/stone-versioning.ts` — 仅去 "issue 看板"引用，**保留 PR-Issue 决策概念**
- `src/persistable/stone-git.ts` — 同上
- `src/thinkable/knowledge/synthesizer.ts` — 去 issue knowledge 注入
- `src/thinkable/knowledge/activator.ts` — 去 issue activation
- `src/thinkable/knowledge/basic-knowledge.ts` — 去 issue 基础知识
- `src/thinkable/reflectable/reflectable-knowledge.ts` — 去 issue 引用
- `src/app/server/index.ts` — 不挂 issuesApi
- `src/app/server/modules/flows/api.create-session.ts` — 去 issue 相关参数（如有）
- `src/app/server/modules/flows/service.ts` + `service.test.ts` — 去 issue 引用
- `src/app/server/modules/flows/model.ts` — 去 issue schema
- `src/app/server/modules/stones/{api.put-knowledge-file,versioning-helper,service}.ts` — 去 issue 相关
- `src/app/server/runtime/worker.ts` — 去 issue watcher / dispatch
- `src/app/server/bootstrap/supervisor-seed.ts` — 删 using-issues.md seed knowledge 写入 + self.md 含 issue 描述段
- `src/app/server/bootstrap/ensure-supervisor.ts` — 同上
- `src/observable/index.ts` — 去 issue ProcessEvent type（如有）

**新 e2e / 单测调整**：
- `tests/e2e/backend/permission-q0b.test.ts` — 删 create_issue / open_issue / issue.comment 相关 case（permission 默认 policy 表里有它们）
- `tests/e2e/backend/route-audit.e2e.test.ts` — 去 `/api/flows/:sid/issues` 等 issue 路由（如果在 audit 名单内）
- `tests/e2e/` 下任何 issue 场景文件 — 删
- `src/executable/windows/root/__tests__/command.metaprog.test.ts` — 看是否引用 issue
- `src/persistable/__tests__/stone-versioning.test.ts` — 保留 PR-Issue 测试

### 2.2 Web 前端代码（删 / 改）

**删整目录**：
- `web/src/domains/issues/` 整目录（含 `model.ts` / `query.ts` / `index.ts` / `components/`）
- `web/src/domains/issues/components/IssueDetailView.tsx` / `IssueListView.tsx` 跟随

**改文件（删 issue 引用 + IssueListSection / IssuesPanel）**：
- `web/src/app/routes.tsx` — 删 `/flows/:sid/issues/...` 路由
- `web/src/app/routing.ts` + `routing.test.ts` — 删 IssueDetail / IssueList route kind
- `web/src/app/shell.tsx` — 删 issue 相关 selection / nav
- `web/src/app/layout/MainPanel.tsx` — 删 isIssueDetail / isIssueList pill
- `web/src/app/layout/Sidebar.tsx` — 删 issue tab 或入口
- `web/src/app/layout/ThreadHeader.tsx` — 删 issue ref
- `web/src/app/layout/threadDisplay.ts` — 删 issue 渲染
- `web/src/domains/sessions/components/UserThreadHome.tsx` — 删 IssueListSection（远端新加）+ NewIssueModal + selected.kind==="issue"
- `web/src/domains/sessions/components/SessionCreator.tsx` — 删 issue 初始化（如有）
- `web/src/domains/sessions/components/LoopActionPopover.tsx` — 删 issue 相关 popover variant（如有）
- `web/src/domains/files/{components/{ContextSnapshotViewer},context-snapshot.ts}` — 删 issue_window 渲染
- `web/src/domains/chat/components/{TuiBlock,ChatComposer}.tsx` — 删 issue 相关 @mention 解析（如有）
- `web/src/domains/flows/adapter.ts` — 删 issue 字段映射
- `web/src/domains/clients/StoneFallback.tsx` — 删 issue 引用
- `web/src/transport/endpoints.ts` — 删 issue endpoints
- `web/src/styles.css` — 删 `.issue-*` 样式
- `.ooc-world/stones/main/objects/supervisor/client/index.tsx`（Round 6 写的）— 看是否引用 issue knowledge file（using-issues.md）

### 2.3 Meta 文档（删 / 改）

- `meta/object.doc.ts`：
  - 删 `collaborable.children.issue` 整个子节点（约 50 行）
  - 删 `collaborable.content` 中第 6 项 "Issue: session 级共享议题"
  - 删 `collaborable.named.Issue / Comment`（如有）
  - 改 `executable.content` 第 2 行去掉 "create_issue / open_issue"
  - 改 `executable.children.commands.content` 删 create_issue / open_issue 描述
  - 改 `executable.children.commands.named` 删 create_issue / open_issue
  - 改 `executable.children.window_types.content` 删 issue 行
  - 改 `executable.children.window_types.named` 删 issue_window
  - 改 `executable.children.tools.named.wait` 描述去 issue_window
  - 改 `executable.children.commands.children.command_path.content` 删 issue 行
  - 改 `executable.children.commands.children.command_default_table.content` 删 create_issue / open_issue / issue.comment 行
  - 改 `executable.children.context_window.children.render_dispatch` 隐式 path 删 issue
  - 改 `thinkable.children.knowledge_activation` 删 issue 相关行（如有）
  - 改 `persistable.issue_files` — 删整段（如有此 child）
- `meta/engineering.testing.doc.ts` — 删 issue 相关场景（如有）
- `meta/app.client.doc.ts` — 删 issue 控制面引用
- `meta/app.server.doc.ts` — 删 issuesApi route
- `meta/case.*.doc.ts` — 删 issue 引用（feedback-tracker case 中可能有）

### 2.4 持久化数据（手动 / 不进 git）

- `.ooc-world/flows/<*>/issues/` — 现有 demo session 里可能有 — 手动删
- `.ooc-world/stones/main/objects/supervisor/knowledge/using-issues.md`（远端 supervisor-seed 写的）— 删该 seed 文件 + 改 bootstrap 不再写

### 2.5 实施分阶段（A 段）

| Phase | 范围 | 派单 |
|---|---|---|
| A1 | meta 层删除（object.doc.ts + 其它 meta） | Supervisor 直写 + tsc 验证 |
| A2 | backend 整体删除（persistable + executable + module/issues + bootstrap）| AgentOfCollaborable + AgentOfPersistable 联合 |
| A3 | web 删除（routes / domains/issues / 各处引用）| AgentOfVisible |
| A4 | tests 调整 + 全仓回归 | 同 A2 / A3 sub agent 自带 |

A2 与 A3 文件域不重叠，可并行。A1 必须先。

### 2.6 风险（A 段）

| 风险 | 缓解 |
|---|---|
| 删错 "PR-Issue"（stone-versioning 决策概念）| 文件级保留 `pr-issue.test.ts`、`stone-versioning.ts` 的 PR-Issue 类型；只删"issue 看板"语义引用 |
| 漏删导致 dead import / tsc 失败 | 每个 sub agent 跑 tsc + 报告剩余 issue 引用 |
| 远端 demo session 有历史 issue 数据 | 不进 git；手动 rm 不强制 |
| supervisor seed knowledge 含 using-issues.md | 同步删 + bootstrap 不再 ensureSeedKnowledge 写入 |
| permission-q0b e2e 用 issue 命令测 ask 行为 | 改用其它 ask 命令替代（write_file 已是 ask） |

---

## 3. B 段 — plan window 设计

### 3.1 现状分析

**当前 plan 形态**：
- `ThreadContext.plan: string`（一个字符串字段）
- `plan` command 注册在 root window，覆盖式更新 `thread.plan`
- 没有 plan_window type
- 没有 sub plan 概念
- 没有 plan 跨 thread 共享

**痛点**：
- 一个 thread 只能有一份 plan 文本，无结构
- 子 thread 看不到父的 plan，重新写
- 子任务进度无法回流父 plan

### 3.2 设计目标

1. **plan 升格为 ContextWindow**（first-class object 化）
2. **支持 sub plan**：plan_window 可嵌套 sub plan_window，形成 plan tree
3. **可 share 给 sub thread**：通过 do_window.move（ref 或 move 模式）传递 plan_window 给 sub thread
4. **进度回流**：sub thread 在被 share 的 plan_window 上更新进度，父 thread 可见（如果 move 模式）

### 3.3 plan_window 数据形态

```ts
type PlanWindowStep = {
  id: string;          // 步骤稳定 id（plan 树内唯一）
  text: string;        // 步骤描述
  status: "pending" | "in-progress" | "done" | "blocked";
  subPlanWindowId?: string;  // 如果该步骤展开了 sub plan，指向 child plan_window.id
};

type PlanWindow = BaseContextWindow & {
  type: "plan";
  title: string;                  // plan 主题
  description?: string;            // plan 说明
  steps: PlanWindowStep[];
  parentPlanWindowId?: string;    // 父 plan_window.id（root plan 无此字段）
  parentStepId?: string;          // 父 plan 中哪一步把当前 plan 作为 sub
  status: "active" | "done" | "archived";
};
```

### 3.4 plan_window 上的 commands

| command | 行为 |
|---|---|
| `update_plan` | 更新 plan 标题 / 描述 |
| `add_step` | 在 plan 末尾追加一个 step |
| `update_step` | 修改某 step 的 text / status |
| `expand_step` | 把某 step 展开为 sub plan_window（创建 child plan_window + 写回 subPlanWindowId） |
| `collapse_subplan` | 反向：把 sub plan_window archive 掉，subPlanWindowId 清除 |
| `mark_done` | plan_window 标记完成（status → "done"） |
| `close` | 关闭 plan_window（cascade close 所有 sub plan）|

### 3.5 root.plan command 演化

**原**：plan 是 `thread.plan` 字符串覆盖。
**新**：

| 调用形态 | 行为 |
|---|---|
| `exec(command="plan", args={ plan: "<text>" })` | 仍然兼容：若当前 thread 还没 plan_window，创建一个 root plan_window；title="Plan"，steps=[]，description=`<text>` |
| `exec(command="plan", args={ title, steps: [...] })` | 完整创建 root plan_window |

**plan 字段语义**：保留 `ThreadContext.plan: string` **作为 fallback summary**（自动从 plan_window 派生：root plan_window.description + 顶层 steps 简表）；旧代码读 `thread.plan` 仍能拿到一段摘要。**或者**直接废弃 `thread.plan` 字段，所有 plan 全走 window —— 倾向**废弃**更干净，但需要清算引用。

### 3.6 plan_window 与 do_window 协同（核心）

**share 路径**：
- 父 thread 已有一个 plan_window（如 `plan-window-abc`）
- 父 thread 调 `exec(command="do", args={ task: "...", share_windows: ["plan-window-abc"] })` 派生子 thread
  - 复用 Round 早期已落的 `do.share_windows` 语法糖（meta/object.doc.ts:collaborable.cross_thread_window_sharing.named）
- 子 thread initContextWindows 时拿到 plan-window-abc 的 ref 或 move 版本
  - **默认 ref**（子读，父写）— 适合"子 thread 看父 plan 但不改"
  - **可选 move**（子 thread 拿 owner，临时只读）— 适合"子负责执行 plan，期间父只读看"

**进度回流**：
- 模式 1 (ref)：子在 ref 上无法 exec 命令（read-only）；子完成后通过 talk_window 把进度报回父，父再 update_step
- 模式 2 (move)：子可以直接在 plan_window 上 update_step；归还时父自动看到新内容

**典型流程**：
1. 父 thread 创建 root plan_window「重构 thinkable」+ 5 个 steps
2. 父调 `do` 派生子 thread + share_windows=["plan-window-abc"] (mode="move")
3. 子拿到 plan_window 的 owner，执行 step 1，调 `update_step` 设 status="done"
4. 子调 `expand_step(step_id=2)` 创建 sub plan_window「具体子任务」（注册到 plan-window-abc 的 step 2 上）
5. 子任务完成 → do_window archive → plan_window 自动归还父 thread
6. 父 thread 看到 plan_window 已经 step 1 done + step 2 有 sub plan

### 3.7 持久化

- plan_window 走标准 ContextWindow 持久化（thread.json 内）
- sub plan_window 由各自所在 thread 持有；通过 parentPlanWindowId 维护逻辑父子链；**实际 owner thread 可能在共享中变化**
- sharing snapshot 已有协议（meta/object.doc.ts:executable.children.context_window.children.sharing）— 复用，不重发明

### 3.8 渲染（renderXml）

```xml
<plan_window id="..." status="active">
  <title>重构 thinkable</title>
  <description>...</description>
  <steps count="5">
    <step id="s1" status="done">第一步: ...</step>
    <step id="s2" status="in-progress" sub_plan_window_id="plan-window-child">
      第二步: ...
    </step>
    <step id="s3" status="pending">第三步: ...</step>
    ...
  </steps>
  <commands hint="add_step / update_step / expand_step / mark_done / close">...</commands>
</plan_window>
```

子 plan_window 不内联渲染（避免无限嵌套），LLM 通过 sub_plan_window_id 找到 child window 单独看。

### 3.9 compressView 协议（复用 P0-2）

- Level 1 (folded)：仅 title + status + step count + done/total 比例
- Level 2 (snapshot)：仅 title + status

### 3.10 不变量

| 不变量 | 说明 |
|---|---|
| sub plan 嵌套深度无硬限制 | 但 UI 渲染建议 ≤3 层（更深用 fold/expand 交互）|
| sub plan_window 必须有 parentPlanWindowId + parentStepId | 单向引用，断链时显示 "orphan plan" 警告 |
| share 走标准 do_window.move | 不发明新协议；plan_window 复用现有 sharing kind="ref"/"lent_out"/"live" |
| 进度回流走 sharing | move 模式自动归还时父收到最新；ref 模式靠 LLM 主动 talk 报告 |
| compress 复用 P0-2 | plan_window 实现 compressView hook，与 file/talk/do/search 同协议 |

### 3.11 web 端 UI（最小）

本轮不强制实施完整 UI，但提供最简 viewer：
- ContextSnapshotViewer 加 plan_window 渲染（title + steps 列表 + 各 step status）
- 点击 sub plan_window_id 跳到 child plan_window 详情
- 不做拖拽编辑 / 富文本（后续 round）

### 3.12 实施分阶段（B 段）

| Phase | 范围 | 派单 |
|---|---|---|
| B1 | meta 层加 plan_window 概念 + plan command 升级 | Supervisor 直写 |
| B2 | `src/executable/windows/plan/` 新 module（types + index + commands + renderXml + compressView）| AgentOfExecutable + AgentOfThinkable 联合 |
| B3 | root.plan command 改造（创建 plan_window 而非写 thread.plan）+ thread.plan 字段处理（fallback 派生 / 废弃）| 同 B2 |
| B4 | do.share_windows 验证 plan_window 可被 share（应已 work，因为 sharing 是通用机制）+ e2e 跑通父→子 share 路径 | 同 B2 |
| B5 | web 端 ContextSnapshotViewer 加 plan_window 渲染 | AgentOfVisible |
| B6 | e2e 完整：父开 plan → share 给子 → 子 update_step + expand_step → 归还父 → 父看到进度 | 同 B2 |

B1 必须先；B2~B4 串行（同一 sub agent）；B5 与 B6 后续。

### 3.13 风险（B 段）

| 风险 | 缓解 |
|---|---|
| thread.plan 字段废弃影响现有 code | 全仓 grep 一次；倾向保留 plan 字段作为 fallback summary（自动派生）|
| sub plan 嵌套深度爆炸 | 单 plan tree 深度无限制，但 renderXml 默认折叠 sub plan（不内联），LLM 主动 open |
| share 后并发改 | sharing kind="lent_out" 已是 read-only；kind="ref" 也只读；只有 owner 能写——天然防并发 |
| plan_window 与 todo_window 概念重叠 | plan 是结构化树（步骤+sub），todo 是简单清单；语义不同。todo 留存（已有），plan_window 是新增 |
| compressView 实现质量 | 与 P0-2 同协议；单测 fold→expand 还原 |

---

## 4. 整体实施时间线

```
A1 meta 减法 → A2/A3 并行 backend+web 删除 → A4 tests 修
                                                  ↓
B1 meta 加法 → B2/B3 串行 plan_window 落地 → B4 share 验证 → B5/B6 web + e2e
```

A 必须先于 B（避免 plan_window 设计被 issue 引用污染；A 清场让 B 干净）。

预估：A 段 2 sub agent (并行 backend+web)；B 段 3 sub agent (B2~B4 一个 / B5 一个 / B6 一个或合并)。

**5 个 sub agent**，与 Round 1 量级相当；本会话内可完成。

---

## 5. 不变量复盘（A + B 合并后）

- **collaborable**：仅 talk + do + relation 三套协作机制（issue 已移除）
- **executable.window_types**：root / command_exec / do / talk / todo / program / file / knowledge / search / **plan** / custom（issue 移除，plan 新增）
- **thinkable.thread**：plan 字段处理待 B1 拍板（保留 fallback / 废弃）
- **type-dispatch**：plan_window 走与 file/talk/do/search 同协议；renderXml + compressView 都注册
- **visibility-first**：plan 变更落 ProcessEvent（add_step / update_step / expand_step）；与 context_compressed / permission_* 同体例
- **persistable**：plan_window 在 thread.json 内（不需要单独 plan-service / plan 文件）；issue_files 整段删除
- **sharing**：plan_window 完全复用 do_window.move 协议；不发明新 sharing 类型

---

## 6. 待用户拍板

1. **本轮直接实施 A + B** 还是只交付 design 等下一轮拍板？
2. **plan 字段处理**：
   - 选 P1：保留 `thread.plan: string` 作为自动派生的 fallback summary（不破坏旧引用）
   - 选 P2：完全废弃 `thread.plan` 字段，强制走 plan_window
3. **plan_window UI 端是否本轮必交付**？
   - 倾向：B5 最小渲染本轮做（让 user 真看到 plan tree）；编辑交互留后续
4. **issue 移除后是否额外加一条 "已移除特性" 的 meta warning 说明**？
   - 防止后续误以为 issue 是 OOC 协作机制之一

---

## 历史

- **2026-05-26**：首版。Round 7 design 草稿。
