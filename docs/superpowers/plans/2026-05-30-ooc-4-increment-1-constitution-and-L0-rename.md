# OOC-4 Increment 1：宪法更新 + `server/`→`executable/` 归一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ooc-4 宪法 root 层概念落到 `meta/object.doc.ts`（readable 第 9 维 + 单一 Object + 四件套目录命名），并完成唯一一项干净机械改名 `server/`→`executable/`（Object 持久化方法目录约定），全程 `bun test src/` 绿，最后走 harness 回归。

**Architecture:** spec `2026-05-30-ooc-4-incremental-object-unification-design.md` 的第一个增量。先做 meta-first 宪法 root 更新（无行为变更），再做行为保持型 rename refactor。改名按原子提交（symbol 定义 + 全部 caller + HTTP 路由两端 + 测试断言一起改），commit 后 `bun test src/` 仍全绿。

**本 increment 显式不做（留后续 increment，附理由）：**
- **`readme.md`→`readable.md`**：`readme` 是「peer 公开自述」概念，woven 进 knowledge 合成（`synthesizer`/`basic-knowledge`/`reflectable-knowledge`）、relation/talk/knowledge windows、web snapshot——27 文件且带 `peerReadmeBody`/`readmeCache`/`usePeerReadme` 概念变量名，非纯机械。→ 与 spec L1 readable 层捆绑（readable.md + readable.ts + renderXml 泛化一起做，概念内聚）。
- **`client/`→`visible/`**：与 `ooc://client/` Agent 稳定寻址协议（`web/src/shared/ui/oocUri.ts:19` `CLIENT_PREFIX`）+ `client/pages/` flow 约定耦合 → spec L8 visible/web 统一层。
- `ui_methods`→`for_ui_access`（spec §4 方法可见性层）；`command`→`method` 代码结构改名（`CommandTableEntry`/`commands` 深植 registry → spec L4，L0 仅文档术语且仅「Object 方法」语境）；原型链 / A-B 塌缩 / context 树（spec L2-L7）。

**Tech Stack:** TypeScript / bun runtime；gate = `bun test src/`（与 package.json `verify` 一致；`bun test` 含非确定性 LLM 集成测试，不作 gate）；Elysia HTTP；vite + React（web，独立 `web/tsconfig.json`）；`bun tsc --noEmit` 校验 meta。

---

## 前置：基线确认（已执行）

- [x] **Step 0.1: 分支 + 基线绿** —— 分支 `ooc-4`；`bun test src/` = **1018 pass / 0 fail / 3 skip**（基线对照数）。
- [x] **Step 0.2: server caller 集** —— 12 文件：`src/executable/server/loader.ts`、`src/executable/__tests__/{server-loader,program,server-self}.test.ts`、`src/app/server/__tests__/issue-6-api-consistency.test.ts`、`src/app/server/modules/stones/{api.get-server-source,api.put-server-source,service}.ts`、`src/persistable/{stone-object,stone-server,index}.ts`、`src/persistable/__tests__/stone.test.ts`。

---

## Part 1：meta-first 宪法 root 更新（无代码行为变更）

### Task 1: object.doc.ts root —— 9 维度 + 单一 Object + 目录命名

**Files:** Modify `meta/object.doc.ts`（root.content / root.named）

- [ ] **Step 1.1: 读 root 现状** —— `sed -n '61,165p' meta/object.doc.ts`，确认「8 个内在能力维度」段、「自我塑造三件套」段、named 结构。

- [ ] **Step 1.2: root.content —— 三件套 → 四件套（加 readable）**

把约 87-91 行：
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

- [ ] **Step 1.3: root.content —— 维度 8→9 + 单一 Object 概念**

「Agent 由 8 个**内在能力维度**组合」→「9 个」。在「面向对象 是基础哲学」段后、「Agent 具有 stone、pool、flow」段前插入：
```
    **Context Window 是 Object 的形态**：LLM context 中出现的每个单元（旧称 Context Window）都是某个 OOC Object 在 context 中的呈现形式，不是独立概念。Window 的 command 与 Object 的 method 合并为统一的 **method**。一个 Object 由五件持久化组成：self.md（身份）/ executable/（方法）/ readable.(md|ts)（对外展示）/ visible/（人类 UI）/ children/（子对象）。
```

