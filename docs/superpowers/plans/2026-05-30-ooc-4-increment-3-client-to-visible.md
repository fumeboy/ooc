> **状态：DEFERRED（经 feasibility review 判定不按此 scope 执行）**
>
> 两轮设计 + feasibility review 后结论：client→visible **不存在干净的「纯 naming 改名」切面**，与三处深度纠缠：
> 1. **ooc:// 协议破坏**：`ooc://client/`→`ooc://visible/` 是 Agent-facing 寻址协议，须与 dir + routing regex + knowledge seed 同帧改（split-brain 风险）。
> 2. **web 组件命名边界模糊**（review H1）：改组件符号名（ObjectClientRenderer→ObjectVisibleRenderer）但保留文件/目录名（domains/clients）自相矛盾；全改则 ~2000 LOC + 文件/目录/import 大量 churn；半改造成 `CLIENT_PREFIX="ooc://visible/"` 类半态。
> 3. **与 visible 渲染逻辑重做同源**：ObjectClientRenderer 的原型链 fallback 解析（spec §5.2 / L8）就在这批文件里，naming 与 rendering 应一起重做。
>
> **决定**：client→visible 整体并入 **visible 渲染架构层（L8）**，与原型链 fallback 一起做，不作为独立 rename 增量。本文档的逐文件清单 + review 发现（C1 shell.tsx:457,459 反向映射 / C2 _fixture-client.ts:142,151,156 / C3 frontend-object-client-renderer.pw.ts / H2 注释漂移 / H3 route-audit 缺 visible-source gate）保留作 L8 执行时的输入。
>
> 目录归一三部曲现状：**executable/ ✓（Inc1）/ readable.md ✓（Inc2）/ visible 并入 L8**。
>
> ---

# OOC-4 Increment 3：`client/` → `visible/` 归一 Implementation Plan（DEFERRED → L8）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。Steps 用 checkbox。

**Goal:** 完成目录归一三部曲最后一项——Object「人类 UI」约定 `client/`→`visible/`，含 ooc:// 寻址协议 `ooc://client/`→`ooc://visible/`、`client/pages/`→`visible/pages/` flow 约定、`/client-source-url`→`/visible-source-url` endpoint、组件/类型名、agent-facing knowledge、meta、测试。全程 `bun test src/` 绿，harness 回归。

**Architecture:** spec L8 的 naming 部分提前做（dir 归一三部曲收口：executable✓/readable.md✓/visible）。**完整 naming 改名**（避免 split-brain 半态：dir + 协议 + 路由 + 组件名一起动）。行为保持，原子提交。

**本 increment 显式不做（延后）：**
- **visible 渲染逻辑重做**：`ObjectClientRenderer` 的「沿原型链 fallback 解析 visible」行为（spec §5.2 / L8 真正架构）——本次只改名，不改解析逻辑。
- 原型链 / builtin objects / readable.ts 函数 / A-B 塌缩 / context 树。

**关键风险（feasibility review 必查）：**
- `ooc://client/`→`ooc://visible/` 是 **Agent-facing 寻址协议破坏性变更**。须 dir + scheme + 路由 regex + knowledge seed **同帧改**，否则 split-brain（Agent emit ooc://visible 但文件在 client/，或反之）。fresh world 安全（scheme 由代码 + knowledge 重新生成；旧 .ooc-world throwaway）。
- 区分三种「client」：①Object `client/` 持久化约定（改 visible）②React `react-dom/client`（不改）③web 目录 `web/src/domains/clients/`（dir 名延后，内部文件改）。

**Tech Stack:** TypeScript / bun；gate `bun test src/`；Elysia；vite+React（web 独立 tsconfig）。

---

## 前置
- [ ] **Step 0.1:** `git branch --show-current`(=ooc-4)；`bun test src/ 2>&1 | tail -6`(=1018 pass)。
- [ ] **Step 0.2:** caller 集 —— `grep -rln --include='*.ts' --include='*.tsx' 'clientDir\|clientIndexFile\|StoneClientSource\|FlowClientPage\|flowClientPages\|clientSourceUrl\|CLIENT_PREFIX\|ooc://client\|client/pages\|client/index\|client-source' src web | grep -v node_modules`，对照下方 Task Files 补全。

---

## Part 1：persistable 层 client→visible

