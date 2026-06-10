# thinkable 维度清理进度（2026-06-10）

> 与 `docs/2026-06-10-type-system-cleanup-progress.md`（类型系统/executable 侧，另一进程）**并行**的
> thinkable 维度清理。两者共享工作区、交织修改若干文件——本文档跟踪 **thinkable 侧**已完成 /
> 半成品 / 待办，避免跨会话丢进度。
> 原则（CLAUDE.md 性格段）：厌恶不良代码/注释、警惕新增名词、克制熵增。

## 总览：本轮动机

`packages/@ooc/core/thinkable` 长期堆积死代码、重复逻辑、一个会丢数据的预算 bug、满屏施工代号注释；
另外 root 的协议知识以巨型 TS 常量寄居在 thinkable，每轮无条件全量注入、信息过载。本轮：
1. 修真 bug（破坏性预算裁剪）+ 删死代码 + 收敛重复。
2. 剥离施工代号 / 失效文档引用注释。
3. 把 basic/reflectable knowledge 搬成 `builtins/root/knowledge/*.md`，按 `activates_on` 交互面激活 + 信息裁剪。

---

## ✅ 已完成（thinkable 测试全绿：173 tests 0 fail；改动文件 per-file tsc 干净）

### A1. 预算分配的破坏性裁剪 → 收归 pipeline（真 bug 修复）
- `thinkloop.ts`：删除整个预算块——不再 `thread.contextWindows = allocation.visible` 把 overflow 窗口
  **永久从 thread.json 删除**，不再跑第二遍 allocate。
- 删除符号：`BUDGET_MANAGER` 单例、`estimateWindowsTokens`、`buildBudgetWarningItem`（thinkloop 内）、
  `overflowSummary` 死变量、冗余 `context_compressed` 事件注入。
- 预算分配现唯一活在 `context/pipeline.ts`（非破坏性，每轮按 relevance 重算）；overflow 由 renderer 的
  `<context_overflow>` 呈现；soft-warning 注入移入 `context/index.ts:buildInputItems`（新 `buildBudgetWarningItem`）。

### B1. 死 renderer 删除
- **删文件** `context/renderers/json.ts`（`JsonRenderer`）+ `context/renderers/trace.ts`（`TraceRenderer`）——全仓零引用。
- `context/index.ts` 去掉两者 re-export。
- 连带删死的 `trace` 通道：`context/snapshot.ts` 的 `ContextSnapshot.trace` 字段、`pipeline.ts` 的
  `traceIntents` 构造 + `Intent` import（`perWindow` 恒空，仅 TraceRenderer 读）。

### B2 / C3. 死函数 + 重复收敛
- 删 `context/skill-index.ts:mergeSkillIndex`（定义后零调用）。
- token 估算 `JSON.stringify(w).length/4` 三处重复 → `context/budget.ts` 导出单一 `estimateWindowTokens` /
  `estimateWindowsTokens`，`BudgetManager.allocate` 与 soft-warning 共用。

### 注释. 施工代号 / 失效引用清理
- `thinkloop.ts`：剥 `Q0b/Q0c/G2/G4/根因 #1/#4`、`占位模块`、`docs/2026-05-25-*-design.md`、`src/thinkable/`。
- `context/budget.ts`：重写头部（去 `P6`/`meta/object.doc.ts`/已删 design doc）；**修一处失实注释**——
  `hard 阈值 → 强制降级 level 0→1→2/events fold` 在 A1 后已错，改为如实"allocate token 上限，超出归 overflow（保留不丢）"；
  删死字段 `BudgetConfigFile.naturalDecay`。
- `context/index.ts` / `pipeline.ts`：剥 `Phase F`/`batch C5`/`(N4)`/`Q0b/Q0c`。
- `knowledge/triggers.ts`：注释里 `reflectable-knowledge.ts:72` 改为概念引用。

### root knowledge 搬迁：TS 常量 → `builtins/root/knowledge/*.md`（按需激活 + 裁剪）
设计/裁剪策略权威见 `docs/2026-06-10-root-knowledge-as-object-knowledge-design.md`。

- **新增 9 个 knowledge `.md`**（`packages/@ooc/builtins/root/knowledge/`，带 frontmatter `activates_on`）：
  `interaction-core` / `root-methods`（`object::root` 恒在）、`talk-and-super`（`object::talk`）、
  `do-and-share`（`object::do`）、`forms`（`object::method_exec`）、`skills`（`object::skill_index`）、
  `self-evolution`（`object::root` desc + `method::root::write_file`）、`super-flow`（`super`）、
  `end-reflection`（`method::root::end`）。
