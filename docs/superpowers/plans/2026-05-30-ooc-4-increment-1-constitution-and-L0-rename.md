# OOC-4 Increment 1：宪法更新 + L0 目录归一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ooc-4 宪法 root 层概念落到 `meta/object.doc.ts`（readable 第 9 维 + 单一 Object + 目录命名），并完成 L0 两项纯目录约定改名 `server/`→`executable/`、`readme.md`→`readable.md`，全程 `bun test src/` 绿，最后走 harness 回归。

**Architecture:** spec `2026-05-30-ooc-4-incremental-object-unification-design.md` 的第一个增量。先做 meta-first 宪法 root 更新（无行为变更），再做行为保持型 rename refactor。rename 按「概念分组」原子提交（symbol 定义 + 全部 caller + HTTP 路由两端 + 测试断言 + web 消费端一起改），每个 commit 后 `bun test src/` 仍全绿。

**本 increment 显式不做（留后续 increment）：**
- **`client/`→`visible/` 改名**：与 `ooc://client/` Agent 稳定寻址协议（`web/src/shared/ui/oocUri.ts:19` `CLIENT_PREFIX`）+ `client/pages/` flow 约定深度耦合，超出纯机械改名 → 推迟到 visible/web 统一层（spec L8）。
- `ui_methods`→`for_ui_access` 语义（spec §4 方法可见性层）。
- `command`→`method` 代码结构改名（`CommandTableEntry`/`commands` 深植 registry → spec L4 A 类迁移时一并做；L0 仅文档术语，且仅在确属「Object 方法」语境）。
- `readable.ts` 函数实装（spec L1 readable 泛化层）。
- 原型链 / A-B 塌缩 / context 树（spec L2-L7）。

**Tech Stack:** TypeScript / bun runtime；`bun:test`（gate = `bun test src/`，与 package.json `verify` 一致；`bun test` 含非确定性 LLM 集成测试，不作 gate）；Elysia HTTP；vite + React（web，独立 `web/tsconfig.json`）；`bun tsc --noEmit` 校验 meta。

---

## 前置：基线确认

- [ ] **Step 0.1: 确认分支与基线绿（gate = `bun test src/`）**

Run: `cd /Users/zhangzhefu/x/ooc-2/ooc && git branch --show-current && bun test src/ 2>&1 | tail -8`
Expected: 分支 = `ooc-4`；`bun test src/` 全绿（基线 ~1018 pass / 0 fail）。**不要**用 `bun test`（会扫 `tests/integration/` 的 LLM 非确定性用例，已知 `meta-programming.integration.test.ts` / `abandon-via-close.integration.test.ts` 偶发 fail，与本改名无关）。记录通过数作对照。

- [ ] **Step 0.2: grep-first 推导权威 caller 集（防遗漏）**

Run:
```bash
grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|"readme.md"\|/readme\b' src web | grep -v node_modules
grep -rn --include='*.ts' --include='*.tsx' 'serverDir\b\|serverIndexFile\|readServerSource\|writeServerSource\|"server", "index"\|/server-source' src web | grep -v node_modules
```
把命中文件与下方 Task 3/4 Files 清单逐一对照；若出现清单外文件，先补进对应 Task 的 Files 再动手。**已知必含**（feasibility review 核验）：`src/thinkable/knowledge/synthesizer.ts:25,368,373`、`src/persistable/stone-versioning.ts:35,747`、`web/src/domains/objects/query.ts:300`、`src/app/server/__tests__/issue-6-api-consistency.test.ts`、`src/executable/__tests__/program.test.ts:9`、`src/executable/__tests__/server-self.test.ts:5`。

---

## Part 1：meta-first 宪法 root 更新（无代码行为变更）

### Task 1: object.doc.ts root —— 9 维度 + 单一 Object + 目录命名

**Files:** Modify `meta/object.doc.ts`（root.content / root.named）

- [ ] **Step 1.1: 读 root 节点现状**

Run: `sed -n '61,165p' meta/object.doc.ts`，确认「8 个内在能力维度」段、「自我塑造三件套」段、named 结构。

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

「Agent 由 8 个**内在能力维度**组合」→「Agent 由 9 个**内在能力维度**组合」。在「面向对象 是基础哲学」段后、「Agent 具有 stone、pool、flow」段前插入：
```
    **Context Window 是 Object 的形态**：LLM context 中出现的每个单元（旧称 Context Window）都是某个 OOC Object 在 context 中的呈现形式，不是独立概念。Window 的 command 与 Object 的 method 合并为统一的 **method**。一个 Object 由五件持久化组成：self.md（身份）/ executable/（方法）/ readable.(md|ts)（对外展示）/ visible/（人类 UI）/ children/（子对象）。
```

