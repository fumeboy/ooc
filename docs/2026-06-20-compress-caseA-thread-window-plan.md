# compress Case A —— 自视折叠载体收敛到 thread 窗 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按 task 逐个落地。步骤用 `- [ ]` 跟踪。
> **设计来源**：`docs/2026-06-20-compress-caseA-thread-window-convergence.md`（spec）。冲突时信 spec；spec 与代码冲突时信代码并回流。

**Goal:** 把 self 视角 events 折叠态的载体从 self 门面窗收敛到「自己视角 thread 窗」（THREAD_CLASS_ID、inline 天然持久化），消掉"creator 窗"概念。

**Architecture:** 统一模型——一条 thread 恰好一个 thread 窗（过程），creator 对话是它内建的上游通道（root 为空）。拆 `isCreatorWindowId` 为 `isSelfThreadWindow`（自视检测，含 root）+ `hasCreatorChannel`（有上游，root 假）；events-compress 能力归属 thread class；folds 挂 thread 窗 win（inline 持久化）→ 删 self 门面窗后门。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；e2e 用 Elysia `app.handle` 直调 + writeThread/readThread reload。

**工作方式（用户拍板，覆盖 skill 默认 TDD）：** Task 1-2 行为不变、保持绿；Task 3-6 改行为、**只登记坏测试进下方 Ledger、不逐步修**；Task 7 统一修 + 新 e2e（TDD）跑全绿。**每个 Task 结束 `bun run check:tsc` 必过**（源码连贯可运行是中间态目标）。派 sub-agent 须明确"不修测试只登记账本"。

---

## Test Ledger（Task 3-6 追加；Task 7 清空）

> 格式：`- [ ] <test file>::<case> —— <断言为何坏 + 期望新行为>`。Task 3-6 跑 `bun test packages/@ooc/core/` 后把**新增** FAIL 追加到这里。

- [ ] **[Task4]** `packages/@ooc/storybook/stories/L2_thinkable.stories.ts` (L2-COMPRESS-EVENTS) —— 测 compress(scope=events) 经 **universal default** 解析；Task4 后 events 移到 thread class、universal scope=events 抛错 → 该 story `resolveWindowMethod` 走默认表折 events 的断言失效。**期望新行为**：断言 events-compress 经 thread class（resolveWindowMethod(THREAD_CLASS_ID,'compress')=threadCompress）解析；universal compress(events) 抛错指向 thread 窗。
- [ ] **[Task3 覆盖缺口，非失败]** 无现存单测断言 self-driven root context 形状（注入 thread 窗 / 无 say-IO 源 / folds 跨 reload）→ Task7 e2e gate 新增 self-driven root 用例补。

---

## 验收（Task 7 末）
- `bun run verify` 全绿（含 check:tsc / check:silent-swallow / check:deprecated-symbols / check:doc-drift / check:anchor-drift）。
- `bun run test:storybook` gate 绿。
- 真 LLM：`.env` 就位，`RUN_REAL_COMPRESS_TEST=1` 跑通自压缩 + **跨 job reload 折叠不丢**。
- 不破坏 peer 视角 / attention 分层 / fork / reflect_request / 持久化。

---

## Task 1：纯重命名（behavior-preserving，保持绿）

把 `isCreatorWindowId → isSelfThreadWindow`、`creatorWindowIdOf → threadWindowIdOf`，**id 字符串 `w_creator_` 不动**（持久化兼容）。纯机械改 + 测试引用同步，零行为变化。

**Files（定义）：**
- Modify: `packages/@ooc/core/_shared/types/context-window.ts:88-106`