### Task 1: stone-client.ts → stone-visible.ts + symbols
**Files:** rename `src/persistable/stone-client.ts`→`stone-visible.ts`；`stone-object.ts`（clientDir）；`index.ts`（导出）

映射：`clientDir`→`visibleDir`、`clientIndexFile`→`visibleIndexFile`、`flowClientPagesDir`→`flowVisiblePagesDir`、`flowClientPageFile`→`flowVisiblePageFile`、`readStoneClientSource`→`readStoneVisibleSource`、`writeStoneClientSource`→`writeStoneVisibleSource`、`readFlowClientPage`→`readFlowVisiblePage`、`writeFlowClientPage`→`writeFlowVisiblePage`；字面量 `"client"`→`"visible"`、`"client/pages"`→`"visible/pages"`、`"client/index.tsx"`→`"visible/index.tsx"`。

- [ ] **Step 1.1:** `cat src/persistable/stone-client.ts` 确认符号+字面量。
- [ ] **Step 1.2:** 改内容 + `git mv stone-client.ts stone-visible.ts`；改 stone-object.ts clientDir→visibleDir(`"client"`→`"visible"`)；index.ts 模块路径+符号。

## Part 2：ooc:// 寻址协议 + routing + endpoint

### Task 2: ooc://client → ooc://visible scheme
**Files:** `web/src/shared/ui/oocUri.ts`（`CLIENT_PREFIX`→`VISIBLE_PREFIX`、`"ooc://client/"`→`"ooc://visible/"`、注释、parseOocUri）、`oocText.ts`（`"ooc://client/"` 检查）、`oocUri.test.ts`/`oocText.test.ts`（全部 `ooc://client/`→`ooc://visible/`）

- [ ] **Step 2.1:** 改 oocUri.ts（const 名 + scheme 字面量 + 注释）、oocText.ts。
- [ ] **Step 2.2:** 改两个 test 文件的 `ooc://client/`→`ooc://visible/` 断言。

### Task 3: client/pages routing regex + endpoint
**Files:** `web/src/app/routing.ts`（L129 regex `client\/pages`→`visible\/pages`；`normalizeClientFilePath`→`normalizeVisibleFilePath`）、`web/src/app/shell.tsx`（L85 调用）、`web/src/domains/clients/ClientWithSourceToggle.tsx`（L135,137 两条 regex + `matchClientTarget`→`matchVisibleTarget`）、`web/src/transport/endpoints.ts`（`clientSourceUrl`→`visibleSourceUrl` + route `/client-source-url`→`/visible-source-url`）、`src/app/server/modules/ui/api.client-source-url.ts`→`api.visible-source-url.ts`（route + `clientSourceUrlApi`→`visibleSourceUrlApi` + `join(...,"client",...)`→`"visible"` + flow `"client","pages"`→`"visible","pages"`）、`src/app/server/modules/ui/index.ts`（import+use）

- [ ] **Step 3.1:** 改 routing regex + 函数名 + shell 调用 + ClientWithSourceToggle regex/函数。
- [ ] **Step 3.2:** 改 endpoint helper + route 两端 + api 文件（git mv）+ ui/index.ts。

## Part 3：web 渲染组件名 + meta + knowledge + 测试

### Task 4: web 组件/类型名（纯内部 find-replace）
**Files:** `web/src/domains/clients/ObjectClientRenderer.tsx`（`ObjectClientRenderer`→`ObjectVisibleRenderer`、`resolveClientSource`→`resolveVisibleSource`、types `ClientComponentProps`/`ObjectClientRendererProps`/`ClientSourceResolution`→Visible*、endpoint 调用 `clientSourceUrl`→`visibleSourceUrl`）、`ClientWithSourceToggle.tsx`（组件名+props 类型→Visible*）、`StoneFallback.tsx`（注释）、`web/src/object-client-preview.tsx`、`web/src/app/layout/MainPanel.tsx`（import+用法）
> **保留** `ClientTarget` 类型名（指 endpoint scope 非存储）、`web/src/domains/clients/` **目录名**（dir 名延后到 visible 渲染逻辑层）、`react-dom/client`。

- [ ] **Step 4.1:** 全 web 组件/类型/函数名 client→visible（保留 ClientTarget + 目录名 + react-dom）。