- [ ] **Step 1.4: root.content —— readable/visible 对偶**

在「两条贯穿全维度的横切设计」的 agent-native-parity 行后补：
```
      readable / visible 正是这条公理的一组范例：visible 是 Object 的人类面展示（浏览器 UI），readable 是 Object 的 agent 面展示（出现在他者 LLM context 中的 XML）。
```

- [ ] **Step 1.5: root.named —— 补 readable / 修订三件套与 visible**

- key `"自我塑造三件套"` → `"自我塑造四件套"`，value → `"reflectable/programmable/visible/readable，Agent 改写自己知识/方法/人类界面/对外展示的四维"`。
- `"visible"` value → `"OOC Agent 由几个维度组合，visible 是其中之一，定义 Agent 持有/演化面向人类的 UI 页面的能力"`。
- 新增 `"readable": "OOC Agent 由几个维度组合，readable 是其中之一，定义 Agent 持有/演化面向 LLM 的对外展示（出现在他者 context 中的呈现）的能力；与 visible 对偶"`。
- `"executable"` value 末尾补 `"（方法落 executable/ 目录）"`。

- [ ] **Step 1.6: tsc 校验**

Run: `bun tsc --noEmit meta/object.doc.ts`，Expected 无报错（`sources` 多 entry 则按 CLAUDE.md 折叠成 1 个）。

- [ ] **Step 1.7: Commit**

```bash
git add meta/object.doc.ts && git commit -m "docs(object): ooc-4 宪法 root — readable 第9维 + 单一 Object 概念 + 四件套目录命名"
```

### Task 2: object.doc.ts —— 新增 readable 维度节点

**Files:** Modify `meta/object.doc.ts`（root.children 在 `visible` 节点后插入 `readable`）

- [ ] **Step 2.1: 定位 visible 节点**

Run: `grep -n '"visible"' meta/object.doc.ts | head`，`sed -n` 读出 visible 子节点完整结构作镜像模板。

- [ ] **Step 2.2: 在 visible 节点后插入 readable 节点**

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

- [ ] **Step 2.3: tsc 校验**

Run: `bun tsc --noEmit meta/object.doc.ts`，Expected 无报错。

- [ ] **Step 2.4: Commit**

```bash
git add meta/object.doc.ts && git commit -m "docs(object): 新增 readable 维度节点（visible 对偶，泛化 renderXml）"
```

---

## Part 2：L0 目录约定改名（行为保持型 refactor）

> rename 行为保持：每个任务后 `bun test src/` 应仍全绿（HTTP route + web 消费端 + 测试断言同步改）。任务末尾 grep 兜底确认旧 token 清零。

### Task 3: `readme.md` → `readable.md` 约定改名（含 createStone body 字段）

**Files:**
- Modify→rename: `src/persistable/stone-readme.ts` → `stone-readable.ts`（`readmeFile`/`readReadme`/`writeReadme` → `readableFile`/`readReadable`/`writeReadable`，`"readme.md"`→`"readable.md"`）
- Modify: `src/persistable/stone-object.ts:6,82,99`（import + createStoneObject + 注释）
- Modify: `src/persistable/index.ts`（barrel：模块路径 + 导出符号）
- Modify: `src/thinkable/knowledge/synthesizer.ts:25,368,373`（import `readReadme,readmeFile`；`peerReadmePath`/`readReadme` 调用）
- Modify: `src/persistable/stone-versioning.ts:35,747`（import `writeReadme`；`writeReadme(ref, input.readmeMd)`——形参 `readmeMd` 可保留或改 `readableMd`，二选一并贯穿）
- Modify: `src/app/server/modules/stones/service.ts`（import；`getReadme`/`putReadme`→`getReadable`/`putReadable`；`join(dir, "readme.md")`→`"readable.md"`；createStone 里 `input.readme` 字段消费 169,187）
- Modify→rename: `src/app/server/modules/stones/api.get-readme.ts`→`api.get-readable.ts`、`api.put-readme.ts`→`api.put-readable.ts`（route `/readme`→`/readable`；调用改名）+ 更新 `src/app/server/modules/stones/index.ts` 的 import
- Modify: `src/app/server/modules/stones/model.ts:8`（createStone body 字段 `readme`→`readable`）
- Modify: `web/src/app/shell.tsx:358,465-467`（`createStone({ readme })`→`readable`；CreateStoneModal 字段）+ 若有 `CreateStoneModal` 组件 props 同步
- Modify: `web/src/domains/objects/query.ts:300`（fetch `/readme`→`/readable`；缓存符号 `readmeCache` 等可保留或改名，二选一）
- Modify: `web/src/domains/clients/StoneFallback.tsx`（`useStoneText` kind `"readme"`→`"readable"`；URL `/readme`→`/readable`；提示串 `readme.md`→`readable.md`）
- Modify: `src/app/server/bootstrap/{supervisor-seed,user-seed}.ts`（如有 `writeReadme` 调用/`readme.md` 注释）
- Modify: 测试 `src/persistable/__tests__/stone.test.ts`、`src/app/server/__tests__/{server.routes,issue-6-api-consistency}.test.ts`