**Files（导入方，全部按编译错逐一改）：**
- `packages/@ooc/core/executable/tools/wait.ts`、`packages/@ooc/core/app/server/modules/flows/service.ts`、`packages/@ooc/core/thinkable/context/protocol.ts`、`packages/@ooc/core/thinkable/context/index.ts`、`packages/@ooc/builtins/agent/executable/method.end.ts`、`packages/@ooc/builtins/agent/children/thread/executable/talk-delivery.ts`、`packages/@ooc/builtins/agent/children/thread/readable/projection-class.ts`、`packages/@ooc/builtins/agent/children/thread/readable/index.ts`、`packages/@ooc/builtins/agent/children/thread/readable/conversation-render.ts`、`packages/@ooc/builtins/agent/children/thread/types.ts`、`packages/@ooc/core/thinkable/context/init.ts`、`packages/@ooc/core/_shared/types/constants.ts`（注释）
- 前端镜像：`packages/@ooc/web/src/domains/files/context-snapshot.ts:229-232,374`（独立 copy，同步重命名 + 注释里 `w_creator_` 说明保留）
- 全部 `__tests__` / `.stories.ts` 引用

- [ ] **Step 1：改定义**（context-window.ts:88-106）

```ts
/** thread 窗 id 的稳定前缀（thread 窗身份编码在 id 里；字符串保留 w_creator_ 以兼容已持久化 thread-context.json）。 */
export const THREAD_WINDOW_ID_PREFIX = "w_creator_";

/** 派生稳定的 thread 窗 id（自己视角的过程窗；有 creator 时即与 creator 的恒在通道）。 */
export function threadWindowIdOf(threadId: string): string {
  return `${THREAD_WINDOW_ID_PREFIX}${threadId}`;
}

/**
 * 该窗是不是本 thread 那**唯一一个** thread 窗（自己视角的过程窗）。
 *
 * thread 窗身份编码在 id（`threadWindowIdOf`），纯由 id 判定。一条 thread 的 context 里至多一条
 * （id=`w_creator_<本thread.id>`）；peer/self/member/工具窗都不以此前缀开头。
 * 注意：本谓词只答"是不是过程窗"，不答"有没有上游 creator"——后者用 `hasCreatorChannel`。
 */
export function isSelfThreadWindow(id: string): boolean {
  return id.startsWith(THREAD_WINDOW_ID_PREFIX);
}
```

- [ ] **Step 2：全树替换导入与调用**（保留 `w_creator_` 字符串）

Run（先定位，逐文件改，不盲 sed——注释里也有该词）：
```bash
grep -rln "isCreatorWindowId\|creatorWindowIdOf\|CREATOR_WINDOW_ID_PREFIX" packages/@ooc --include="*.ts"
```
逐个把符号改名（`isCreatorWindowId→isSelfThreadWindow`、`creatorWindowIdOf→threadWindowIdOf`、`CREATOR_WINDOW_ID_PREFIX→THREAD_WINDOW_ID_PREFIX`）；注释里"creator 窗"措辞可顺手改"thread 窗"，但**不改 `w_creator_` 字面值**。

- [ ] **Step 3：typecheck**

Run: `bun run check:tsc`
Expected: PASS（0 error；改漏的导入会在此暴露）

- [ ] **Step 4：跑 core 测试 + storybook，必须全绿**

Run: `bun test packages/@ooc/core/ && bun run test:storybook`
Expected: PASS（纯重命名、零行为变化；若红说明漏改测试引用，修到绿）

- [ ] **Step 5：commit**