- **删除常量**：
  - **删文件** `thinkable/knowledge/basic-knowledge.ts`（`KNOWLEDGE` / `BASIC_KNOWLEDGE_PATH`，~495 行）。
  - **删目录** `thinkable/reflectable/`（`REFLECTABLE_KNOWLEDGE` / `REFLECTABLE_GOVERNANCE_KNOWLEDGE` /
    `END_REFLECTION_REMINDER_KNOWLEDGE` + 各 `_PATH` + 旧 test）。
  - `builtins/root/executable/index.ts`：删 `ROOT_KNOWLEDGE` / `ROOT_BASIC_PATH`。
  - `knowledge/index.ts`：去 basic-knowledge re-export。
- **加载机制**（局限 protocol 注入器，不碰 parentClass 链）：
  - `knowledge/loader.ts`：导出 `loadKnowledgeIndexFromDir(dir)`。
  - `context/protocol.ts`：`buildProtocolKnowledgeWindows` 改 **async**；删 5 段常量注入，改为按包名解析
    `@ooc/builtins/root/knowledge` → 模块级 memoize index → `computeActivations(thread, index)` 命中才注入
    （source=protocol）。保留 creator-reply 动态生成。`collectProtocolEntries` 同步改 async。
  - `context/processors/system.ts`：`await buildProtocolKnowledgeWindows`。
- **信息裁剪（砍机制留协议）**：删 worktree-vs-main 深层模型、evolve_self 内部 commit/ff-merge、form 四态机
  内部转移、failed form GC/自然衰减、skill_index TTL；3 示例压成 1。留交互协议（怎么调原语/talk/wait/end/
  write_file 改自己/发起 super 反思）。
- **一处刻意取舍**：`end-reflection` 用 `method::root::end` 触发后，super flow 内开 end form 也会命中
  （旧代码特判排除 super）——纯 `activates_on` 无 "AND NOT super"，接受这点无害冗余换简单。

### B5 / F1. 孤儿导出删除 + 静默吞错收口（第二轮）
- **B5**：删 `context/protocol.ts:collectProtocolEntries`——本批把 reflectable 测试迁走后已成孤儿（零消费方）。
- **F1**：`context/skill-index.ts:synthesizeSkillIndex` 的整体 `catch { return [] }` → 知情跳过（`console.warn` 带
  objectId + 错误，再返回 []）；缺 skills 目录是常态由各 list* 内部按空处理，走到 catch 是真异常不该静默。
- 顺带确认 `getSkillIndexBasicPath` 已随另一进程的 skill_index basicKnowledge 注入删除而消失（无残留孤儿）。

### ★ per-type 协议知识补缺口（type-level basicKnowledge 迁 knowledge 维度，第三轮）
类型系统批删 `ObjectDefinition.basicKnowledge` 后这些 per-window-type 协议知识不再注入 LLM——本批补齐：
- **已覆盖（无需补）**：method_exec / talk / skill_index ← 第二段已建的 `forms.md` / `talk-and-super.md` / `skills.md`。
- **新增 5 个 `.md`**（`builtins/root/knowledge/`，从 git history 恢复 + 砍机制）：`relation.md`（`object::relation`）、
  `plan.md`（`object::plan`）、`search.md`（`object::search`）、`feishu-chat.md`（`object::feishu_chat`）、
  `feishu-doc.md`（`object::feishu_doc`）。这些窗口都由 root method 派生，故同住 root/knowledge；按 `object::<type>`
  激活、窗口出现才注入、不污染其它 thread。
- **零 injector 改动**：`computeActivations` 已支持 `object::<type>` 触发。
- 测试：`protocol-knowledge.test.ts` 加 per-type 激活断言（命中对应 + 不串台）；thinkable 174 tests 0 fail。
- 设计权威：`docs/2026-06-10-root-knowledge-as-object-knowledge-design.md` § per-type 协议知识。

