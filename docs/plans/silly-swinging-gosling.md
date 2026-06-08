# Plan: @ooc/core 理想模块架构重整

## Context

`@ooc/core` 是 OOC 的运行时核心。经过 ooc-6 P1-P6 的快速迭代（`ea6aaf86` redesign Context + Knowledge、`c7f26b83` parentClass 继承链、`466f420c` builtin objects、`f87aa18f` state≠context split 等），代码库处在"新旧逻辑并存"的过渡态：

1. **概念与目录不匹配**：8 个能力维度（thinkable / executable / collaborable / observable / persistable / reflectable / programmable / visible / readable）与实际目录（thinkable / executable / observable / persistable / runtime / extendable / app）只部分对齐。`runtime/` 和 `extendable/` 是新增的非维度目录，但承载了核心职责。
2. **executable 过度膨胀**：既管 tool 执行（exec/close/wait/compress）、又管 Object method 注册与加载（`server/`）、又管 shell/js program 解释器（`program/`）、还管所有 ContextWindow 类型定义与 manager（`windows/` 含 35+ 文件）。"执行"一个词装不下这么多东西。
3. **thinkable 语义错位**：`reflectable/` 子目录实际是 knowledge 常量（属于 thinkable），而 context 的核心数据结构（ContextWindow / OOCObject）却定义在 `executable/windows/_shared/types.ts`。
4. **命名遗留**：`server/` 实际是"Object method 定义与加载"，和 HTTP server 无关；`client/` 实际是 visible UI 源码；`_shared/` 在 `executable/windows/` 和 `extendable/` 下出现两份（后者是 re-export 过渡态）。
5. **deprecated alias 堆积**：`observable/index.ts`、`executable/server/loader.ts`、`executable/index.ts`、`persistable/serial-queue.ts` 都是对 `runtime/` 新类的 thin wrapper，仅为向后兼容。
6. **横切耦合**：`permissions.ts`（准入控制）在 executable 但依赖 observable + persistable；`window-hash.ts` 在 observable 但处理的是 ContextWindow（thinkable context 概念）。

本计划回答一个问题：**理想形态下 @ooc/core 应该有哪些模块、各负责什么、目录如何组织？** 并给出可落地的分阶段迁移路径，与已有的 deprecated-cleanup plan（`docs/plans/2026-06-03-001-refactor-deprecated-code-cleanup-plan.md`）协同执行。

---

## 设计原则

1. **目录 = 概念**：一级目录严格对应 OOC 8 维度 + 横切层。一个文件属于哪个目录，看它回答"Agent 的哪一面"。
2. **维度内聚，横切显式**：维度模块只依赖"更底层"的维度和公共类型；横切关注点（权限、debug、hash）如果必须跨维度，放入专门的横切目录。
3. **Stone 五件套命名与目录名对齐**：`self.md / readable / executable / visible / knowledge` 五个 stone 子目录名必须对应 runtime 中的同名概念模块。
4. **单一真相源**：一个类型/函数只在一个地方定义。re-export 只在 barrel 文件对外暴露 API 时使用，不做"逻辑搬家但定义不动"的半迁移。
5. **与 deprecated-cleanup plan 解耦但协同**：本计划偏"结构重整"（文件移动 + 目录重组），cleanup plan 偏"API 删除"。两者可以并行推进，但结构重整优先（先定位置再删旧名）。

---

## 理想目录结构