```bash
git add -A && git commit -m "refactor(thread-window): isCreatorWindowId→isSelfThreadWindow / creatorWindowIdOf→threadWindowIdOf（纯重命名，id 字符串不变）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：引入 `hasCreatorChannel` + 拆谓词（behavior-preserving，保持绿）

把 creator 特有 affordance 从"是不是 thread 窗"改 gate 在"有没有上游 creator"。现存派生线程 `hasCreatorChannel` 恒真 → 行为不变；为 Task 3 root 空通道窗铺路。

**Files:**
- Modify: `packages/@ooc/core/_shared/types/context-window.ts`（加 `hasCreatorChannel`）
- Modify: `packages/@ooc/core/executable/tools/wait.ts:46`（creator 分支）
- Modify: `packages/@ooc/builtins/agent/executable/method.end.ts:39`（findCreatorWindow 过滤）
- Modify: `packages/@ooc/core/thinkable/context/protocol.ts:130`（creator-reply 生成）
- Modify: `packages/@ooc/builtins/agent/children/thread/readable/index.ts:87-111`（`say` 菜单 gate）

- [ ] **Step 1：加谓词**（context-window.ts，紧跟 isSelfThreadWindow 后）

```ts
/**
 * 本 thread 窗有没有真正的**上游 creator 通道**（可 say / 可 wait / 可 auto-reply 的对端）。
 * = 是自己的 thread 窗（isSelfThreadWindow）且 data 带 creator 端点（target 或 isForkWindow）。
 * self-driven root 的 thread 窗：是过程窗但**无上游** → 此谓词为假 → 不触发任何 creator affordance。
 */
