# OOC-4 Increment 2：`readme.md` → `readable.md` 归一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现。Steps 用 checkbox（`- [ ]`）跟踪。

**Goal:** 把 Object 持久化「对外说明」文件约定从 `readme.md` 改名为 `readable.md`（readable 维度的静态形态），含 helper 符号 / HTTP route / createStone 字段 / web fetch URL / agent-facing seed-knowledge 文本 / 测试，全程 `bun test src/` 绿，最后 harness 回归。

**Architecture:** spec `2026-05-30-ooc-4-incremental-object-unification-design.md` 的第二个增量（L0 的延后姊妹项，executable✓ 已完成）。行为保持型 rename，原子提交（symbol 定义 + 全部 caller + HTTP 两端 + web + seed 文本 + 测试断言一起改），commit 后 `bun test src/` 仍 1018 pass。

**本 increment 显式不做（留后续 increment，附理由）：**
- **`peerReadme*` 字段**（`peerReadmePath`/`peerReadmeBody`/`peerReadmeExists`，在 `relation/types.ts`、`relation/index.ts`、`synthesizer.ts`、`web/context-snapshot.ts` + 测试）→ 这是 relation window「peer 自述」特性命名；relation window 按 spec 第 10 条要删除/重做（collaborable/relation-removal 层）。现改名 = 给将死代码增 HOT-path 风险。**保留**，延后到 relation-removal 层。
- **web `usePeerReadme`/`readmeCache`/`readmeInflight`/`readmeSubscribers`/`loadReadme`/`__resetReadmeCacheForTest`**（`web/src/domains/objects/query.ts`）→ 同属 peer-readme 展示概念，延后 visible/web 层（L8）。**只改其内部 fetch 的 URL `/readme`→`/readable`**（route 必须两端一致），符号名保留。
- `readable.ts` 动态函数 + renderXml 泛化（spec L1 后半，需原型链 L2 前置）。

**Tech Stack:** TypeScript / bun；gate = `bun test src/`；Elysia HTTP；vite + React（web 独立 tsconfig）。

---

## 前置

- [ ] **Step 0.1: 基线** —— `git branch --show-current`（=ooc-4）；`bun test src/ 2>&1 | tail -6`（=1018 pass / 0 fail）。
- [ ] **Step 0.2: caller 集确认** —— Run:
```bash
grep -rln --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|"readme.md"\|/readme\b' src web | grep -v node_modules
```
对照下方 Task Files；出现清单外文件先补进再动手。

---

## Part 1：readable.md 制品改名（行为保持）

### Task 1: persistable 层 readme→readable（symbol + 文件 + 字面量）

**Files:**
- Modify→rename: `src/persistable/stone-readme.ts` → `stone-readable.ts`：`readmeFile`→`readableFile`、`readReadme`→`readReadable`、`writeReadme`→`writeReadable`、`"readme.md"`→`"readable.md"`、JSDoc
- Modify: `src/persistable/stone-object.ts`（L6 import、L75-82 JSDoc、L99 调用 `readmeFile`→`readableFile`）
- Modify: `src/persistable/index.ts`（L87 模块路径 `./stone-readme`→`./stone-readable` + 符号）

- [ ] **Step 1.1:** `cat src/persistable/stone-readme.ts` 确认三符号 + `"readme.md"`。
- [ ] **Step 1.2:** 改内容（符号 + 字面量 + JSDoc），`git mv src/persistable/stone-readme.ts src/persistable/stone-readable.ts`。
- [ ] **Step 1.3:** 改 stone-object.ts（import + 调用 + JSDoc）、index.ts（路径 + 符号）。
- [ ] **Step 1.4:** `bun test src/ 2>&1 | tail -6` —— 此刻会有红（下游 caller 未改），可继续到 Task 2 一起绿；或本任务暂只跑 `bun tsc --noEmit src/persistable/stone-readable.ts`。本 increment 把 Task 1-4 视为一个原子改名，**Task 4 末尾统一验绿**。

### Task 2: HTTP API + service + createStone 字段

