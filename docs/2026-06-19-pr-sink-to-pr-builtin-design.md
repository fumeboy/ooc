# PR 机制下沉 `_builtin/agent/pr` —— 拆分边界 / dispatch / recovery 设计

> **状态：已落地 P1-P4（2026-06-19）。** 分支 `feat/context-window-axiom`。
> P1 抽纯 git 原语 `15180ea6` · P2a resolve 编排→builtin `a27e5266` · P2b create 编排→builtin
> `9decaf11` · P3 pr-issue.ts 整体迁 builtin `8b294194` · P4 退潮（本提交）。
> 净结果：PR-Issue 账本 + 审批/开PR/resolve 编排全部归 `_builtin/agent/pr`；core 只留纯 git 机制
> （`mergeFeatBranch`/`archiveFeatBranch`/`commitFeatAndDiff`/`gitQueueKey`/`rollback`）。core 维度
> 包零 import builtin（仅 app 层 service/recovery + 测试）。recovery 沿用 app-bootstrap import builtin
> 存储原语（无需重设计）。下方为原设计推演，保留作记录。
> 起因：persistable 退潮时质疑 `pr-issue.ts` 是否该留 core。`think hard` 后结论：**审批逻辑已在
> builtin，剩余 core 残留可进一步沉，唯一硬解耦是 `stone-versioning` 对 pr-issue 的读依赖**。

## 0. 一句话结论

PR 的**审批工作流逻辑早已在 `_builtin/agent/pr`**（`executable/index.ts` 的 approve/reject/
request_changes + `approval-flow.ts` 的 `applyPrApproval`），且 **core app/server 已 import 并
dispatch 到它**（`app/server/modules/runtime/service.ts:32` import `applyPrApproval`）。所以"下沉"
不是从零搬，而是**把残留在 `core/persistable` 的 PR-Issue 账本 CRUD 也归到 pr builtin**，并**解耦
`stone-versioning` 对 pr-issue 的读依赖**（让 versioning 退回纯 git 合入原语）。

## 1. 现状（锚定真实代码）

| 物 | 位置 | 性质 |
|---|---|---|
| approve/reject/request_changes object method | `builtins/agent/children/pr/executable/index.ts` | **逻辑·已在 builtin** |
| `applyPrApproval`（聚合 verdict + prAutoMerge 闸 + git 合入 + 回修 单一编排点） | `builtins/agent/children/pr/approval-flow.ts:103` | **逻辑·已在 builtin** |
| PR-Issue 账本 CRUD：`createPrIssue` / `readPrIssue` / `readPrIssueIndex` / `approvePrIssue`(写 approvals) / `aggregatePrApproval` / `closePrIssue` / `createRecoveryIssue` + 文件布局 `flows/super/issues/` + 类型 | `core/persistable/pr-issue.ts` | **存储原语·留 core（待评估下沉）** |
| `resolvePrIssue`（读 issue → worktree 合 main → close） + `rollback` + git 编排 | `core/persistable/stone-versioning.ts:291` | **git 机制 + 读 pr-issue（耦合点）** |
| HTTP 治理路由 approve/list/get/resolve | `core/app/server/modules/runtime/api.*-pr-issue.ts` + `service.ts` | **控制面·已 dispatch builtin `applyPrApproval`(service.ts:520)** |
| 启动期 recovery 扫描 | `core/app/server/bootstrap/recovery-check.ts:73,90`（`readPrIssueIndex`/`createRecoveryIssue`） | **app-bootstrap·无 runtime** |

依赖现状：
- `builtins/pr/approval-flow` → import `approvePrIssue`/`aggregatePrApproval`（core/pr-issue）+ `resolvePrIssue`（core/stone-versioning）。**builtin → core，合法。**
- `core/app/server/service` → import `applyPrApproval`（builtin）。**app → builtin，已存在、被接受。**
- `core/persistable/stone-versioning` → import `closePrIssue`/`readPrIssue`（core/pr-issue）。**persistable 内部，但若 pr-issue 下沉 builtin 则变 persistable → builtin（违分层）。**

## 2. 分层规则（本设计依据）

- **app/server + bootstrap 可 import `@ooc/builtins/*`**（编排层；现状 `service.ts` 已如此）。
- **core 维度包（thinkable / executable / observable / persistable / runtime）不得 import builtins**
  （除 runtime 动态 import）。
- ⇒ **唯一真正阻碍 pr-issue 全量下沉的是：`core/persistable/stone-versioning` 读 pr-issue。**
  解了它，pr-issue 即可整体归 pr builtin；其余 core 消费方（service / recovery）都在 app 层，import
  builtin 合法。

## 3. 拆分边界（sink / stay）

### 沉到 `_builtin/agent/pr`
- `pr-issue.ts` 整体 → `builtins/agent/children/pr/persistable/pr-issue.ts`：
  账本 CRUD（create/read/approve-write/aggregate/close）+ `createRecoveryIssue` + 文件布局 + 类型。
- approval 工作流（已在）+ 账本 = pr 这个 Object 的**自有数据 + 行为**，内聚一处。

### 留 core 框架
- **`stone-versioning` 退回纯 git 合入原语**：`mergeWorktreeToMain(branch, paths, author…)` / `rollback` /
  `archiveBranch` —— **不再读 pr-issue**，分支/路径由调用方（builtin approval-flow）传入。
- `enqueueSessionWrite` / `stone-git` 原语 / `stone-worktree` —— git/串行化框架，留 core。