export function hasCreatorChannel(w: { id: string; data?: unknown }): boolean {
  if (!isSelfThreadWindow(w.id)) return false;
  const d = (w.data ?? {}) as { target?: string; isForkWindow?: boolean };
  return d.target != null || d.isForkWindow === true;
}
```

- [ ] **Step 2：wait creator 分支**（wait.ts:46，把 `else if (isSelfThreadWindow(w.id))` 改为带 target 判定）

```ts
    } else if (isSelfThreadWindow(w.id) && d.target != null) {
      out.push({
        id: w.id,
        hint: `creator talk_window (target=${d.target}) — 等创建者发新消息`,
      });
    } else if (hasOutgoingSayOnTalk(thread, w.id)) {
```
> wait.ts:181 的 R4 守卫（`!targetData.isForkWindow && !isSelfThreadWindow(target.id) && !hasOutgoingSayOnTalk`）同步：把中段改 `&& !(isSelfThreadWindow(target.id) && targetData.target != null)`，使 root 空通道窗落入"既非 creator 也未 say 过"分支被拒（与不可 wait 一致）。

- [ ] **Step 3：end findCreatorWindow**（method.end.ts:33-53，过滤改 hasCreatorChannel）

把 `if (!isSelfThreadWindow(inst.id)) continue;` 改为：
```ts
    if (!hasCreatorChannel(inst)) continue;
```
（import 加 `hasCreatorChannel`。root 无通道 → findCreatorWindow 返回 undefined → 维持 method.end.ts:113-124 既有"忽略 result、仅记 endSummary"降级。）

- [ ] **Step 4：protocol creator-reply 生成**（protocol.ts:130）

```ts
    if (!hasCreatorChannel(w)) continue;
```
（import 加 `hasCreatorChannel`；root 的过程窗不生成 creator-reply 协议知识。）

- [ ] **Step 5：thread readable `say` 菜单 gate**（thread/readable/index.ts:87-111）

`say` 仅在有 creator 通道时 surface。把静态 `window[]` 改为按 ctx 动态算 object_methods——在 readable 函数内据 `hasCreatorChannel({ id: ctx.object.id, data: self })` 决定 `thread` 投影是否含 `say`：

```ts
  // 在 readable() 内、算出 projectionClass 后：
  const hasUpstream = hasCreatorChannel({ id: ctx.object.id, data: self });
```
并把 window[] 的 `thread` 项 object_methods 由固定 `["say"]` 改为运行期：有上游→`["say"]`、无上游（root）→`[]`。
> 若 window[] 是静态声明、运行期不便插值：在 `thread` 投影项保留 `say` 声明，但在 `resolveWindowMethod`/菜单聚合处对 root 过程窗（`!hasCreatorChannel`）过滤掉 `say`。择一实现，二选一钉死在 Task 注释里。`talk`/`reflect_request` 投影不变（它们恒有对端）。

- [ ] **Step 6：typecheck + 全绿**

Run: `bun run check:tsc && bun test packages/@ooc/core/ && bun run test:storybook`
Expected: PASS（现存线程 hasCreatorChannel 恒真 → 行为不变）

- [ ] **Step 7：commit**

```bash
git add -A && git commit -m "refactor(thread-window): 拆 hasCreatorChannel —— creator affordance gate 在上游通道而非"是否 thread 窗"

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：init 始终注入 thread 窗（改行为 → 登记账本）

root 现在也得一个 thread 窗（空通道）。

**Files:**
- Modify: `packages/@ooc/core/thinkable/context/init.ts:99-159`

- [ ] **Step 1：改 initContextWindows**

把 `!hasRealCreator` 早退（init.ts:115-119）从"不注入任何窗"改为"注入 thread 窗、但 creator 通道 data 为空"。统一注入逻辑（伪代码，按现有变量落实）：

```ts
  if (isUserRootThread(thread)) {
    thread.contextWindows = thread.contextWindows ?? [];
    return;
  }
  const threadWindowId = threadWindowIdOf(thread.id);
  const list = thread.contextWindows ?? [];
  if (list.some((w) => w.id === threadWindowId)) {
    thread.contextWindows = list;
    return;
  }
  const realCreator = hasRealCreator(thread, opts);
  const creatorThreadId = opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID;
  const sameObject = isCreatorSelf(thread);
  // 有上游 → creator 通道 data；self-driven root → 空 data（纯过程窗）。
  const threadData: Record<string, unknown> = realCreator
    ? (sameObject
        ? { target: thread.persistence?.objectId ?? thread.creatorObjectId ?? "", targetThreadId: creatorThreadId, isForkWindow: true }
        : { target: thread.creatorObjectId!, targetThreadId: creatorThreadId })
    : {};
  const threadWindow: OocObjectInstance = {
    id: threadWindowId,
    class: THREAD_CLASS_ID,
    parentObjectId: ROOT_WINDOW_ID,
    title: opts.initialTaskTitle,
    status: "open",
    createdAt: Date.now(),
    data: threadData,
    win: { transient: true, transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
  };
  thread.contextWindows = [threadWindow, ...list];
```
> `injectSelfWindowIfObjectThread`（self 门面窗）保持在最前、不动。注意 reload 幂等：hydrate 已还原 inline thread 窗 → id 命中即跳过 → 持久 win（含 folds，Task 5 后）存活。

- [ ] **Step 2：typecheck（必过）**

Run: `bun run check:tsc`
Expected: PASS

- [ ] **Step 3：跑 core 测试 + storybook，登记坏测试（不修）**

Run: `bun test packages/@ooc/core/ 2>&1 | tail -40 ; bun run test:storybook 2>&1 | tail -20`
把新增 FAIL（预期：root/self-driven 线程 context 窗数/形状断言、wait 候选断言等）追加到 Ledger，**不修**。

- [ ] **Step 4：commit 源码**

```bash
git add -A && git commit -m "feat(thread-window): init 始终注入 thread 窗（self-driven root 得空通道过程窗）[测试待统一修]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：写侧能力归属 —— events-compress 归 thread class（改行为 → 登记账本）

universal default 只留 `scope=windows`；`scope=events` 移入 thread class。

**Files:**
- Modify: `packages/@ooc/core/readable/default-window-methods.ts`（universal：events → 抛错）
- Create: `packages/@ooc/builtins/agent/children/thread/readable/compress-events.ts`（thread 专属 compress/expand，含 events）
- Modify: `packages/@ooc/builtins/agent/children/thread/readable/index.ts:87-111`（window[] 挂 threadCompress/threadExpand）

- [ ] **Step 1：universal compress/expand 去 events**（default-window-methods.ts:127-134 / 159-171）

compress.exec 改：
```ts
  exec: (_ctx, _self, before_win, args) => {
    const a = (args ?? {}) as { scope?: "windows" | "events" };
    if (a.scope === "events") {
      throw new Error(
        "[compress scope=events] 本窗无过程/会话 transcript 可折——events 折叠属你的 thread 窗。" +
        "用 exec(window_id=<你的 thread 窗 id>, method=\"compress\", args={scope:\"events\", keepTail:N, summary:\"…\"})。",
      );
    }
    return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1) };
  },