```
packages/@ooc/core/
├── index.ts                          # 总 barrel：按维度 re-export
│
├── thinkable/                        # 维度：思考能力（构造 LLM 看见什么 + 怎么想）
│   ├── index.ts
│   ├── thinkloop.ts                  # 单轮 think：permission → buildContext → LLM → dispatchTool
│   ├── scheduler.ts                  # Thread Tree 调度：选下一个 running thread
│   ├── recovery.ts                   # 中断检测与恢复（call_started 锚点）
│   │
│   ├── llm/                          # LLM provider 适配
│   │   ├── index.ts
│   │   ├── client.ts                 # 统一 generate 接口
│   │   ├── types.ts                  # LlmInputItem / LlmTool / LlmGenerateResult
│   │   ├── env.ts                    # 配置读取
│   │   ├── timeout.ts                # 超时控制
│   │   └── providers/
│   │       ├── claude.ts / claude-sse.ts / claude-transport.ts
│   │       └── openai.ts
│   │
│   ├── context/                      # ⭐ Context 是 thinkable 的核心子系统
│   │   ├── index.ts                  # ThreadContext 类型 + buildInputItems / buildContext
│   │   ├── types.ts                  # ProcessEvent / ThreadMessage / ThreadContext
│   │   ├── intent.ts                 # Intent / FormChangeEvent / MethodCallSchema
│   │   ├── budget.ts                 # BudgetManager + 预算策略
│   │   ├── pipeline.ts               # ContextPipeline 分阶段管线
│   │   ├── render.ts                 # XML 渲染调度（含 per-window readable 解析）
│   │   ├── snapshot.ts               # ContextSnapshot（给 observable/debug 用的不可变快照）
│   │   ├── processors/               # Pipeline processors
│   │   │   ├── knowledge.ts
│   │   │   ├── method.ts
│   │   │   ├── peer.ts
│   │   │   └── system.ts
│   │   └── renderers/
│   │       ├── xml.ts / json.ts / trace.ts
│   │
│   ├── knowledge/                    # Knowledge 系统（seed + sediment，渐进激活）
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── loader.ts                 # 从 stone/pool 加载 md
│   │   ├── parser.ts                 # frontmatter 解析
│   │   ├── activator.ts              # computeActivations
│   │   ├── synthesizer.ts            # derivePeerObjectWindows + skill_index 合成
│   │   ├── triggers.ts               # trigger / intent pattern 匹配
│   │   ├── basic-knowledge.ts        # 全局常量知识（BASIC、ROOT 等）
│   │   └── reflectable-knowledge.ts  # super flow 反思协议知识（原 thinkable/reflectable/）
│   │
│   └── windows/                      # ⭐ 从 executable/windows/ 迁入
│       ├── index.ts                  # barrel + side-effect 注册所有 builtin types
│       ├── _shared/                  # 所有 window type 共享基础能力
│       │   ├── types.ts              # ⭐ ContextObject / BaseContextWindow / ObjectType / WindowStatus（真相源）
│       │   ├── command-types.ts      # ObjectMethod / MethodExecutionContext / MethodOutcome
│       │   ├── registry.ts           # ObjectRegistry 的 window 层 helper（或直接 delegate 到 runtime/）
│       │   ├── manager.ts            # WindowManager（contextWindows CRUD + form lifecycle）
│       │   ├── init.ts               # constructor pathway（OOCObject → mount to context）
│       │   ├── viewport.ts / transcript-viewport.ts
│       │   ├── session-path.ts
│       │   └── super-constants.ts
│       │
│       ├── do/  talk/  todo/  plan/  program/  file/  knowledge/
│       ├── search/  skill_index/  method_exec/  relation/
│       └── method_exec/              # form lifecycle：refine / submit / readable
│           ├── index.ts
│           ├── refine.ts / submit.ts / readable.ts / types.ts
│
├── executable/                       # 维度：行动能力（真正"执行"的东西，不含 window 定义）
│   ├── index.ts
│   ├── tools.ts                      # getAvailableTools + dispatchToolCall（4 原语路由）
│   ├── permissions.ts                # ⭐ 准入控制：decidePermission（留在 executable，因为它决定"能不能执行"）
│   │
│   ├── tools/                        # 4 个 LLM tool 原语的 handler
│   │   ├── index.ts / schema.ts
│   │   ├── exec.ts / close.ts / wait.ts / compress.ts
│   │
│   ├── program/                      # ⭐ shell/js 程序解释执行（program method 的运行时）
│   │   ├── types.ts                  # ProgramExecutionResult
│   │   ├── shell.ts                  # shell 命令执行
│   │   ├── format.ts                 # 结果格式化
│   │   ├── self-env.ts               # ProgramSelf 实现
│   │   └── sandbox/
│   │       ├── executor.ts / console.ts / wrap.ts
│   │
│   └── method/                       # ⭐ 从 server/ 重命名：Object method 定义加载 + UI method
│       ├── index.ts
│       ├── types.ts                  # UiServerMethod / UiMethods / ProgramSelf / ServerLoaderEntry / ObjectWindowDefinition
│       ├── enrich.ts                 # stone executable 源码 enrichment
│       ├── loader.ts                 # ⚠️ 注意：runtime/server-loader.ts 是新实现，这里的 loader.ts 是 deprecated wrapper → 删掉，只保留 types
│       ├── self.ts                   # server self 工具
│       └── window-types.ts           # ObjectWindowDefinition 类型细节
│
├── persistable/                      # 维度：持久化（Stone / Pool / Flow 三层文件系统）
│   ├── index.ts
│   ├── common.ts                     # 路径工具 + Ref 类型（FlowObjectRef / ThreadPersistenceRef / StoneObjectRef）
│   │
│   ├── stone-*.ts                    # Stone 层：object.ts / self.ts / readable.ts / executable.ts / visible.ts / knowledge.ts / git.ts / versioning.ts / bootstrap.ts
│   ├── pool-*.ts                     # Pool 层：object.ts / csv-pool.ts
│   ├── flow-*.ts                     # Flow 层：object.ts / data.ts / runtime-object.ts / thread-context.ts / thread-json.ts / relation.ts / context-registry.ts
│   │
│   ├── mention.ts                    # @mention 解析（知识沉淀用）
│   ├── pr-issue.ts                   # PR-Issue 文件格式
│   ├── world-config.ts               # .world.json
│   ├── debug-file.ts                 # LLM input/output debug 落盘（observable 的持久化后端 → 讨论：是否移到 observable/）
│   ├── serial-queue.ts               # 异步串行写队列（deprecated wrapper，删）
│   └── versioned-write.ts            # stone 版本化写
│
├── runtime/                          # ⭐ 横切层：per-world 运行时状态与编排
│   ├── index.ts
│   ├── world-runtime.ts              # WorldRuntime：聚合所有 per-world 状态的根对象
│   ├── object-registry.ts            # ⭐ ObjectRegistry：type → ObjectDefinition 注册 + parentClass 链解析 + method lookup
│   ├── object-type-registrar.ts      # 启动期从 stone 注册 ObjectType
│   ├── stone-registry.ts             # StoneDefinition 注册 + hot-reload 事件
│   ├── observable-store.ts           # ⭐ 从 observable/ 迁入：LlmObservation + pause + permission decider + activation notifier
│   ├── server-loader.ts              # ⭐ stone executable/readable/visible 源码动态加载（真相源）
│   ├── serial-queue.ts               # 真相源：异步串行写队列
│   └── hot-reload.ts                 # stone 文件变更 watcher
│
├── observable/                       # 维度：可观测（保留薄 facade，真相源在 runtime/）
│   ├── index.ts                      # ⚠️ deprecated facade，迁移完成后删除或只 export types
│   └── window-hash.ts                # ⭐ 留在 observable：ContextWindow hash 用于 diff 快照
│
├── extendable/                       # 非维度外接集成层（飞书等外部系统）
│   ├── index.ts                      # side-effect import 所有 builtin + lark
│   ├── _shared/                      # ⚠️ 全删，改为直接 re-export thinkable/windows/_shared
│   └── lark/                         # 飞书集成（cli / event-relay / feishu-chat / feishu-doc）
│
└── app/                              # HTTP 控制面（Elysia server + worker）
    └── server/
        ├── index.ts                  # Elysia app bootstrap
        ├── bootstrap/                # config / migration / recovery / hash
        ├── runtime/                  # worker / job-manager / pause-store / thread-* / resume
        └── modules/                  # 按资源分路由：flows / stones / pools / runtime / ui / health / world-config
```

