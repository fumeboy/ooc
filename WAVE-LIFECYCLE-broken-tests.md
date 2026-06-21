# WAVE-LIFECYCLE broken tests ledger (Phase 0 + Phase 1)

每行格式：`文件 — 原因`。仅登记，不修（修在 Phase 5）。

## Phase 0 + Phase 1 结果

无任何因 Phase 0/Phase 1 改动而新增的编译/运行失败。

- `bun tsc --noEmit` 过滤 `^packages/@ooc/core`：0 错误（改前改后皆 0）。
- 非 core `packages/@ooc/` 错误：86 个，全部 baseline（git stash 验证：改前=改后=86），
  均为 `packages/@ooc/web` / 部分 builtins visible 的前端依赖缺失
  （`react-router` / `lucide-react` / `@codemirror/*` / `react-dom` 的 TS2307 + 其级联 TS7006），
  与本 wave 改动无关、不在本 wave 范围。
- `ThreadStatus` 加 `"canceled"` 后未触发任何穷举 switch 的 non-exhaustive 报错
  （core 内唯一 `ThreadStatus` 消费点 `thinkable/context/index.ts:42` 只是 re-export）。
- 已跑测试套件全绿（无 FAIL）：
  - `packages/@ooc/core/runtime` + `packages/@ooc/core/executable`：205 pass / 0 fail
  - `packages/@ooc/core/persistable`：151 pass / 0 fail
  - `packages/@ooc/builtins/agent/children/thread`：16 pass / 0 fail
  - 新模块 `core/runtime/__tests__/object-lifecycle.test.ts`：16 pass / 0 fail

## Phase 2 + Phase 3 + Phase 4 结果

- `bun tsc --noEmit` 过滤 `^packages/@ooc/(core|builtins/agent/children/thread)/`：0 错误。
  全 `@ooc` 错误数仍 = 86（baseline，全前端依赖缺失，未引入任何新错）。

### 因本 wave 改动而预期失败的测试（仅登记，不修；Phase 5 统一修）

- `packages/@ooc/core/executable/__tests__/tools.test.ts:99-112`
  （`it("close 释放任意 window（含 creator…")`）— **有意行为反转**（spec §5.5）：creator
  结构窗现 `closable:false`，close 之返回 `ok:false` + 「不可关闭（结构窗…）」错误、窗不被移除；
  旧断言 `ok===true` + 窗已移除将失败。Phase 5 改为断言 `ok===false` + 错误文案 + 窗仍在。

### 排查过但不受影响（无需登记、无需改）

- thread builtin `__tests__`：零处引用 `closeMethod` / `archiveForkChild` / thread `close` method。
- `tests/e2e/backend/permission-q0{b,c}*.test.ts` 的 `paused`：是 permission ask 流程的
  `thread.status="paused"`，与 fork-close 无关。
- `core/executable/__tests__/wait.test.ts`：用 creator 窗做 `wait`（非 close），不受 `closable` 影响。
- scheduler `collectRunningThreads` 正向匹配 `status==="running"`，canceled 天然不被调度——无需改。
- `api.list-jobs.ts` / `api.activity.ts` 的 `done|failed` literal 是 **job** status 枚举
  （`queued|running|done|failed`），非 thread status——无需加 canceled。

### Phase 4 consumer 扫描：已改 + 待 Supervisor 定夺

**已改（语义明确：终态/不再回报）：**
- `app/server/runtime/worker.ts:298`（跨对象 end 同步）— `callee.status !== "done" && !== "failed"`
  补 `&& !== "canceled"`：canceled callee 同终态、向 caller 回报终态通知（endSummary/endReason
  有 `??` 兜底，canceled 无这俩字段时 reason=「canceled」、summary=「(无 summary)」）。

**待 Supervisor 定夺（语义不确定，未改）：**
- `thinkable/scheduler.ts:73`（`emitChildEndNotifications`）— `child.status !== "done" && !== "failed"`
  跳过。是否给 waiting 父注入「子已 canceled」system 通知？canceled 由父关 fork 窗触发，父此刻
  通常不在 waiting；且 canceled 子无 endSummary。spec §7 R-canceled 未列此处，plan Task 4.1 也未列。
  **不改，待定。** 若父确曾 wait 在被 cancel 的子上 → 可能 hang（v1 缺口，最终一致性范畴）。
- `thinkable/scheduler.ts:161`（`harvestSummarizerForks`）— summarizer fork harvest 的「还在跑」判定
  `child.status !== "done" && !== "failed"`。summarizer fork 是 framework 内部、不被用户 close，
  正常不会 canceled。若硬补 canceled 会把「被取消的 summarizer」也当「已结束」去 harvest（读不到
  endSummary）。**不改，待定**（边缘、非本 wave 引入的风险）。