```
expand.exec 同样把 `scope === "events"` 改为抛同类错（指向 thread 窗 expand）。删除本文件内 `compressEvents`、`EventsCompressArgs` 里 events 专属字段、`addSummarizedRange/removeSummarizedRange` 的 import（移到 Step 2）；schema 里 events 专属 arg（keepTail/fromIdx/toIdx/summary/at）从 universal 移除（universal 只描述 windows scope）。

- [ ] **Step 2：新建 thread 专属 compress/expand**（compress-events.ts）

把原 `compressEvents` 逻辑 + events 分支搬来，且 windows scope 复用档位逻辑（clampLevel 内联）。完整文件：

```ts
import type { ReadableContext, WindowMethod } from "@ooc/core/readable/contract.js";
import {
  addSummarizedRange,
  removeSummarizedRange,
  type WinWithSummarizedRanges,
} from "@ooc/core/_shared/utils/summarized-ranges.js";

interface ThreadCompressWin extends WinWithSummarizedRanges {
  compressLevel?: 0 | 1 | 2;
}
interface EventsArgs {
  scope?: "windows" | "events";
  keepTail?: number;
  fromIdx?: number;
  toIdx?: number;
  summary?: string;
  at?: number;
}
const clampLevel = (n: number): 0 | 1 | 2 => Math.max(0, Math.min(2, n)) as 0 | 1 | 2;

function foldEvents(ctx: ReadableContext, before_win: ThreadCompressWin, args: EventsArgs): ThreadCompressWin {
  let fromIdx: number;
  let toIdx: number;
  if (typeof args.fromIdx === "number" && typeof args.toIdx === "number") {
    fromIdx = args.fromIdx; toIdx = args.toIdx;
  } else if (typeof args.keepTail === "number") {
    const total = ctx.thread?.events?.length ?? 0;
    const keep = Math.max(0, Math.floor(args.keepTail));
    fromIdx = 0; toIdx = total - 1 - keep;
  } else {
    throw new Error("[compress scope=events] 需 keepTail=N 或 fromIdx/toIdx 点名区段");
  }
  if (toIdx < fromIdx) return before_win ?? {};
  const summary = typeof args.summary === "string" && args.summary.trim().length > 0 ? args.summary : "(no summary provided)";
  return { ...before_win, summarizedRanges: addSummarizedRange(before_win?.summarizedRanges, { fromIdx, toIdx, summary }) };
}

export const threadCompress: WindowMethod<unknown, ThreadCompressWin> = {
  name: "compress",
  description:
    "折叠展示。scope=events（本窗主用）：折叠本 thread 历史 transcript——keepTail=N 保留末 N 条其余折成一条摘要，" +
    "或 fromIdx/toIdx 点名区段；summary 你自己写（原文不丢、可 expand 还原）。scope=windows：本窗档位折一档。",
  schema: { args: {
    scope: { type: "string", required: false, enum: ["windows", "events"], default: "events", description: "events=折本 thread 历史；windows=折本窗档位" },
    keepTail: { type: "number", required: false, description: "scope=events：保留末 N 条 event，其余折成一条摘要" },
    fromIdx: { type: "number", required: false, description: "scope=events：被折区段起点 event index（含；与 keepTail 互斥）" },
    toIdx: { type: "number", required: false, description: "scope=events：被折区段终点 event index（含）" },
    summary: { type: "string", required: false, description: "scope=events：该区段摘要文本" },
  } },
  exec: (ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsArgs;
    if (a.scope === "windows") return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1) };
    return foldEvents(ctx, before_win, a); // 默认 events（thread 窗主用）
  },
};