- [ ] **Step 1.4: root.content —— readable/visible 对偶**

在「两条贯穿全维度的横切设计」的 agent-native-parity 行后补：
```
      readable / visible 正是这条公理的一组范例：visible 是 Object 的人类面展示（浏览器 UI），readable 是 Object 的 agent 面展示（出现在他者 LLM context 中的 XML）。
```

- [ ] **Step 1.5: root.named —— 补 readable / 修订三件套与 visible**

- key `"自我塑造三件套"`→`"自我塑造四件套"`，value→`"reflectable/programmable/visible/readable，Agent 改写自己知识/方法/人类界面/对外展示的四维"`。
- `"visible"` value→`"OOC Agent 由几个维度组合，visible 是其中之一，定义 Agent 持有/演化面向人类的 UI 页面的能力"`。
- 新增 `"readable": "OOC Agent 由几个维度组合，readable 是其中之一，定义 Agent 持有/演化面向 LLM 的对外展示（出现在他者 context 中的呈现）的能力；与 visible 对偶"`。
- `"executable"` value 末尾补 `"（方法落 executable/ 目录）"`。

- [ ] **Step 1.6: tsc** —— `bun tsc --noEmit meta/object.doc.ts`，无报错（`sources` 多 entry 折叠成 1）。

- [ ] **Step 1.7: Commit** —— `git add meta/object.doc.ts && git commit -m "docs(object): ooc-4 宪法 root — readable 第9维 + 单一 Object 概念 + 四件套目录命名"`

### Task 2: object.doc.ts —— 新增 readable 维度节点

**Files:** Modify `meta/object.doc.ts`（root.children 在 `visible` 节点后插入 `readable`）

- [ ] **Step 2.1: 定位 visible 节点** —— `grep -n '"visible"' meta/object.doc.ts | head`，读出 visible 子节点结构作镜像。

- [ ] **Step 2.2: visible 节点后插入 readable 节点**

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

            readable 泛化了旧 ContextWindow 体系里 per-window-type 的 renderXml hook(src/executable/windows/_shared/registry.ts): 从"按 window type 注册渲染"升格为"按 Object、沿原型链解析"。当前为概念引入阶段, 代码实装(含 readme.md→readable.md 改名)见后续 increment(spec L1)。
            `,
            named: {
                "readable": "Object 的对外展示能力: 控制自己出现在他者 LLM context 中的 XML 呈现",
                "readable.md": "静态对外展示文本(将取代旧 readme.md; 改名在 L1 readable 层)",
                "readable.ts": "导出 readable() 函数, 动态计算 Object 在他者 context 中的 XML",
                "对外的脸": "readable 只渲染 Object 出现在他者 context 中的样子; 自己 context 的自视由 thinkable ContextBuilder 负责",
            },
            todo: [
                "spec L1: 把 src/executable/windows/_shared/registry.ts 的 per-type renderXml 泛化为 per-object readable, 沿 extends 链解析; 并把 readme.md→readable.md 一并改名",
            ],
        },
```

- [ ] **Step 2.3: tsc** —— `bun tsc --noEmit meta/object.doc.ts`，无报错。

- [ ] **Step 2.4: Commit** —— `git add meta/object.doc.ts && git commit -m "docs(object): 新增 readable 维度节点（visible 对偶，泛化 renderXml）"`

---

## Part 2：`server/` → `executable/` 约定改名（行为保持型 refactor）

> 改名映射：`serverDir`→`executableDir`、`serverIndexFile`→`executableIndexFile`、`readServerSource`→`readExecutableSource`、`writeServerSource`→`writeExecutableSource`、`"server"` 字面量→`"executable"`、HTTP `/server-source`→`/executable-source`、`getServerSource`/`putServerSource`→`getExecutableSource`/`putExecutableSource`、文件 `stone-server.ts`→`stone-executable.ts`、`api.{get,put}-server-source.ts`→`api.{get,put}-executable-source.ts`。
> **边界**：只改「Object 持久化 `server/` 子目录约定」。**不改** `src/executable/server/` 这个 src 内部模块目录名（代码组织，非 Object 布局）——grep 兜底时它属合法保留。

### Task 3: server→executable rename（一次原子）