---

## 关键决策与理由

### D1. `windows/` 从 `executable/` 移到 `thinkable/`
- **理由**：ContextWindow = Object in Context，是"LLM 看见的世界"，本质是 thinkable 的 context 子概念。它的 rendering、readable、compressLevel、provenance、relevance 全是 thinkable 范畴的事。executable 只应该关心"执行 tool/method/program"。
- **影响面**：~35 个文件移动，所有 `../../executable/windows/...` import 路径变更。

### D2. `executable/server/` 重命名为 `executable/method/`
- **理由**："server" 这个名字被 HTTP app/server 占用，且容易让人误解为网络服务。实际职责是"Object method（stone executable/ 目录 + ui_methods）的类型定义、加载、enrichment"。叫 `method/` 与 ObjectMethod 概念对齐。
- **注意**：`server/loader.ts` 本身已是 deprecated（wrap `runtime/server-loader.ts`），迁移时直接删 loader.ts，只保留 types/enrich/self/window-types。

### D3. `observable-store.ts` 留在 `runtime/`，`observable/` 退化为 thin facade（最终删除）
- **理由**：LlmObservation / PauseChecker / PermissionDecider 本质是 per-world 运行时状态，与 WorldRuntime 生命周期一致。当前 `observable/index.ts` 已经是对 `runtime/observable-store.ts` 的 deprecated wrapper，方向正确，只是尚未完成迁移。
- `window-hash.ts` 留在 observable，因为它是"观测"行为（给 debug diff 用的），不是执行也不是思考。

