# OOC-4 Increment 1：宪法更新 + L0 目录归一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ooc-4 宪法的 root 层概念落到 `meta/object.doc.ts`（readable 第 9 维 + 单一 Object + 目录命名），并完成 L0 纯目录约定改名（`server/`→`executable/`、`client/`→`visible/`、`readme.md`→`readable.md`），全程 `bun test` 绿，最后走 harness 回归。

**Architecture:** 这是 spec `2026-05-30-ooc-4-incremental-object-unification-design.md` 的第一个增量。先做 meta-first 的宪法 root 更新（无行为变更），再做 L0 行为保持型 rename refactor。rename 按「概念分组」原子提交（symbol 定义 + 全部 caller + HTTP 路由两端 + 测试断言一起改），保证每个 commit 后整套测试绿。**显式不在本 increment 内**：`ui_methods`→`for_ui_access` 语义、`command`→`method` 代码结构改名、`readable.ts` 函数、A/B 分类与 context 树的代码实现——这些属 L1-L8 后续 increment。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；Elysia（HTTP 控制面）；vite + React（web）；`bun tsc --noEmit` 校验 meta 文档。

---

## 前置：基线确认

- [ ] **Step 0.1: 确认分支与基线绿**

Run: `cd /Users/zhangzhefu/x/ooc-2/ooc && git branch --show-current && bun test 2>&1 | tail -20`
Expected: 分支 = `ooc-4`；测试套件全绿（记录通过数，作为 rename 后的对照基线）。

---

## File Structure

L0 rename 触及的文件按子系统：

- **persistable 布局权威**：`src/persistable/stone-object.ts`（serverDir/clientDir + createStoneObject 内 `readmeFile`）、`stone-server.ts`、`stone-client.ts`、`stone-readme.ts`、`index.ts`（barrel 导出）
- **executable/server loader**：`src/executable/server/loader.ts`、`self.ts`、`types.ts`、`window-types.ts`
- **HTTP API**：`src/app/server/modules/stones/{api.get-readme,api.put-readme,api.get-server-source,api.put-server-source,service}.ts`
- **web**：`web/src/transport/endpoints.ts`、`web/src/domains/clients/{ObjectClientRenderer,StoneFallback}.tsx`
- **bootstrap 种子**：`src/app/server/bootstrap/supervisor-seed.ts`、`user-seed.ts`、`ensure-supervisor.ts`、`ensure-user.ts`
- **测试 fixture**：`src/persistable/__tests__/{stone,stone-client}.test.ts`、`src/executable/__tests__/{server-loader,server-self}.test.ts`、`src/app/server/__tests__/server.routes.test.ts`
- **meta 文档**：`meta/object.doc.ts`（root + readable 节点）

> 改名后用 `grep` 全仓兜底校验无遗漏（每个 rename 任务末尾有 grep 断言步骤）。

---

## Part 1：meta-first 宪法 root 更新（无代码行为变更）

### Task 1: object.doc.ts root —— 9 维度 + 单一 Object + 目录命名

**Files:**
- Modify: `meta/object.doc.ts`（root.content / root.named）

- [ ] **Step 1.1: 读 root 节点现状**

Run: `sed -n '61,165p' meta/object.doc.ts`
确认 root.content 的「8 个内在能力维度」段、「自我塑造三件套」段、named 词典结构。

- [ ] **Step 1.2: 改 root.content —— 自我塑造三件套 → 四件套（加 readable）**

把现有这段（约 87-91 行）：

```
    自我塑造三件套(Agent 改写"自己"的三个面，OOC 自我进化主张的载体):
    - reflectable: 自我反思、经验沉淀、元编程（改自己的知识）
    - programmable: 为自己编写函数方法（改自己的方法 / server 方法库）
    - visible: 为自己编写 UI 页面（改自己的界面）
```

替换为：