**Files:**
- Modify→rename: `src/app/server/modules/stones/api.get-readme.ts`→`api.get-readable.ts`、`api.put-readme.ts`→`api.put-readable.ts`（route `/stones/:objectId/readme`→`/readable`；`getReadmeApi`→`getReadableApi`、`putReadmeApi`→`putReadableApi`；Elysia name；JSDoc）
- Modify: `src/app/server/modules/stones/index.ts`（import 路径 + 符号 + `.use()`）
- Modify: `src/app/server/modules/stones/service.ts`（L5,9 import `readReadme`/`writeReadme`→新名；`getReadme`→`getReadable`、`putReadme`→`putReadable`；L220 `"readme.md"`→`"readable.md"`；L164,187 createStone 消费 `input.readme`→`input.readable`）
- Modify: `src/app/server/modules/stones/model.ts`（L8 createStone body 字段 `readme`→`readable`）

- [ ] **Step 2.1:** 改 api 两文件 + `git mv` + index.ts。
- [ ] **Step 2.2:** 改 service.ts（import/方法名/字面量/createStone 消费）+ model.ts 字段。

### Task 3: createStone 调用链（web + stone-versioning）

**Files:**
- Modify: `web/src/app/shell.tsx`（L40,358,360,465,467 CreateStoneModal `readme`→`readable` 字段 + `stoneDraft.readme`→`readable`）
- Modify: `src/persistable/stone-versioning.ts`（L35 import `writeReadme`→`writeReadable`；L669,721 `input.readmeMd`→`input.readableMd`；L747 调用）
- Modify: `web/src/domains/clients/StoneFallback.tsx`（L115,317 `useStoneText` kind `"readme"`→`"readable"`；L325 URL `/readme`→`/readable`；L144-148 提示串 `readme.md`→`readable.md`）
- Modify: `web/src/domains/objects/query.ts`（L299-300 fetch URL `/readme`→`/readable`；**保留** `loadReadme`/`readmeCache`/`usePeerReadme` 符号名——见 Architecture 延后）

- [ ] **Step 3.1:** 改 shell.tsx createStone 字段链 + stone-versioning input.readmeMd→readableMd + 调用。
- [ ] **Step 3.2:** 改 StoneFallback（kind + URL + 提示串）+ query.ts 仅 URL。

### Task 4: bootstrap 调用 + agent-facing seed/knowledge 文本 + narrative + 测试

**Files:**
- Modify: `src/app/server/bootstrap/ensure-supervisor.ts`（L29,90 `writeReadme`→`writeReadable` + JSDoc readme.md→readable.md）、`ensure-user.ts`（L29,73 同）
- Modify: `src/app/server/bootstrap/supervisor-seed.ts`（L87,132,197,263,326,361,467,476,493,545 `readme.md`/`readmeMd` 字面量+注释→readable）、`user-seed.ts`（L7,8,15,16,25）
- Modify: `src/thinkable/knowledge/basic-knowledge.ts`（L169 `stones/<self>/readme.md`→`readable.md`）
- Modify: `src/thinkable/reflectable/reflectable-knowledge.ts`（L10,39,132 `readme.md`→`readable.md`）
- Modify: narrative 注释 `src/executable/windows/talk/index.ts:125`、`src/executable/windows/knowledge/types.ts:18`、`src/executable/windows/root/command.metaprog.ts:109`、`web/src/shared/ui/InlineUiContent.tsx:5`、`web/src/app/layout/MainPanel.tsx:357`
- Modify: 测试 `src/persistable/__tests__/stone.test.ts`（L7,20,30,32,54-62 symbol + `"readme.md"`）、`src/persistable/__tests__/stone-versioning.test.ts`（L392 readmeMd→readableMd）、`src/app/server/__tests__/server.routes.test.ts`（L255,274 createStone readme 字段 + 内容断言）、`src/app/server/__tests__/issue-6-api-consistency.test.ts`（L39-41,208 route `/readme`→`/readable`）

> **不改**：`peerReadme*`（relation/synthesizer/context-snapshot + relation-window.test/relation-derive.test）；`usePeerReadme`/`readmeCache` 符号；`src/app/server/index.ts` HTTP server；术语「对外说明/自述」。

- [ ] **Step 4.1:** 改 bootstrap 调用 + seed/knowledge 文本 + narrative 注释。
- [ ] **Step 4.2:** 改测试断言（symbol / route / 字面量 / createStone 字段 / input.readableMd）。
- [ ] **Step 4.3: 统一验绿 + grep 兜底**