**Files:**（= Step 0.2 的 12 文件）
- Modify→rename: `src/persistable/stone-server.ts`→`stone-executable.ts`
- Modify: `src/persistable/stone-object.ts:23-26,85`（`serverDir`+`"server"`+注释）、`src/persistable/index.ts`（模块路径 + 导出符号）
- Modify: `src/executable/server/loader.ts:2,9`（import + `executableIndexFile(stoneRef)`）
- Modify: `src/app/server/modules/stones/service.ts`（import；`getServerSource`/`putServerSource` 改名；`join(dir,"server","index.ts")`→`"executable","index.ts"`）
- Modify→rename: `src/app/server/modules/stones/api.get-server-source.ts`→`api.get-executable-source.ts`、`api.put-server-source.ts`→`api.put-executable-source.ts`（route `/server-source`→`/executable-source`）+ 更新 `src/app/server/modules/stones/index.ts` import
- Modify: 测试 `src/executable/__tests__/{server-loader,program,server-self}.test.ts`、`src/app/server/__tests__/{issue-6-api-consistency}.test.ts`、`src/persistable/__tests__/stone.test.ts`
- 检查 web：`grep -rn "server-source" web/src`（若有消费端同步 `/executable-source`）

- [ ] **Step 3.1: 读 stone-server.ts** —— `cat src/persistable/stone-server.ts`，确认 `serverIndexFile`/`readServerSource`/`writeServerSource` + `"server"` 字面量。

- [ ] **Step 3.2: 改 stone-server.ts 内容 + 重命名**

`"server"`→`"executable"`；三函数改名（JSDoc 同步）。`git mv src/persistable/stone-server.ts src/persistable/stone-executable.ts`。改 `stone-object.ts:23-26` `serverDir`→`executableDir`（`"server"`→`"executable"`）+ `:85` 注释 `server/`→`executable/`。

- [ ] **Step 3.3: 全仓更新 import / 调用 / 路由**

- `src/persistable/index.ts`：`./stone-server`→`./stone-executable`；导出 `serverDir,serverIndexFile,readServerSource,writeServerSource`→新名。
- `src/executable/server/loader.ts:2`：import `serverIndexFile`→`executableIndexFile`；`:9` 调用同步。
- `src/app/server/modules/stones/service.ts`：import + `getServerSource`/`putServerSource`→新名 + `join(dir,"server","index.ts")`→`"executable","index.ts"`。
- `api.get-server-source.ts`/`api.put-server-source.ts`：route `/server-source`→`/executable-source`，调用改名，`git mv` 文件名，更新 `stones/index.ts`。
- web `server-source` 消费端（若 grep 命中）。

- [ ] **Step 3.4: 更新测试断言**

`server-loader.test.ts`/`program.test.ts`/`server-self.test.ts`：fixture `server/index.ts`→`executable/index.ts`、`writeServerSource`→`writeExecutableSource`、import 改名。`issue-6-api-consistency.test.ts`/`stone.test.ts`：route `/server-source`→`/executable-source`、symbol 改名。

- [ ] **Step 3.5: 测试 + grep 兜底**

Run: `bun test src/ 2>&1 | tail -8`，Expected 全绿（=1018 pass）。
Run: `grep -rn --include='*.ts' --include='*.tsx' 'serverDir\b\|serverIndexFile\|ServerSource\|stone-server\|"server", "index\|/server-source' src web | grep -v node_modules`
Expected: 仅剩 `src/executable/server/` 模块路径合法引用（逐条确认非 Object 布局）。

- [ ] **Step 3.6: Commit** —— `git add -A && git commit -m "refactor(L0): Object server/ → executable/ 约定改名（HTTP /server-source→/executable-source）"`

### Task 4: meta 文档 server→executable 扫尾（含锚点重定位）

**Files:** Modify 提及 `server/`（Object 布局约定）的 meta 文档。

- [ ] **Step 4.1: 扫描** —— `grep -rn '/server\b\|server/index\|stone-server\|server 方法库' meta/*.doc.ts | grep -iv 'src/executable/server'`，逐条分类（Object 布局约定→改；src 模块路径→留）。

- [ ] **Step 4.2: 改 term + 重定位锚点** —— `server/`→`executable/`；指向 `stone-server.ts`/旧符号的 source 锚点更新到 `stone-executable.ts` 新文件名 + 核对行号（CLAUDE.md #3 锚点漂移属违规）。window `command`→`method` 仅「Object 方法」语境（结构性 `CommandTableEntry` 不动）。