```
    自我塑造四件套(Agent 改写"自己"的四个面，OOC 自我进化主张的载体):
    - reflectable: 自我反思、经验沉淀、元编程（改自己的知识；落 self.md / knowledge/）
    - programmable: 为自己编写函数方法（改自己的方法；落 executable/）
    - visible: 为自己编写面向人类的 UI 页面（改自己的浏览器界面；落 visible/）
    - readable: 为自己编写面向 LLM 的对外展示（改自己出现在他者 context 中的呈现；落 readable.md / readable.ts）
```

- [ ] **Step 1.3: 改 root.content —— 维度计数 8 → 9 + 单一 Object 概念**

把「Agent 由 8 个**内在能力维度**组合」改为「Agent 由 9 个**内在能力维度**组合」。

在「面向对象 是基础哲学」段之后、「Agent 具有 stone、pool、flow」段之前，插入一段单一 Object 概念：

```
    **Context Window 是 Object 的形态**：LLM context 中出现的每个单元（旧称 Context Window）都是某个 OOC Object 在 context 中的呈现形式，不是独立概念。Window 的 command 与 Object 的 method 合并为统一的 **method**。一个 Object 由五件持久化组成：self.md（身份）/ executable/（方法）/ readable.(md|ts)（对外展示）/ visible/（人类 UI）/ children/（子对象）。
```

- [ ] **Step 1.4: 改 root.content —— readable 与 visible 的对偶说明**

在「两条贯穿全维度的横切设计」段的 agent-native-parity 那一行后，补一句：

```
      readable / visible 正是这条公理的一组范例：visible 是 Object 的人类面展示（浏览器 UI），readable 是 Object 的 agent 面展示（出现在他者 LLM context 中的 XML）。
```

- [ ] **Step 1.5: 改 root.named —— 补 readable / 修订 visible 与三件套**

在 named 字典里：
- 把 `"自我塑造三件套"` 的 key 改为 `"自我塑造四件套"`，value 改为 `"reflectable/programmable/visible/readable，Agent 改写自己知识/方法/人类界面/对外展示的四维"`。
- 修订 `"visible"`：`"OOC Agent 由几个维度组合，visible 是其中之一，定义 Agent 持有/演化面向人类的 UI 页面的能力"`。
- 新增 `"readable": "OOC Agent 由几个维度组合，readable 是其中之一，定义 Agent 持有/演化面向 LLM 的对外展示（出现在他者 context 中的呈现）的能力；与 visible 对偶"`。
- 修订 `"executable"` value 末尾补 `"（方法落 executable/ 目录）"`；其余维度词条不动。

- [ ] **Step 1.6: 校验 tsc**

Run: `bun tsc --noEmit meta/object.doc.ts`
Expected: 无报错（TS 编译通过）。若报 `sources` 多 entry 之类错误，按 CLAUDE.md 约束折叠成 1 个 source。

- [ ] **Step 1.7: Commit**

```bash
git add meta/object.doc.ts
git commit -m "docs(object): ooc-4 宪法 root — readable 第9维 + 单一 Object 概念 + 四件套目录命名"
```

### Task 2: object.doc.ts —— 新增 readable 维度节点（visible 对偶）

**Files:**
- Modify: `meta/object.doc.ts`（root.children 增加 `readable` 节点；参照现有 `visible` 节点结构）

- [ ] **Step 2.1: 读 visible 节点作为镜像模板**

Run: `grep -n '"visible"' meta/object.doc.ts | head` 然后 `sed -n` 读出 `visible` 子节点的完整结构（title / content / children / sources）。

- [ ] **Step 2.2: 在 root.children 里 visible 节点之后插入 readable 节点**