### Task 5: agent-facing knowledge/seed + meta
**Files:** `src/thinkable/knowledge/basic-knowledge.ts`（L186,189,308,340,341,350 `client/pages`/`client/index.tsx`/`ooc://client/`→visible）、`src/app/server/bootstrap/supervisor-seed.ts`（L229-231,328,387,510）、`user-seed.ts`；`meta/object.doc.ts`/`meta/app.client.doc.ts`（client/index.tsx/client/pages/ooc://client 布局约定→visible；**保留** React 组件名引用若指代码、HTTP 控制面 "app.client" 标题）

- [ ] **Step 5.1:** 改 knowledge/seed agent-facing 路径+scheme（LLM emit load-bearing）。
- [ ] **Step 5.2:** 改 meta 布局约定 + ooc:// scheme + source 锚点（stone-client.ts→stone-visible.ts）；`for f in meta/*.doc.ts; do bun tsc --noEmit "$f"; done` 无 FAIL。

### Task 6: 测试
**Files:** `src/persistable/__tests__/stone-client.test.ts`（symbol+字面量；可 git mv→stone-visible.test.ts）、`src/app/server/__tests__/server.routes.test.ts`、`tests/e2e/frontend/_fixture-client.ts`（`writeStoneClient`/`writeFlowClientPage` 方法 + `"client"`/`"client/pages"` 字面量）、`tests/e2e/backend/stone-client-parity.e2e.test.ts`（endpoint `/client-source-url`→`/visible-source-url`）、`tests/e2e/frontend/frontend-routing-and-client-tree.pw.ts`

- [ ] **Step 6.1:** 改测试 symbol/route/字面量/fixture 方法。
- [ ] **Step 6.2: 统一验绿 + grep**
  Run: `bun test src/ 2>&1 | tail -6`（=1018 pass）。
  Run: `grep -rn --include='*.ts' --include='*.tsx' 'clientDir\|clientIndexFile\|StoneClientSource\|FlowClientPage\|flowClientPages\|clientSourceUrl\|CLIENT_PREFIX\|ooc://client\|"client/pages"\|"client/index\|/client-source\|, "client"' src web | grep -v node_modules` —— 仅剩有意保留（ClientTarget、domains/clients 目录、react-dom/client、ObjectClientRenderer 若决定保留——本 plan 改组件名故应清零）。
- [ ] **Step 6.3: Commit**（分 code / meta 两 commit）

---

## Part 4：验证 + harness
### Task 7: 全量 + 双 tsc
- [ ] `bun test src/`（≥1018）；`bun run check:tsc` + `cd web && bunx tsc --noEmit`（两者无错）；grep 终扫。

### Task 8: harness（fresh world）
- [ ] **8.1:** route-audit —— 把新增的 `/readable`+`/executable-source` gate 同理加 `/visible-source-url`？（注：visible-source-url 是 `/api/objects/:scope/:id/visible-source-url`，与 stones gate 形态不同；至少确认 route-audit 全绿，必要时补 gate）。`RUN_BACKEND_E2E=1 bun test tests/e2e/backend/route-audit.e2e.test.ts`。
- [ ] **8.2:** `stone-client-parity.e2e`（client-source endpoint 改名后；注意它本就 pre-existing 1 fail——确认 fail 性质不变，不新增回归）。
- [ ] **8.3:** 确定性 e2e（compression/permission）+ stones-versioning 不退化。
- [ ] **8.4:** 前端 ooc:// 链路若可跑：Playwright `frontend-routing-and-client-tree.pw.ts`（ooc://visible 解析）；否则记录 infra-gated。
- [ ] **8.5:** `git status` 干净；e2e 断言同步 commit。

---

## Self-Review
- **Spec 覆盖**：§8/§H client→visible（dir 归一三部曲收口）；§4.3 ooc:// scheme。**延后**：visible 渲染逻辑（ObjectClientRenderer 原型链 fallback，L8）、domains/clients 目录名、原型链/builtin/readable.ts/A-B/context 树。
- **占位符**：无 TBD；symbol 映射明确。
- **协议破坏**：ooc://client→ooc://visible 须 dir+scheme+routing+knowledge 同帧（fresh world 安全）。
- **边界**：保留 ClientTarget、react-dom/client、app.client 控制面标题、domains/clients 目录名；不改 visible 解析逻辑。
- **待 feasibility review**：caller 完整性（尤其 ooc:// scheme 的全部消费方、client/pages regex 的全部使用点、endpoint 两端）；route-audit 是否需补 visible-source gate；有无 createStone client 字段。