### D4. `permissions.ts` 留在 `executable/`
- **理由**：权限决定"一个 tool/method 能不能被执行"，是执行的前置闸门。虽然它依赖 `observable.getPermissionDecider()` 和 `persistable.deriveStoneFromThread()`，但主语义是 executable 的。依赖是单向的（executable → observable + persistable），不循环。

### D5. `thinkable/reflectable/` 合并进 `thinkable/knowledge/`
- **理由**：当前 `thinkable/reflectable/reflectable-knowledge.ts` 实际是一个 knowledge 常量（super flow 反思协议），不是独立的 reflectable 维度实现。reflectable 作为"自我反思元编程"的真正能力分散在 stone 的 metaprog method 中，不构成独立目录。把文件改名 `reflectable-knowledge.ts` 放进 `knowledge/` 更准确。

### D6. `extendable/_shared/` 删除，改为直接从 `thinkable/windows/_shared/` re-export
- **理由**：当前 extendable/_shared 下的 8 个文件全是 re-export wrapper（Phase 1 迁移过渡态）。Phase 2 直接让 builtin objects import `@ooc/core/thinkable/windows/_shared`。

### D7. `debug-file.ts` 留在 `persistable/`
- **理由**：它做的是"把 debug 信息写到磁盘"，是持久化行为。谁来决定写、写什么由 observable/runtime 决定，但文件 IO 操作属于 persistable。

---

## 与现有 deprecated-cleanup plan 的关系

| Cleanup Plan 章节 | 本计划的关系 |
|---|---|
| A. 类型改名（WindowType→ObjectType 等） | **先做**。类型名稳定后再移动文件，减少 grep 替换量。 |
| B. ContextWindow 字段清理（删 `_decayMeta`） | **可并行**。只改 types.ts 内容，不涉及路径。 |
| C. ObjectMethod 接口清理（删 match/knowledge） | **先做**。ObjectMethod 定义在 `windows/_shared/command-types.ts`，清完接口再搬文件。 |
| D. Budget：删 applyNaturalDecay，BudgetManager 接入 ThinkLoop | **可并行**。thinkable/context/budget.ts 内部修改。 |
| E. Registry 清理（删 module-level default + thin wrapper） | **与 D2 协同**。`server/loader.ts` deprecated wrapper 在这次结构重整中直接删除。 |
| F. ContextPipeline + XmlRenderer 接入生产 | **本计划 D1 的前提**。synthesizer.ts 和 render.ts 是 thinkable 核心，pipeline 接线稳定后迁 `windows/` 更安全。 |
| G. persistable deprecated 删除 | **可并行**。函数改名不涉及路径。 |
| H. 杂项清理（删 relation/、legacy alias） | **可并行**。 |
| I+J. builtin migration | **D1/D6 的前置**。builtin 先迁到新 API，再调整它们 import `_shared` 的路径。 |

**推荐执行顺序**：A → I+J → C → G → E → **结构重整（本计划）** → B → D → F → H

---

## 迁移分阶段