```ts
        "readable": {
            title: "OOC Agent readable 概念",
            content: `
            Readable 描述 Object 的对外展示能力——Object 如何出现在**其他** Object 的 LLM context 中。

            核心边界:
            1. 只渲染"对外的脸": readable 仅在 Object X 作为 context 单元出现在另一个 Object Y 的 context 中时触发; X 自己的 context(自视)不经 readable, 那是 thinkable 的 ContextBuilder 组装的(X 的状态切片 + X 的各子对象各自的 readable())。
            2. 两种形态: readable.md = 静态文本直接展示; readable.ts = 导出 readable() 函数, 读 Object 运行时字段动态算出 XML。
            3. 沿原型链 fallback: X 无自定义 readable → 沿 self.md 的 extends 链向上找祖先 → root 兜底。
            4. 与 visible 对偶: visible 是人类面(浏览器 UI), readable 是 agent 面(他者 LLM context 的 XML); 二者是 agent-native parity 公理在"展示"这件事上的一组范例。

            readable 泛化了旧 ContextWindow 体系里 per-window-type 的 renderXml hook(src/executable/windows/_shared/registry.ts): 从"按 window type 注册渲染"升格为"按 Object、沿原型链解析"。当前为概念引入阶段, 代码实装见后续 increment(spec L1)。
            `,
            named: {
                "readable": "Object 的对外展示能力: 控制自己出现在他者 LLM context 中的 XML 呈现",
                "readable.md": "静态对外展示文本(取代旧 readme.md)",
                "readable.ts": "导出 readable() 函数, 动态计算 Object 在他者 context 中的 XML",
                "对外的脸": "readable 只渲染 Object 出现在他者 context 中的样子; 自己 context 的自视由 thinkable ContextBuilder 负责",
            },
            todo: [
                "spec L1: 把 src/executable/windows/_shared/registry.ts 的 per-type renderXml 泛化为 per-object readable, 沿 extends 链解析",
            ],
        },
```

- [ ] **Step 2.3: 校验 tsc**

Run: `bun tsc --noEmit meta/object.doc.ts`
Expected: 无报错。

- [ ] **Step 2.4: Commit**

```bash
git add meta/object.doc.ts
git commit -m "docs(object): 新增 readable 维度节点（visible 对偶，泛化 renderXml）"
```

---

## Part 2：L0 目录约定改名（行为保持型 refactor）

> rename 是行为保持的：基线测试套件应在每个 rename 任务后**仍然全绿**（HTTP route 改名的任务里同步改测试断言）。每个任务结尾用 `grep` 兜底确认旧 token 已清零。

### Task 3: `readme.md` → `readable.md` 约定改名

**Files:**
- Modify: `src/persistable/stone-readme.ts`（拟改名为 `stone-readable.ts`）
- Modify: `src/persistable/stone-object.ts:6,99`（import + createStoneObject）
- Modify: `src/persistable/index.ts`（barrel 导出）
- Modify: `src/app/server/modules/stones/api.get-readme.ts`、`api.put-readme.ts`、`service.ts`
- Modify: `web/src/domains/clients/StoneFallback.tsx`
- Modify: `src/app/server/bootstrap/supervisor-seed.ts`、`user-seed.ts`（种子注释/常量名）
- Modify: 测试 `src/persistable/__tests__/stone.test.ts`、`src/app/server/__tests__/server.routes.test.ts`

- [ ] **Step 3.1: 读 stone-readme.ts 全文**

Run: `cat src/persistable/stone-readme.ts`
确认 `readmeFile` / `readReadme` / `writeReadme` 三个导出与 `"readme.md"` 字面量。

- [ ] **Step 3.2: 改 stone-readme.ts 内容并重命名文件**

把 `"readme.md"` 字面量改为 `"readable.md"`；函数 `readmeFile`→`readableFile`、`readReadme`→`readReadable`、`writeReadme`→`writeReadable`（保留 JSDoc，措辞 readme→readable）。然后：

```bash
git mv src/persistable/stone-readme.ts src/persistable/stone-readable.ts
```

- [ ] **Step 3.3: 全仓更新 import 与调用点**