export const threadExpand: WindowMethod<unknown, ThreadCompressWin> = {
  name: "expand",
  description: "展开折叠。scope=events（默认）：at=index 展开覆盖该 event 的那段，不给则清空全部折叠。scope=windows：本窗档位展一档。",
  schema: { args: {
    scope: { type: "string", required: false, enum: ["windows", "events"], default: "events", description: "events=展本 thread 历史；windows=展本窗档位" },
    at: { type: "number", required: false, description: "scope=events：展开覆盖该 event index 的那段；不给则清空全部折叠" },
  } },
  exec: (_ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsArgs;
    if (a.scope === "windows") return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) - 1) };
    return { ...before_win, summarizedRanges: removeSummarizedRange(before_win?.summarizedRanges, a.at) };
  },
};
```
> 决策：thread 窗的 compress/expand **scope 默认 events**（它的主用途；windows 档位对句柄无意义但保留可调）。这与 universal（默认 windows）相反，但各自语境正确。

- [ ] **Step 3：thread readable 挂方法**（thread/readable/index.ts:87-111）

三投影 `window_methods` 由 `[setTranscriptWindowMethod]` 改为 `[setTranscriptWindowMethod, threadCompress, threadExpand]`（import 自 compress-events.ts）。

- [ ] **Step 4：typecheck（必过）+ 登记坏测试**

Run: `bun run check:tsc` → PASS
Run: `bun test packages/@ooc/core/ ; bun run test:storybook` → 把新增 FAIL（预期：L2-COMPRESS-EVENTS 断 universal 解析 events、real-compress 无 window_id 折 events 等）追加 Ledger，不修。

- [ ] **Step 5：commit 源码**

```bash
git add -A && git commit -m "feat(compress): events-compress 能力归属 thread class，universal 只留 windows scope [测试待统一修]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：读侧折叠源改 thread 窗（改行为 → 登记账本）

`buildInputItems` 折叠源从 self 门面窗（isSelfWindow）改 thread 窗（isSelfThreadWindow）。

**Files:**
- Modify: `packages/@ooc/core/thinkable/context/index.ts:454-456`

- [ ] **Step 1：改折叠源**

```ts
  const selfThreadWin = thread.contextWindows?.find(
    (w) => isSelfThreadWindow(w.id),
  )?.win as { summarizedRanges?: SummarizedRange[] } | undefined;
  const transcript = projectSummarizedRanges<ProcessEvent, LlmInputItem>(
    thread.events,
    snapRangesToToolPairs(thread.events, selfThreadWin?.summarizedRanges),
    // …renderItem / renderSummary 不变…
```
（import `isSelfThreadWindow`。删除原 `selfWin = find(isSelfWindow)` 块；下方 budget/transcript 引用改 `selfThreadWin`。）

- [ ] **Step 2：复核坐标系不抢字段**（spec §四 ⚠）

确认 thread 窗自视走 handle 分支时 `conversation-render.ts` **不读** `summarizedRanges`：
Run: `grep -n "summarizedRanges\|isCreator\|handle" packages/@ooc/builtins/agent/children/thread/readable/conversation-render.ts`
若 handle 分支触碰 summarizedRanges → 必须让其在 self-view（isCreator/self）handle 分支跳过，避免与 events 折叠抢同一字段。把结论钉进 commit message。

- [ ] **Step 3：typecheck（必过）+ 登记坏测试**

Run: `bun run check:tsc` → PASS
Run: `bun test packages/@ooc/core/` → context.test.ts events-fold 系列（710+）预期从 self 门面窗读改 thread 窗读而 FAIL → 追加 Ledger，不修。

- [ ] **Step 4：commit 源码**