- [ ] **Step 3.1: 读 stone-readme.ts + 确认 caller 全集**

Run: `cat src/persistable/stone-readme.ts` 然后 Step 0.2 的第一条 grep，核对上方 Files 清单完整。

- [ ] **Step 3.2: 改 stone-readme.ts 内容 + 重命名文件**

字面量 `"readme.md"`→`"readable.md"`；`readmeFile`→`readableFile`、`readReadme`→`readReadable`、`writeReadme`→`writeReadable`（JSDoc readme→readable）。然后 `git mv src/persistable/stone-readme.ts src/persistable/stone-readable.ts`。

- [ ] **Step 3.3: 全仓更新 import / 调用 / 路由 / web 消费端**

按 Files 清单逐文件改（旧符号→新符号、`stone-readme`→`stone-readable`、route `/readme`→`/readable`、body 字段 `readme`→`readable`、`api.*-readme.ts`→`api.*-readable.ts` 并更新 `stones/index.ts`）。

- [ ] **Step 3.4: 更新测试断言**

- `stone.test.ts`：`readmeFile`→`readableFile`，`"readme.md"`→`"readable.md"`。
- `server.routes.test.ts` + `issue-6-api-consistency.test.ts`：route `/readme`→`/readable`（issue-6 有 41,49,208,228,237 多处）。

- [ ] **Step 3.5: 测试 + grep 兜底**

Run: `bun test src/ 2>&1 | tail -8`，Expected 全绿（=基线数）。
Run: `grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|"readme.md"\|/readme\b\|stone-readme' src web | grep -v node_modules`，Expected 无输出（保留的 `readmeCache`/`readmeMd` 形参若选择不改名，逐条确认是有意保留）。

- [ ] **Step 3.6: Commit**

```bash
git add -A && git commit -m "refactor(L0): readme.md → readable.md 约定改名（HTTP /readme→/readable + createStone body 字段 + web 消费端）"
```

### Task 4: `server/` → `executable/` 约定改名

**Files:**
- Modify: `src/persistable/stone-object.ts:23-26,85`（`serverDir`→`executableDir`，`"server"`→`"executable"`，注释）
- Modify→rename: `src/persistable/stone-server.ts`→`stone-executable.ts`（`serverIndexFile`→`executableIndexFile`、`readServerSource`→`readExecutableSource`、`writeServerSource`→`writeExecutableSource`、`"server"`→`"executable"`）
- Modify: `src/persistable/index.ts`（模块路径 + 导出符号）
- Modify: `src/executable/server/loader.ts:2,9`（import + `executableIndexFile(stoneRef)`）
- Modify: `src/app/server/modules/stones/service.ts`（import；`getServerSource`→`getExecutableSource`/`putServerSource`→`putExecutableSource`；`join(dir,"server","index.ts")`→`"executable","index.ts"`）
- Modify→rename: `api.get-server-source.ts`→`api.get-executable-source.ts`、`api.put-server-source.ts`→`api.put-executable-source.ts`（route `/server-source`→`/executable-source`）+ 更新 `stones/index.ts`
- Modify: web 若有 `server-source` 消费（`grep -rn "server-source" web/src`）
- Modify: 测试 `src/executable/__tests__/{server-loader,server-self,program}.test.ts`（`writeServerSource`/`server/index.ts` fixture）、`src/app/server/__tests__/{server.routes,issue-6-api-consistency}.test.ts`（route）

> **边界**：只改「Object 持久化 `server/` 子目录约定」。**不改** `src/executable/server/` 这个 src 内部模块目录名——它是代码组织，非 Object 布局。grep 兜底时 `src/executable/server/` 模块路径属合法保留，逐条确认。