逐个改这些引用（旧名→新名）：
- `src/persistable/stone-object.ts:6` `import { readmeFile } from "./stone-readme"` → `import { readableFile } from "./stone-readable"`；`:99` `writeFile(readmeFile(ref), ...)` → `writeFile(readableFile(ref), ...)`；`:82,99` 注释 readme.md→readable.md。
- `src/persistable/index.ts`：`stone-readme` 模块路径 → `stone-readable`；导出符号 `readmeFile, readReadme, writeReadme` → `readableFile, readReadable, writeReadable`。
- `src/app/server/modules/stones/service.ts`：import `readReadme, writeReadme` → `readReadable, writeReadable`；函数 `getReadme`→`getReadable`、`putReadme`→`putReadable`；`join(dir(objectId), "readme.md")` → `"readable.md"`。
- `src/app/server/modules/stones/api.get-readme.ts`、`api.put-readme.ts`：HTTP route `/readme` → `/readable`；调用 `service.getReadme`→`getReadable` 等。（可一并 `git mv` 文件名 `api.get-readme.ts`→`api.get-readable.ts`、`api.put-readme.ts`→`api.put-readable.ts`，并更新 `stones/index.ts` 的 import。）
- `web/src/domains/clients/StoneFallback.tsx`：`useStoneText` 的 `kind: "self" | "readme"` → `"self" | "readable"`；URL `/api/stones/${objectId}/readme` → `/readable`；提示串 `readme.md` → `readable.md`。
- `src/app/server/bootstrap/supervisor-seed.ts`、`user-seed.ts`：常量 `SUPERVISOR_README_MD` 等保留语义但注释 readme→readable（若有 writeReadme 调用同步改名）。

- [ ] **Step 3.4: 更新测试断言**

- `src/persistable/__tests__/stone.test.ts`：`readmeFile`→`readableFile`，预期字符串 `"readme.md"`→`"readable.md"`，用例名 readme→readable。
- `src/app/server/__tests__/server.routes.test.ts`：route 断言 `/readme`→`/readable`。

- [ ] **Step 3.5: 运行测试 + grep 兜底**

Run: `bun test 2>&1 | tail -20`
Expected: 全绿（与 Step 0.1 基线通过数一致）。

Run: `grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|"readme.md"\|/readme\b\|stone-readme' src web`
Expected: 无输出（除非是历史注释里无害提及，逐条确认）。

- [ ] **Step 3.6: Commit**

```bash
git add -A && git commit -m "refactor(L0): readme.md → readable.md 约定改名（含 HTTP route /readme→/readable）"
```

### Task 4: `server/` → `executable/` 约定改名

**Files:**
- Modify: `src/persistable/stone-object.ts:23-26`（serverDir）
- Modify: `src/persistable/stone-server.ts`（拟改名 `stone-executable.ts`）
- Modify: `src/persistable/index.ts`
- Modify: `src/executable/server/loader.ts:2,9`
- Modify: `src/app/server/modules/stones/{api.get-server-source,api.put-server-source,service}.ts`
- Modify: `web` 若有 server-source 引用
- Modify: 测试 `src/executable/__tests__/server-loader.test.ts`、`src/app/server/__tests__/server.routes.test.ts`

- [ ] **Step 4.1: 读 stone-server.ts 全文**

Run: `cat src/persistable/stone-server.ts`
确认 `serverIndexFile` / `readServerSource` / `writeServerSource` 与 `"server"` 字面量。

- [ ] **Step 4.2: 改 stone-server.ts 内容并重命名文件**

`"server"` 字面量 → `"executable"`；`serverIndexFile`→`executableIndexFile`、`readServerSource`→`readExecutableSource`、`writeServerSource`→`writeExecutableSource`。然后 `git mv src/persistable/stone-server.ts src/persistable/stone-executable.ts`。

同时改 `src/persistable/stone-object.ts:23-26` 的 `serverDir`→`executableDir`（`join(stoneDir(ref), "server")`→`"executable"`），及 `:85` 注释 `server/`→`executable/`。

- [ ] **Step 4.3: 全仓更新 import 与调用点**