- [ ] **Step 4.3: tsc 全量** —— `for f in meta/*.doc.ts; do bun tsc --noEmit "$f" || echo "FAIL: $f"; done`，无 FAIL。

- [ ] **Step 4.4: Commit** —— `git add meta/ && git commit -m "docs(L0): meta 同步 executable/ 约定改名 + 重定位 source 锚点"`

---

## Part 3：验证

### Task 5: 全量测试 + 双 tsc 终检

- [ ] **Step 5.1:** `bun test src/ 2>&1 | tail -12`，全绿 ≥1018 pass。
- [ ] **Step 5.2:** `bun run check:tsc 2>&1 | tail -12`（根：src/meta/tests）+ `cd web && bunx tsc --noEmit 2>&1 | tail -12 && cd ..`（web）——两者无类型错误。
- [ ] **Step 5.3:** `grep -rn --include='*.ts' --include='*.tsx' 'serverIndexFile\|readServerSource\|writeServerSource\|serverDir\b' src web | grep -v node_modules` —— 无输出（`src/executable/server/` 模块路径除外，已确认）。

### Task 6: harness 回归验证（fresh world）

> 依据 `meta/engineering.testing.doc.ts`（Good/OK/Bad；A 孔 `app.handle()`；B 孔 Playwright）。行为保持，回归目标 = 既有链路不退化 + 新 `executable/` 写路径生效。**用全新 world dir**——现有 `.ooc-world/` 有旧 `server/` 布局且 bootstrap 幂等早返回（`ensure-supervisor.ts:140`），复用会假绿/假红。

- [ ] **Step 6.1: 后端 e2e（A 孔）** —— `bun test tests/e2e 2>&1 | tail -40`（入口以 `meta/engineering.testing.doc.ts` 为准）。Expected 既有场景无回退；executable-source / route-audit 断言通过。
- [ ] **Step 6.2: 全新 world 启动 + 写路径验证** —— `bun run src/app/server/index.ts --world ./.tmp-ooc-world-l0 &`（端口默认 3000）；bootstrap 后写一个 server method，`find ./.tmp-ooc-world-l0/stones -type d -name executable` 应命中（非 server/）。
- [ ] **Step 6.3: 派 AgentOfExperience 真实回归** —— 经 web 浏览 Object → 看渲染 → 调一个 method → 改/读 executable-source。session 用 `_test_experience_<timestamp>` 前缀，验证后清理。**派单 prompt 末尾注明：不要自己 commit。** 发现问题转 Issue。
- [ ] **Step 6.4: 清理 + 收尾** —— `rm -rf ./.tmp-ooc-world-l0`；kill server；`git status` 无脏文件。若 e2e 断言需修订：`git add -A && git commit -m "test(L0): e2e/harness 断言同步 executable/ 改名"`。

---

## Self-Review（已执行 + 吸收 feasibility review + grep 实勘）

- **Spec 覆盖**：§2（readable 维度引入，Task 1/2）、§8/§H 中 server/ 一项（Task 3/4）、§11 gate 8（tsc meta）。**显式延后**（Architecture 声明 + 理由）：readme→readable（概念尾巴，捆 L1）、client→visible（ooc://client 协议，L8）、§3-§7 各层。
- **吸收 review + 实勘**：C1→gate `bun test src/`（已验 1018 pass）；C2→Step 0.2 实勘 12 文件 caller 全集（含 program/server-self/issue-6 test）；C3→client→visible 延后；H1→Step 5.2 根+web 双 tsc；H2→Step 6 fresh world；readme 概念尾巴（grep 实勘 27 文件）→整体延后 L1。
- **占位符扫描**：无 TBD；每步具体 symbol 旧→新 + 文件行号。
- **命名一致性**：`serverDir→executableDir`/`serverIndexFile→executableIndexFile`/`readServerSource→readExecutableSource`/`writeServerSource→writeExecutableSource`/route `/server-source→/executable-source`——Task 3 改名与 Step 5.3 终扫 token 对应。
- **边界**：不改 `src/executable/server/` 模块目录、`ooc://client/` 协议、readme/client 约定。
</content>