- [ ] **Step 4.1: 读 stone-server.ts + 确认 caller 全集**

Run: `cat src/persistable/stone-server.ts` + Step 0.2 第二条 grep，核对 Files 完整（已知含 program.test.ts:9 / server-self.test.ts:5）。

- [ ] **Step 4.2: 改 stone-server.ts 内容 + 重命名文件**

`"server"`→`"executable"`；三函数改名。`git mv src/persistable/stone-server.ts src/persistable/stone-executable.ts`。改 `stone-object.ts:23-26` `serverDir`→`executableDir`（`"server"`→`"executable"`）+ `:85` 注释。

- [ ] **Step 4.3: 全仓更新 import / 调用 / 路由 / web**

按 Files 清单逐文件改。

- [ ] **Step 4.4: 更新测试断言**

server-loader/server-self/program 测试 fixture 的 `server/index.ts`→`executable/index.ts`、`writeServerSource`→`writeExecutableSource`；route 测试 `/server-source`→`/executable-source`。

- [ ] **Step 4.5: 测试 + grep 兜底**

Run: `bun test src/ 2>&1 | tail -8`，Expected 全绿。
Run: `grep -rn --include='*.ts' --include='*.tsx' 'serverDir\b\|serverIndexFile\|ServerSource\|stone-server\|"server", "index\|/server-source' src web | grep -v node_modules`，Expected 仅剩 `src/executable/server/` 模块路径这类合法引用（逐条确认非 Object 布局约定）。

- [ ] **Step 4.6: Commit**

```bash
git add -A && git commit -m "refactor(L0): Object server/ → executable/ 约定改名（HTTP /server-source→/executable-source）"
```

### Task 5: meta 文档术语扫尾（readme/server，含 source 锚点重定位）

**Files:** Modify 提及 `readme.md`/`server/`（Object 布局约定）的 meta 文档——经核 ~8 份：`object.doc.ts`、`app.server.doc.ts`、`app.client.doc.ts`、`engineering.harness.doc.ts`、`engineering.testing.doc.ts`、`cookbook.add-new-agent.doc.ts`、`case.factor-dev-agents.doc.ts`、`case.feishu-integration.doc.ts`

> **范围**：仅 `readme.md`→`readable.md`、`server/`→`executable/`。**不动** `client/` 引用（client→visible 本 increment 已推迟，doc 须与未改的代码一致）。

- [ ] **Step 5.1: 扫描 meta 旧约定 + 失效锚点**

Run: `grep -rn 'readme\.md\|/server\b\|server/index\|stone-server\|stone-readme' meta/*.doc.ts | grep -iv 'src/executable/server'`
逐条分类：是「Object 布局约定」(改) 还是「src 模块路径」(留)。特别留意 source 锚点形如 `stone-readme.ts:6 readmeFile`——rename 后行号/文件名失效，须重定位到 `stone-readable.ts` 新行（CLAUDE.md 约束 #3：锚点漂移属 doc 完整性违规）。

- [ ] **Step 5.2: 改 meta 文档 + 重定位锚点**

按 Step 5.1 分类改 term，并把指向 `stone-readme.ts`/`stone-server.ts`/旧符号的 source 锚点更新到新文件名 + 重新核对行号。window `command`→`method` 仅在确属「描述 Object 方法」语境改（结构性 `CommandTableEntry` 不动）。

- [ ] **Step 5.3: tsc 全量校验 meta**

Run: `for f in meta/*.doc.ts; do bun tsc --noEmit "$f" || echo "FAIL: $f"; done`，Expected 无 FAIL。

- [ ] **Step 5.4: Commit**

```bash
git add meta/ && git commit -m "docs(L0): meta 同步 executable/readable.md 约定改名 + 重定位 source 锚点"
```

---

## Part 3：验证

### Task 6: 全量测试 + 双 tsc 终检

- [ ] **Step 6.1: `bun test src/`**

Run: `bun test src/ 2>&1 | tail -12`，Expected 全绿，≥ Step 0.1 基线数。

- [ ] **Step 6.2: 根 tsc + web tsc（两次，根 tsconfig 不含 web/）**

Run: `bun run check:tsc 2>&1 | tail -12` （根，校验 src/meta/tests）
Run: `cd web && bunx tsc --noEmit 2>&1 | tail -12 && cd ..` （web，校验 Task 3 的 web 改动）
Expected: 两者均无类型错误。