- `src/persistable/index.ts`：`stone-server` → `stone-executable`；`serverDir, serverIndexFile, readServerSource, writeServerSource` → `executableDir, executableIndexFile, readExecutableSource, writeExecutableSource`。
- `src/executable/server/loader.ts:2,9`：import `serverIndexFile`→`executableIndexFile`；`file = serverIndexFile(stoneRef)`→`executableIndexFile(stoneRef)`。
- `src/app/server/modules/stones/service.ts`：import `readServerSource, writeServerSource`→`readExecutableSource, writeExecutableSource`；函数 `getServerSource`→`getExecutableSource`、`putServerSource`→`putExecutableSource`；`join(dir(objectId), "server", "index.ts")`→`"executable", "index.ts"`。
- `api.get-server-source.ts`、`api.put-server-source.ts`：route `/server-source`→`/executable-source`；调用改名。（可 `git mv` 文件名 `*-server-source.ts`→`*-executable-source.ts` 并更新 `stones/index.ts`。）
- web：`grep -rn "server-source" web/src` 命中处同步改 `/executable-source`。

> 注意：不要改 `src/executable/server/` 这个**源码目录名**——它是 src 内部模块结构，不是 Object 持久化布局约定；本次只改「Object 的 `server/` 持久化子目录约定」。

- [ ] **Step 4.4: 更新测试断言**

- `src/executable/__tests__/server-loader.test.ts`：fixture 里写 `server/index.ts` 的地方 → `executable/index.ts`；import 改名。
- `src/app/server/__tests__/server.routes.test.ts`：route `/server-source`→`/executable-source`。

- [ ] **Step 4.5: 运行测试 + grep 兜底**

Run: `bun test 2>&1 | tail -20`
Expected: 全绿。

Run: `grep -rn --include='*.ts' --include='*.tsx' 'serverDir\|serverIndexFile\|ServerSource\|stone-server\|"server", "index\|/server-source' src web`
Expected: 无输出（`src/executable/server/` 目录路径本身的合法引用除外——逐条确认这些是模块路径而非 Object 布局约定）。

- [ ] **Step 4.6: Commit**

```bash
git add -A && git commit -m "refactor(L0): Object server/ → executable/ 约定改名（含 HTTP /server-source→/executable-source）"
```

### Task 5: `client/` → `visible/` 约定改名

**Files:**
- Modify: `src/persistable/stone-object.ts:28-31`（clientDir）
- Modify: `src/persistable/stone-client.ts`（拟改名 `stone-visible.ts`）
- Modify: `src/persistable/index.ts`
- Modify: `web/src/transport/endpoints.ts`、`web/src/domains/clients/{ObjectClientRenderer,ClientWithSourceToggle}.tsx`
- Modify: `src/app/server/modules/ui/api.client-source-url.ts`
- Modify: 测试 `src/persistable/__tests__/stone-client.test.ts`、`src/app/server/__tests__/server.routes.test.ts`

- [ ] **Step 5.1: 读 stone-client.ts 全文**

Run: `cat src/persistable/stone-client.ts`
确认 `clientIndexFile` / `flowClientPagesDir` / `flowClientPageFile` / `readStoneClientSource` / `writeStoneClientSource` 等与 `"client"` 字面量。

- [ ] **Step 5.2: 改 stone-client.ts 内容并重命名文件**

`"client"` 字面量 → `"visible"`；函数批量改名 `clientIndexFile`→`visibleIndexFile`、`flowClientPagesDir`→`flowVisiblePagesDir`、`flowClientPageFile`→`flowVisiblePageFile`、`readStoneClientSource`→`readStoneVisibleSource`、`writeStoneClientSource`→`writeStoneVisibleSource`（及任何 `readFlowClientPage`/`writeFlowClientPage`）。然后 `git mv src/persistable/stone-client.ts src/persistable/stone-visible.ts`。