### 关键解耦：`resolvePrIssue` 一拆为二
当前 `resolvePrIssue(issueId, decision)` = 读 issue(branch/paths) + 合 main + close。拆：
1. **纯 git 原语（留 stone-versioning）**：`mergeFeatBranch({branch, paths, author, commitMsg}) → {commitSha}` /
   `archiveFeatBranch(branch)`。无 pr-issue 依赖。
2. **读+close 编排（移 builtin approval-flow）**：读 issue → 调 1 的 git 原语 → `closePrIssue`。
   approval-flow 本就在 builtin、本就调 resolvePrIssue，移动后它直接编排 git 原语 + 账本 close。

## 4. dispatch 接线（去 core 直 import builtin 之外的耦合）

- **HTTP approve 路由**：现状已 `service.approvePrIssue → applyPrApproval(builtin)`，**无需改**。
  pr-issue 下沉后，service 读视图（listPrIssues/getPrIssue 的 readPrIssue/Index）改 import 自
  `@ooc/builtins/agent/pr/persistable/pr-issue`（app → builtin，合法）。
- **reviewer 在 thinkloop 批**：pr object method（approve/…）→ applyPrApproval，**全在 builtin，已自洽**。
- **versioning → pr 不再有反向调用**：解耦后 versioning 只提供 git 原语，由 builtin 调它（builtin → core），
  无 persistable → builtin。

## 5. recovery 方案

`recovery-check.ts` 在 **app/server/bootstrap**（非 core 维度包）→ **可 import builtin**。故 pr-issue
下沉后：`readPrIssueIndex` / `createRecoveryIssue` 改 import 自 `@ooc/builtins/agent/pr/persistable/
pr-issue` 即可，**无需重设计启动语义**。先前担心的"启动无 runtime 无法 dispatch"是误判——recovery 用的是
**存储读原语**（纯文件读），不需要 runtime/object 上下文，import 即用。

> 备选（更 OOC-native，非必须）：recovery 扫描改由 supervisor 对象首次激活时的一个 reflectable
> method 跑。改启动时序、收益有限，本设计**不采用**，记为未来可选。

## 6. 迁移分阶段（每阶段 tsc + 测试绿）

> **persistable→pr-issue 真实耦合（已核实，2 处 import + 1 barrel）**：
> `stone-versioning.ts:39`（readPrIssue/closePrIssue，resolve 编排）、`stone-feat-branch.ts:37`
> （createPrIssue，author 建 PR）、`persistable/index.ts:115`（barrel re-export）。
> super-actor / stone-bootstrap / world-config 仅**注释引用**，无真实 import。

- **P1 解耦 versioning（已完成 `15180ea6`）**：`resolvePrIssue` 拆出纯 git 原语
  `mergeFeatBranch`/`archiveFeatBranch`（留 stone-versioning，无 pr-issue 依赖）。resolve 编排仍读
  pr-issue（P3 处理）。git 合入行为逐字节不变。**注：P1 只断了 git 机制↔pr-issue，stone-versioning 仍
  import readPrIssue/closePrIssue。**
- **P2 收编两侧 PR-lifecycle 编排进 builtin**（前置，断 persistable→pr-issue 的 2 处 import）：
  - **resolve 侧**：`resolvePrIssue` 的「读 issue + 调 git 原语 + close」编排移进 builtin approval-flow
    （它本就调 resolvePrIssue）；stone-versioning 只留纯 git 原语，不再 import pr-issue。
  - **create 侧**：`stone-feat-branch.commitAndOpenPr` 的 `createPrIssue` 调用经 dispatch / 回调注入，
    或该 createPrIssue 调用点上移到 builtin；stone-feat-branch 不再 import pr-issue。
- **P3 下沉 pr-issue**：`core/persistable/pr-issue.ts` → `builtins/agent/children/pr/persistable/`；
  builtin 就近 import；app 层（service/recovery）改 import builtin（app→builtin 合法）；persistable/index
  去 re-export。P2 已断 persistable→pr-issue，此步无分层违规。
- **P4 退潮**：清 persistable/index + super-actor/stone-bootstrap/world-config 的 pr-issue 注释引用、
  stone-versioning doc、对象树 persistable/pr 维度 knowledge 回流。

## 7. 风险 / 开放问题

1. **`resolvePrIssue` 的 worktree GC + 映射**（stone-versioning:144 注释提到"resolvePrIssue 的 worktree GC
   依赖本映射"）——拆分时 GC 归 git 原语还是编排？需读全 resolvePrIssue 体确认。
2. **e2e**：`stones-versioning.e2e` / `pr-issue-governance.test` 走 service 路径，下沉后路径不变（service 仍在），
   但 import 源变；需同步。
3. **对象树权威**：pr 是 `agent` 的 child 维度对象，下沉后其 `persistable` knowledge 需在
   `.ooc-world-meta/.../children/agent/children/pr/` 落账（若该节点存在）。
4. **分层规则确权**：本设计断言"app 可 import builtin、core 维度包不可"——需在 supervisor
   `knowledge/engineering-harness` 或 _shared 头注释里确认/钉死这条，避免后续漂移。

## 8. 验收

- tsc clean · `bun test packages/@ooc/core` 0 fail · storybook Tier A 0 fail。
- `core/persistable` 不再有 `pr-issue.ts`；`grep persistable→@ooc/builtins` 仅限合法点（无 core 维度包）。
- `stone-versioning` 不 import pr-issue（纯 git 原语）。
- pr governance HTTP 行为（approve/list/get/resolve）逐字节不变。