- [ ] **Step 6.3: 旧 token 全仓终扫**

Run: `grep -rn --include='*.ts' --include='*.tsx' 'readmeFile\|readReadme\|writeReadme\|serverIndexFile\|readServerSource\|writeServerSource\|serverDir\b' src web | grep -v node_modules`
Expected: 无输出（保留项如 `src/executable/server/` 模块路径、有意未改的 `readmeCache`/`readmeMd` 已在 Task 3/4 确认）。

### Task 7: harness 回归验证（fresh world）

> 依据 `meta/engineering.testing.doc.ts`（三档评分 Good/OK/Bad；A 孔 backend `app.handle()`；B 孔 frontend Playwright）。本 increment 行为保持，回归目标 = 既有链路不退化 + 新 `readable.md`/`executable/` 写路径真生效。
> **关键**：现有 `.ooc-world/` 已有旧 `readme.md` 布局且 bootstrap 幂等早返回（`ensure-supervisor.ts:140`）——必须用**全新 world dir** 回归，否则 bootstrap 跳过、测的是旧布局（假绿/假红）。

- [ ] **Step 7.1: 后端 e2e（A 孔）**

Run: `bun test tests/e2e 2>&1 | tail -40`（入口以 `meta/engineering.testing.doc.ts` 为准）
Expected: 既有场景 Good/OK 无回退；route-audit / stone readable / executable-source 相关断言通过。

- [ ] **Step 7.2: 全新 world 启动 + 写路径验证**

Run: `bun run src/app/server/index.ts --world ./.tmp-ooc-world-l0 &`（fresh dir，端口默认 3000）
Run: bootstrap 完成后 `find ./.tmp-ooc-world-l0/stones -name 'readable.md' | head` 与 `ls ./.tmp-ooc-world-l0/stones/main/objects/supervisor/`
Expected: 出现 `readable.md`（非 readme.md）；写第一个 method 时按需建 `executable/`（非 server/）。

- [ ] **Step 7.3: 派 AgentOfExperience 真实体验回归**

派 sub agent（体验官角色）经 web 控制面走核心链路：浏览 Object → 看 readable 渲染 → 调一个 method → 看 peer readable（synthesizer 派生路径）。session 用 `_test_experience_<timestamp>` 前缀，验证后清理该 session。**派单 prompt 末尾注明：不要自己 commit。**
Expected: 回流报告无「改名导致链路断裂」；发现问题转 Issue 给对应 AgentOfX。

- [ ] **Step 7.4: 清理 + 收尾**

Run: `rm -rf ./.tmp-ooc-world-l0`；kill server；`git status` 确认无脏文件。
若 e2e 断言需同步改名修订：
```bash
git add -A && git commit -m "test(L0): e2e/harness 断言同步 executable/readable.md 改名"
```

---

## Self-Review（已执行 + 吸收 feasibility review）

- **Spec 覆盖**：覆盖 §2（readable 维度引入，Task 1/2）、§8/§H 中 readme/server 两项（Task 3/4/5）、§9 L0 子集、§11 gate 8（tsc meta）。**显式延后**（Architecture 已声明）：client→visible（与 ooc://client 协议耦合）、§3 原型链、§4 方法可见性、§5 A/B 塌缩、§6 context 树、§7 web visible fallback、§2.2 readable.ts 实装。
- **吸收 feasibility review**：C1→gate 改 `bun test src/`（Step 0.1/3.5/4.5/6.1）；C2→补 synthesizer/stone-versioning/web query/issue-6/program/server-self caller（Step 0.2 + Task 3/4 Files）；C3→client→visible 整体延后；H1→Step 6.2 根+web 双 tsc；H2→Step 7.2 fresh world；M1→createStone body 字段 readme→readable（Task 3 Files）；M2→Task 5 扩到 8 文档 + 重定位锚点。
- **占位符扫描**：无 TBD；每步给具体 symbol 旧→新 + 文件行号。
- **命名一致性**：`readmeFile→readableFile` / `readReadme→readReadable` / `writeReadme→writeReadable` / `serverIndexFile→executableIndexFile` / `readServerSource→readExecutableSource` / `writeServerSource→writeExecutableSource` / route `/readme→/readable` / `/server-source→/executable-source` / body `readme→readable`——Task 3/4 改名与 Step 6.3 终扫 token 互相对应。
- **边界澄清**：改「Object 持久化子目录约定」，不改 `src/executable/server/`、`web/src/domains/clients/` 模块目录与 `ooc://client/` 协议。
</content>