改 `src/persistable/stone-object.ts:28-31` 的 `clientDir`→`visibleDir`（`"client"`→`"visible"`），`:86` 注释 `client/`→`visible/`。

- [ ] **Step 5.3: 全仓更新 import 与调用点**

- `src/persistable/index.ts`：`stone-client`→`stone-visible`；全部 client* 导出符号 → visible*。
- `src/app/server/modules/ui/api.client-source-url.ts`：内部解析 `client/index.tsx`→`visible/index.tsx`；endpoint 字符串若含 `client` 同步（保持 web 两端一致）。
- `web/src/transport/endpoints.ts`：`clientSourceUrl`→`visibleSourceUrl`（含其 URL path）。
- `web/src/domains/clients/ObjectClientRenderer.tsx`：调用 `endpoints.clientSourceUrl`→`visibleSourceUrl`；注释 `client/index.tsx`→`visible/index.tsx`。
- `web/src/domains/clients/ClientWithSourceToggle.tsx`：若引用 client 约定字符串同步。
- 其它 `grep` 命中的 `clientDir`/`clientIndexFile` 调用点。

> 同样不要改 `web/src/domains/clients/` 这个**前端目录名**与 React 自身的 `react-dom/client`——只改「Object 的 `client/` 持久化子目录约定」与对应 endpoint。

- [ ] **Step 5.4: 更新测试断言**

- `src/persistable/__tests__/stone-client.test.ts`：`"client/index.tsx"`→`"visible/index.tsx"`，import 改名。
- `src/app/server/__tests__/server.routes.test.ts`：client-source endpoint 断言同步。

- [ ] **Step 5.5: 运行测试 + grep 兜底**

Run: `bun test 2>&1 | tail -20`
Expected: 全绿。

Run: `grep -rn --include='*.ts' --include='*.tsx' 'clientDir\|clientIndexFile\|StoneClientSource\|flowClientPage\|clientSourceUrl\|stone-client\|"client", \|"client"/' src web`
Expected: 无输出（`react-dom/client`、`web/src/domains/clients/` 目录、`ObjectClientRenderer`/`StoneFallback` 等组件名不在改名范围，逐条确认）。

- [ ] **Step 5.6: Commit**

```bash
git add -A && git commit -m "refactor(L0): Object client/ → visible/ 约定改名（含 client-source endpoint）"
```

### Task 6: meta 文档术语扫尾 + tsc 全量

**Files:**
- Modify: `meta/object.doc.ts` 及其它 `meta/*.doc.ts` 中提及 `server/`/`client/`/`readme.md` 持久化约定处

- [ ] **Step 6.1: 扫描 meta 文档里的旧约定**

Run: `grep -rn 'server/\|client/\|readme\.md\| command ' meta/*.doc.ts | grep -iv 'src/executable/server\|web/src/domains/clients' | head -60`
逐条判断：是「Object 持久化布局约定」(改名) 还是「src 模块路径/无关词」(保留)。

- [ ] **Step 6.2: 改 meta 文档中的 Object 布局约定**

把确属 Object 持久化布局的 `server/`→`executable/`、`client/`→`visible/`、`readme.md`→`readable.md`。术语 window `command`→`method` 仅在「描述 Object 方法」语境改（结构性 `CommandTableEntry` 等代码名不在本 increment）。

- [ ] **Step 6.3: tsc 全量校验 meta**

Run: `for f in meta/*.doc.ts; do bun tsc --noEmit "$f" || echo "FAIL: $f"; done`
Expected: 无 FAIL。

- [ ] **Step 6.4: Commit**

```bash
git add meta/ && git commit -m "docs(L0): meta 文档同步 executable/visible/readable.md 约定改名"
```

---

## Part 3：验证

### Task 7: 全量测试 + 类型检查终检

- [ ] **Step 7.1: 全套单测/集成测试**

Run: `bun test 2>&1 | tail -30`
Expected: 全绿，通过数 ≥ Step 0.1 基线（route/fixture 断言已同步改名）。