```bash
git add -A && git commit -m "feat(compress): 自视折叠读出源改 thread 窗（载体收敛）[测试待统一修]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：删持久化后门 + 验冷启动洞消失（改行为 → 登记账本）

folds 现挂 inline 持久化的 thread 窗 → self 门面窗后门无用、删之。

**Files:**
- Modify: `packages/@ooc/builtins/agent/children/thread/persistable/thread-persist.ts:73-82`

- [ ] **Step 1：删后门**

删除 `buildEntries` 里"非持久化窗带 summarizedRanges 就 inline 落盘"那段（73-82），让 `isNonPersistedWindow` 窗（self 门面窗 / member 窗）一律按原规则跳过。self 门面窗不再有 summarizedRanges（Task 5 后无人写它）。

- [ ] **Step 2：自检冷启动洞**

确认 thread 窗 folds 走 inline 路径（registry.isInlinePersisted(THREAD_CLASS_ID)=true）→ hydrate 时 `registry.has(THREAD_CLASS_ID)` 恒真（builtin）→ 不丢窗。stone 对象的 thread 窗 class 也是 THREAD_CLASS_ID（builtin），故 stone 冷启动 registry-miss 不再波及 folds。把结论钉进 commit message。

- [ ] **Step 3：typecheck（必过）+ 登记坏测试**

Run: `bun run check:tsc` → PASS
Run: `bun test packages/@ooc/core/` → 任何断言后门 inline 行为的测试 FAIL → 追加 Ledger。

- [ ] **Step 4：commit 源码**

```bash
git add -A && git commit -m "refactor(persistable): 删 self 门面窗 events-fold 持久化后门（folds 已挂 inline thread 窗）[测试待统一修]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：统一修测试 + 跨 job e2e gate（TDD 新 e2e，全绿）

清 Ledger + 改 context.test/storybook/real-compress + 活化 describe.skip e2e 为跨 job reload gate。

**Files:**
- Modify: `packages/@ooc/core/thinkable/__tests__/context.test.ts:710+`（折叠源改 thread 窗；补 root 过程窗用例）
- Modify: `packages/@ooc/storybook/stories/L2_thinkable.stories.ts:109-192`（events-compress 解析到 thread class）
- Modify: `packages/@ooc/core/thinkable/__tests__/real-compress.test.ts:61-131`（经 thread 窗 window_id 折 events + 菜单可发现性）
- Rewrite: `packages/@ooc/tests/e2e/backend/context-compression-p0f-events.test.ts`（describe.skip → 活 gate）
- 全部 Ledger 项

- [ ] **Step 1：逐条修 Ledger**

按 Ledger 逐项把断言改到新行为（折叠态在 thread 窗、universal 不接 events、root 有 thread 窗等）。每修一批 `bun test <file>` 验证。

- [ ] **Step 2：写跨 job reload e2e（TDD，先 fail）**

参考 `tests/e2e/backend/backend-reflectable-sediment.e2e.test.ts:67+`（scheduler_yielded→reload + `_fixture.ts:529` waitForSuperFlow）与 `core/persistable/__tests__/thread-context-bypass-reload.test.ts`（writeThread+readThread）。新测断言：
1. 在某 thread 的 thread 窗上 compress(scope=events) 写 `summarizedRanges`；
2. writeThread → readThread（模拟 scheduler_yielded→reload）；
3. reload 后 thread 窗 win.summarizedRanges 存活；buildInputItems 投影仍折叠。
4. **self-driven root 用例**：root 过程窗 folds 跨 reload 不丢。

session 用 `_test_caseA_<timestamp>` 前缀、末尾清理（避免污染 .ooc-world/flows）。

Run: 先跑（未活化前/桩未对接）→ Expected: FAIL（折叠丢 / 窗缺）。

- [ ] **Step 3：跑通 e2e**

接好载体后该 e2e 转 PASS。Run: `bun test packages/@ooc/tests/e2e/backend/context-compression-p0f-events.test.ts`
Expected: PASS（含 root 用例）。