### synthesizer.ts 清理（名不副实 + 放错维度 + 自重复，第四轮）
`knowledge/synthesizer.ts` 早已不合成知识（`collectExecutableKnowledgeEntries` 在 Phase F 拆进 pipeline
processor 链），只剩两个**对象类型注册 / peer 窗口派生**函数——名字与维度都错。
- **改名 + 移出 knowledge/** → `context/object-windows.ts`（消费方都是 context processor、产物是 context window）。
- **抽掉自身重复**：`ensureSelfObjectTypeRegistered` 与 `derivePeerObjectWindows` 各有一份"从 windowDef 注册
  stone 对象类型"逻辑 → 合为本地 helper `registerStoneObjectType`。
- 剥施工代号注释（`Phase F` / `ooc-6 Phase 6` / `P1`）；同步修 `runtime/object-type-registrar.ts` 头部对
  synthesizer 的交叉引用，及 `context/{skill-index,activator-windows,processors/activator}.ts` /
  `knowledge/triggers.ts` 里指向已删 `synthesizer.collectExecutableKnowledgeEntries` 的腐烂注释。
- importer 更新：`processors/{peer,system}.ts`、`knowledge/index.ts`（删 barrel re-export，无人经 barrel 消费）、
  `peer-object-derive.test.ts`（随源码移到 `context/__tests__/`）、`ooc6-object-unification.harness.test.ts`。
- **跨文件重复仅标注未动**：`ObjectTypeRegistrar.registerStone`（runtime，注册主路径）与本文件两个渲染期兜底
  同源——统一抽取跨 runtime/thinkable，留 type-system 批协调。
- thinkable 174 tests 0 fail；改动文件 tsc 干净。

### 受影响测试（已迁移并通过）
- **新增** `context/__tests__/protocol-knowledge.test.ts`（验证各交互面命中对应切片、互不串台、source=protocol）。
- **重写** `tests/e2e/backend/end-reflection-reminder.e2e.test.ts`（按 end form 在/不在门控，走完整 buildInputItems）。
- **改断言** `tests/integration/super-flow-channel.integration.test.ts`（`internal/executable/reflectable/basic` → `<path>super-flow</path>`）、
  `executable/__tests__/root.command.refine-hint.test.ts`（读 `forms.md` 断言 refine/submit/失败复活/不要 close 重开）、
  `thinkable/__tests__/context.test.ts`（`method="talk"` → `talk_window`）、
  `thinkable/__tests__/thinkloop.test.ts`（`<path>internal/basic</path>` → `<path>interaction-core</path>`）。
- 注释指向已删文件的 stale ref 修正：`builtins/knowledge/types.ts`、`web/src/shared/ui/oocUri.ts`、
  `app/server/modules/ui/__tests__/client-source-url.test.ts`。

---

## 🟡 半成品 / 当前状态

- **未提交**：工作区与另一进程（executable/类型系统）的改动交织，且 `bun run check:tsc` 因其 in-flight
  重构（`object-types.ts→types.ts` 重命名、`ObjectDefinition` Pick 改动）整体红。**待两批都落到 tsc 全绿后**，
  把 thinkable 这批单独成 commit（与类型系统批分开，历史更干净）。
- **storybook gate 8 fail 全属另一进程**（L2-CONTEXT-WINDOW-TYPES / L3·L7-UI-METHOD / L8-TYPES-CATALOG /
  control-plane executable·reflectable·programmable·visible）——server build 受 ObjectDefinition/object-types
  改动影响。我改的 `L2-ROOT-KNOWLEDGE`（已迁为读 `root-methods.md`）通过。
- **交叉文件**（两进程都改过，注意合并）：`context/protocol.ts`、`context/processors/system.ts`、
  `context/renderers/xml.ts`、`knowledge/synthesizer.ts`。其中 `synthesizer.ts:28` 仍 import 已被另一进程删除的
  `executable/object/object-types.js`——该 import 路径收口归类型系统批。

---

## ⬜ 后续待办（thinkable 侧）

### thinkable 自身待办（低风险净收益，本批刻意推迟）
- **C1**：builtin window type 字面量集合重复 4 处（`runtime/object-registry.ts` / `_shared/types/context-window.ts` /
  `context/index.ts:BUILTIN_WINDOW_TYPES` / `renderers/xml.ts:BUILTIN_TYPES`）。canonical 修法要动 `_shared` /
  `runtime`（公共文件，易撞另一进程）——**等类型系统批落定再统一收敛到单一导出**。
- **C2（决定不做）**：`nextSyntheticId`/`syntheticIdCounter` 在 `context/protocol.ts` 与
  `context/activator-windows.ts` 各一份（逐字相同）。收敛需新增 helper 文件——与"警惕新增名词"权衡后
  留重复（两个 4 行函数、漂移风险近零，新文件净收益为负）。
- **B4（保留）**：`context/index.ts:buildContext`（LlmMessage 版）是真测试基建（step2-windows /
  viewport-integration / context.test / `real-thinkloop.test.ts` 的 `spyOn` 依赖），非死代码，保留。
- **D1**：xml shim 退场——`builtins/*` 与 `executable/*` 共 ~15 处从 `thinkable/context/xml.js` 反向 import
  `xmlElement` 等（物理实现在 `_shared/types/xml`）。改引 `_shared`、shim 退场。纯 executable/builtins 地盘，归另一进程或单独批。
- **F1**：`context/skill-index.ts:synthesizeSkillIndex` 整体 `catch { return [] }`——skill 目录配错会无声消失，
  与全局 silent-swallow ban 有张力。应区分"知情跳过"与"静默吞错"。

### 文档回填
- root knowledge 搬迁是 thinkable/reflectable 维度的设计变更——后续应把"basic/reflectable 协议知识 = root 这个
  builtin object 的 knowledge，按 activates_on 交互面激活"沉淀进 `.ooc-world-meta` 对应维度对象的 `self.md` / `knowledge/`。