Run: `bun test src/ 2>&1 | tail -6` —— 全绿（=1018 pass）。
Run: `grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|"readme.md"\|/readme\b\|stone-readme\|readmeMd\|getReadme\|putReadme' src web | grep -v node_modules`
Expected: 仅剩**有意保留**项（`peerReadme*`、`usePeerReadme`、`readmeCache`、`loadReadme`、`readmeInflight`、`readmeSubscribers`、`__resetReadmeCacheForTest`）——逐条确认是延后项，无其它残留。

- [ ] **Step 4.4: Commit**

```bash
git add -A && git commit -m "refactor(L0+): Object readme.md → readable.md 归一（symbol/route/createStone字段/web URL/seed 文本）"
```

### Task 5: meta 文档 readme→readable 布局约定

**Files:** Modify `meta/object.doc.ts` 及其它 meta 中 `readme.md`（Object 布局约定）处

- [ ] **Step 5.1:** `grep -rn 'readme\.md\|readmeMd\|/readme\b' meta/*.doc.ts`，逐条分类（Object 布局约定→改；无关/已是 readable 概念→留）。
- [ ] **Step 5.2:** 改布局约定 `readme.md`→`readable.md`；source 锚点若指 `stone-readme.ts`/旧符号→`stone-readable.ts`/新符号。**不动** peer_readme/relation 设计注记（relation 待删，保留至 relation-removal 层）。
- [ ] **Step 5.3:** `for f in meta/*.doc.ts; do bun tsc --noEmit "$f" || echo "FAIL: $f"; done`，无 FAIL。
- [ ] **Step 5.4: Commit** —— `git add meta/ && git commit -m "docs(L0+): meta 同步 readable.md 约定改名 + 重定位锚点"`

---

## Part 2：验证

### Task 6: 全量测试 + 双 tsc + 终扫
- [ ] **Step 6.1:** `bun test src/ 2>&1 | tail -8` —— ≥1018 pass。
- [ ] **Step 6.2:** `bun run check:tsc 2>&1 | tail -6`（根）+ `cd web && bunx tsc --noEmit 2>&1 | tail -6 && cd ..`（web）——无类型错误。
- [ ] **Step 6.3:** 终扫（同 Step 4.3 grep），确认仅延后项残留。

### Task 7: harness 回归（fresh world）
> 行为保持，回归 = 既有链路不退化 + 新 `readable.md` 写/读路径生效。用全新 world dir（现有 .ooc-world 有旧 readme.md + bootstrap 幂等早返回）。

- [ ] **Step 7.1:** `RUN_BACKEND_E2E=1 bun test tests/e2e/backend/route-audit.e2e.test.ts` —— PASS（含 `/readable` 路由注册；若 route-audit 硬编码 `/readme` 断言需同步改）。
- [ ] **Step 7.2:** `RUN_BACKEND_E2E=1 bun test tests/e2e/backend/stones-versioning.e2e.test.ts` —— PASS（createObject 写 readable.md 链路）。
- [ ] **Step 7.3:** 确定性 e2e（compression/permission）+ 对比 `stone-client-parity` 仍是 pre-existing 1 fail（不新增回归）。
- [ ] **Step 7.4:** `git status` 干净；若 e2e 断言需同步改名：`git add -A && git commit -m "test(L0+): e2e 断言同步 readable.md 改名"`。

---

## Self-Review
- **Spec 覆盖**：§8/§H readme→readable（Task 1-5）；§11 gate tsc meta。**延后**：peerReadme*/relation（relation-removal 层）、usePeerReadme/web 概念（L8）、readable.ts 函数（L1 后半，需 L2 原型链）。
- **占位符**：无 TBD；每步具体 symbol 旧→新 + 文件行号。
- **命名一致性**：`readmeFile→readableFile`/`readReadme→readReadable`/`writeReadme→writeReadable`/route `/readme→/readable`/body `readme→readable`/`readmeMd→readableMd`/`useStoneText kind "readme"→"readable"`——Task 1-4 与 Step 4.3 终扫 token 对应；延后项（peerReadme*/usePeerReadme/readmeCache）显式列入允许残留。
- **边界**：不改 peerReadme* relation 概念、HTTP server、术语；web hook 仅改 URL。
</content>