- [ ] **Step 4：全量验收**

Run: `bun run verify && bun run test:storybook`
Expected: 全 PASS（check:doc-drift / check:deprecated-symbols / check:anchor-drift 一并）。
> deprecated-symbols：若 check 仍扫 `isCreatorWindowId`/`creatorWindowIdOf` 旧符号，确认 0 残留；如需把旧名加进退役模式表（防回潮），在此补 `check:deprecated-symbols` 的 FORBIDDEN_PATTERNS。

- [ ] **Step 5：真 LLM 验收**

Run: `RUN_REAL_COMPRESS_TEST=1 bun test packages/@ooc/core/thinkable/__tests__/real-compress.test.ts`
Expected: PASS（真 LLM 经 thread 窗折 events；observe 写侧 summarizedRanges + 读侧 transcript 变短）。
跑通**跨 job reload 折叠不丢**（若 real 测含 reload 段）。

- [ ] **Step 6：commit**

```bash
git add -A && git commit -m "test(compress): Case A 全量修测试 + 跨 job reload e2e gate（折叠跨 reload 不丢，含 self-driven root）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：文档回流（对象树 + docs/）

**Files:**
- Modify: `.ooc-world-meta/stones/main/objects/supervisor/children/thinkable/knowledge/compress.md`（Case A 标已解 + 3.4 复核 + 3.7 迁移映射收尾）
- Modify: `.ooc-world-meta/.../children/thinkable/knowledge/context.md`（3.7 两行迁移映射收尾 + **修 3.1 instructions 漂移** + 核 9/10 措辞对齐统一 thread 窗）
- Modify: `docs/2026-06-20-compress-overview.md`（§4.2 → 已落、§三状态表加行）

- [ ] **Step 1：改 compress.md**

Case A 段从"开放 gap"改"已解"：载体收敛到 thread 窗（events-compress 归 thread class、folds 挂 thread 窗 win inline 持久化、删后门、root 得空通道过程窗）。3.7 迁移映射"self 门面窗承载折叠"行标完成。复核 3.4（坐标系/tool-pair）仍准。

- [ ] **Step 2：改 context.md**

3.7 两行迁移映射（events compress 折叠态载体 / transcript 归属）标完成；**修 3.1 表**（删"instructions = self.md 正文"、改为 self.md 作 self 门面窗 self 视角内容渲入 `<context>`，instructions 不承载身份）；核 9/10 措辞确认"一条 thread 一个 thread 窗、creator 对话是其通道、root 为空通道"。

- [ ] **Step 3：改 overview**

§三状态表加"Case A 载体收敛"行 + commit；§4.2 从"剩余工作"改"已落"。

- [ ] **Step 4：docs/ 与代码同 commit；对象树单独 push ooc-0**

```bash
# docs/（父仓）
git add docs/2026-06-20-compress-overview.md && git commit -m "docs(compress): Case A 载体收敛已落，overview 状态更新

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
# 对象树（独立仓 → ooc-0）
cd .ooc-world-meta/stones/main && git add -A && git commit -m "docs(thinkable): compress Case A 已解 + context.md 3.1 instructions 漂移修正" && git push origin main
```

---

## Self-Review 记录
- **Spec 覆盖**：六增量 → Task 1-8 全覆盖（rename / 拆谓词 / init / 写侧 / 读侧 / 删后门 / 测试+e2e / 文档）。✓
- **占位符**：substantive 改动均给完整代码；rename 给符号映射 + 文件清单 + 命令（机械改，逐文件 + tsc 兜底）。✓
- **类型一致**：`isSelfThreadWindow`/`threadWindowIdOf`/`hasCreatorChannel`/`threadCompress`/`threadExpand` 命名贯穿一致。✓
- **风险钉点**：坐标系抢字段（Task 5 Step 2）、root 涟漪（Task 2-3）、deprecated-symbols 回潮（Task 7 Step 4）。