### Phase 0：前置检查
- 跑通 `bun tsc --noEmit` + `bun test packages/@ooc/core` 建立基线
- 确认 cleanup plan A / C / E / I+J 已完成或至少类型稳定

### Phase 1：类型与真相源就位（最小移动，最大类型稳定）
1. 在 `thinkable/context/` 新建 `types.ts`，把 `thinkable/context/index.ts` 中的 ProcessEvent / ThreadMessage / ThreadContext 类型迁过去（index.ts 保持 re-export）
2. **不移动** `executable/windows/`，但先把 `executable/index.ts` 中对 thinkable/knowledge 的反向 re-export（`collectExecutableKnowledgeEntries` 等）标记 @deprecated 并增加注释指向 thinkable/knowledge
3. 删除 `executable/server/loader.ts`（deprecated wrapper），所有调用点改 `runtime/server-loader.ts`
4. 删除 `extendable/_shared/` 8 个文件，改为从 `executable/windows/_shared/` 直接 re-export（减少一层 indirection）

### Phase 2：核心移动（D1 + D2）
5. `executable/server/` → `executable/method/`：所有文件 rename，所有 import 路径更新。`serverDir` → `executableDir` 已在 cleanup plan G 中处理
6. `thinkable/reflectable/reflectable-knowledge.ts` → `thinkable/knowledge/reflectable-knowledge.ts`，更新 synthesizer import
7. **大头**：`executable/windows/` → `thinkable/windows/`
   - 整个目录移动
   - grep 替换所有 `from.*executable/windows` → `from.*thinkable/windows`
   - `executable/index.ts` 不再 export windows 相关，或短期保持 re-export @deprecated
   - `extendable/index.ts` side-effect import 路径更新
   - builtins/* 包的 import 路径更新

### Phase 3：observable 收敛 + runtime 真相源
8. `observable/window-hash.ts` 确认留在 observable（处理 ContextWindow，但语义是观测）
9. `observable/index.ts` 所有函数改为直接从 `runtime/observable-store.ts` re-export（当前已是，但确认没有遗漏）
10. 删除 `persistable/serial-queue.ts`（deprecated wrapper，调用都改 runtime/serial-queue.ts）

### Phase 4：清理与收敛
11. 删除所有短期保留的 @deprecated re-export
12. 更新 `@ooc/core` package 的对外 API 文档（index.ts barrel）
13. 更新 `meta/object.doc.ts` 中所有 `src/...` 代码锚点路径
14. 更新 `meta/object-context-composition.md` 源码锚点

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| import 路径大规模替换导致遗漏 | 高 | 每阶段后 `bun tsc --noEmit` 必过；grep `from ".*executable/(windows\|server)"` 清零验证 |
| builtins 包和 web 包对 core 的 import 断裂 | 中 | 迁移 Phase 2 后立即跑整个 workspace `bun tsc --noEmit`；builtins/* 每个单独验证 |
| runtime circular dependency（thinkable/windows → runtime/object-registry → thinkable/windows/types） | 中 | 提前梳理：types.ts 不依赖 registry；registry 只依赖 types；manager 通过参数注入 registry 实例而非 module-level import |
| test 文件路径引用旧目录 | 高 | `__tests__/` 随源文件一起移动；test 名字保持不变 |
| 与 cleanup plan 步调冲突（两边同时改同文件） | 中 | 本计划 Phase 0 显式等 cleanup 的 A/C/E/I+J；cleanup plan owner 确认后再推进 |

---

## 验证

每阶段结束：
1. `bun tsc --noEmit packages/@ooc/core` 通过
2. `bun test packages/@ooc/core` 通过
3. grep 搜索确认旧路径无残留（如 Phase 2 后搜不到 `executable/windows` / `executable/server` 的非 re-export import）

整体验收：
1. Workspace 级 `bun tsc --noEmit` 通过
2. `bun test packages/@ooc/tests`（e2e）通过
3. App server 启动验证：`bun run dev --world /Users/bytedance/x/ooc/ooc-2/.ooc-world-test` 可正常创建 session、跑 thinkloop、调 method
4. 对照理想目录结构手工清点：每个一级目录职责单一，没有跨界文件