- [ ] **Step 7.2: src 类型检查**

Run: `bun tsc --noEmit 2>&1 | tail -30`（若仓库有根 tsconfig；否则 `cd web && bunx tsc --noEmit` 分别校验 web）
Expected: 无类型错误。

- [ ] **Step 7.3: 旧 token 全仓终扫**

Run: `grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|serverIndexFile\|readServerSource\|clientIndexFile\|readStoneClientSource\|clientSourceUrl' src web`
Expected: 无输出（确认 rename 无残留）。

### Task 8: harness 回归验证

> 依据 `meta/engineering.testing.doc.ts`（e2e 三档评分 Good/OK/Bad，A 孔 backend `app.handle()` / B 孔 frontend Playwright）。本 increment 是行为保持型 rename，回归目标 = **既有链路不退化**。

- [ ] **Step 8.1: 启动 app server（显式 --world，避免污染源码树）**

Run: `bun run src/app/server/index.ts --world ./.ooc-world` （后台启动；端口见 `meta/app.server.doc.ts`，默认 3000）
Expected: server 起来，bootstrap 重建 supervisor/user 时写出 `readable.md`（而非 readme.md）、`executable/`/`visible/` 目录约定生效。

- [ ] **Step 8.2: 跑后端 e2e（A 孔）**

Run: `bun test tests/e2e 2>&1 | tail -40`（若 e2e 在 `tests/e2e/`；以 `meta/engineering.testing.doc.ts` 指明的入口为准）
Expected: 既有 e2e 场景 Good/OK，无因改名导致的 Bad；特别确认 stone readable / executable-source / visible-source 相关路由 200。

- [ ] **Step 8.3: 派 AgentOfExperience 跑真实体验回归**

派一个 sub agent（体验官角色）通过 web 控制面走一遍核心链路：浏览一个 Object → 看其 readable/visible 渲染 → 调一个 method。session 用 `_test_experience_<timestamp>` 前缀，验证后清理 `.ooc-world/flows/` 下该 session。
Expected: 回流报告无「改名导致的链路断裂」；若发现问题转 Issue，由对应 AgentOfX 修。

- [ ] **Step 8.4: 清理 + 收尾提交（如有 e2e/fixture 调整）**

Run: 清理测试 session；`git status` 确认无遗留脏文件。
若 Step 8.2/8.3 触发了必要的 e2e 断言改名修订：
```bash
git add -A && git commit -m "test(L0): e2e/harness 断言同步 executable/visible/readable.md 改名"
```

---

## Self-Review（plan 作者自查，已执行）

- **Spec 覆盖**：本 plan 覆盖 spec §2（readable 维度，root 引入 + 节点，Task 1/2）、§8/§H（目录改名，Task 3/4/5）、§9 L0（Task 3-6）、§11 gate 8（tsc meta，Step 6.3/7.2）。**显式不覆盖**（声明在 Architecture，留后续 increment）：§3 原型链、§4 方法可见性 public/for_ui_access、§5 A/B 塌缩、§6 context 树、§7 web visible 原型链 fallback、§2.2 readable.ts 实装（L1）。
- **占位符扫描**：无 TBD/TODO 式占位；每个 rename 步给了具体 symbol 旧名→新名与文件行号；harness 步锚定 `meta/engineering.testing.doc.ts` 入口。
- **类型/命名一致性**：rename 映射全程一致——`readmeFile→readableFile`、`serverIndexFile→executableIndexFile`、`clientIndexFile→visibleIndexFile`、`clientSourceUrl→visibleSourceUrl`、HTTP `/readme→/readable`、`/server-source→/executable-source`，Task 3/4/5 与 Task 7 终扫的 grep token 互相对应。
- **边界澄清**：明确「Object 持久化子目录约定」改名 vs「src 模块目录名 `src/executable/server/`、`web/src/domains/clients/`」不改——避免误伤。
</content>
