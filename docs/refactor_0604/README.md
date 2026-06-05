# OOC 架构重构总纲（2026-06-04）

> 代号：ooc-6 架构清理 · phase 2
> 主管视角：Supervisor
> 适用范围：`packages/@ooc/core/*` + `packages/@ooc/builtins/*`

---

## 0. 决策记录

| # | 决策 | 背景 |
|---|------|------|
| D1 | **`executable/program/` 目录保留不移动** | 用户明确指示：shell/sandbox/format 等程序运行时内容继续留在 `executable/program/` 下，不独立成 `program-runtime` 包 |
| D2 | **重构以"自下而上"的方式推进**：先清理模块内的死代码/命名债务，再做跨模块类型抽取，最后做目录级迁移 | 上一阶段（ooc-6 cleanup phase 1）已经完成 10 phase 的 deprecated API 删除和类型重命名，本阶段是结构性改进，不追求一次到位 |
| D3 | **所有子方案以模块第一人称撰写**，输出到 `docs/refactor_0604/<module>.md` | 让每个模块审视"我是谁、我有什么、哪些不属于我" |
| D4 | **保持 backward compatibility 仅针对 persisted 数据**（thread.json、context.json 等）；代码层 API 不做兼容层 | 与 phase 1 一致 |

---

## 1. 本阶段目标

在 ooc-6 cleanup phase 1（类型重命名、deprecated API 删除）完成的基础上，解决以下三类结构性问题：

1. **模块职责混杂**：`executable/` 同时承担了 LLM tool 调度、ObjectMethod 定义与执行、Window 类型+渲染、程序沙箱 5 类职责；`persistable/` 塞入了 git 工作流、metaprog 编排等非持久化逻辑。
2. **thinkable ↔ executable 双向重度耦合**：两者互相 import 对方的核心类型，形成隐式循环依赖路径。需要抽取中立的 `_shared/types/` 共享类型包。
3. **系统性命名债务 + 重复代码**：`server/` 与 HTTP server 撞名、`command.*.ts` 未跟上 `method` 术语、19 处 `guidanceWindows()` 逐字重复等。

**不做的事**：
- 不动 `executable/program/`（D1）
- 不引入新的 runtime 依赖、不改 OOC 对外语义
- 不重写任何业务逻辑（只做结构迁移 + 死代码删除 + 公共抽取）

---

## 2. 参与模块与子方案

| 模块 | 子方案文档 | 负责维度 |
|------|-----------|---------|
| `@ooc/core/executable/` | `executable.md` | 行动能力：tool 调度、method 执行、Window 执行侧、权限、program 沙箱 |
| `@ooc/core/thinkable/` | `thinkable.md` | 思考能力：context 构建、knowledge、LLM、scheduler、thinkloop |
| `@ooc/core/persistable/` | `persistable.md` | 持久化能力：stones/flows/pools/thread/debug 的 IO |
| `@ooc/core/observable/` + `@ooc/core/app/server/` | `app-and-observable.md` | 观测能力 + HTTP 控制面 |
| `@ooc/builtins/*` | `builtins.md` | 内置 Object Type：root/file/knowledge/program/todo/plan/search/skill_index 等 |
| 中立共享类型包（新建） | `shared-types.md` | `_shared/types/` 与 `_shared/utils/`：破双向耦合 |

每个子方案包含：
- **我是谁**（模块定位一句话 + 与 8 维度的映射）
- **我有什么**（本模块定义的所有类型、函数、常量符号清单——文件路径 + 一句话说明）
- **哪些不属于我 / 哪些我做得不好**（冗余、耦合、命名债务、Bug）
- **理想的我**（理想目录结构 + 对外 API 面）
- **分步骤优化方案**（高 / 中 / 低优先级，可独立执行）

---

## 3. 理想架构全景

### 3.1 模块依赖方向（无环）

```
    _shared/types + _shared/utils    ← 零业务，纯类型与工具
          ↑             ↑
    executable/     thinkable/
       ↑  ↑            ↑  ↑
persistable/     programmable/  observable/  runtime/
       ↑              ↑             ↑
       └───────── app/server ───────┘
                      ↑
                  builtins/*
```

依赖只能从下往上、从右到左。反向箭头 = 设计问题。

### 3.2 模块职责边界

| 模块 | 纯正职责（"拥有"的东西） | 不应该有的 |
|------|------------------------|-----------|
| `_shared/types/` | `ContextWindow` 家族、`ThreadContext`、`ProcessEvent`、`Intent`、`FormChangeEvent`、`ObjectMethod`、`ObjectDefinition`/`ObjectRegistry` 接口、`XmlNode`、`MethodCallSchema`、`KnowledgeFrontmatter` | 任何 IO、任何实现 |
| `_shared/utils/` | `parseMentions`、CSV parser、`Viewport`/`TranscriptViewport` 纯函数、path helper | 任何业务 |
| `executable/` | LLM tool 4 原语调度、ObjectMethod exec、WindowManager（CRUD+submit）、do/talk/method_exec 的 method 实现、权限决策、program 沙箱（**保留**）、Stone Object 加载与运行时 self | Window 类型定义、renderXml、View 层纯函数 |
| `thinkable/` | ContextPipeline + 5 processors + renderers、knowledge 子系统（parser/loader/triggers/activator）、LLM provider 适配、scheduler、thinkloop、recovery | Window 执行逻辑、直接写盘（通过 persistable） |
| `persistable/` | stones/flows/pools/thread/debug 的**纯 IO 层**、路径构造、JSON 序列化、backward-compat 数据迁移 | git CLI 封装、metaprog 工作流、权限校验、字符串正则 |
| `programmable/` (NEW) | `stone-versioning.ts`、`stone-git.ts`、`stone-bootstrap.ts`、`versioned-write.ts`（从 persistable 迁出） | 非 versioned 的普通文件 IO |
| `observable/` → 并入 `runtime/` | LLM 观测、pause 检查、permission decider 注入、统一 logger | 直接写盘（通过 persistable） |
| `runtime/` | `ObjectRegistry` 实现、server-loader、serial-queue、stone-registry、hot-reload、pause-store、observable-store | HTTP 路由 |
| `app/server/` | HTTP/Elysia 路由、worker 调度、jobManager、bootstrap 迁移检查 | 业务逻辑（下沉到各 domain 模块） |
| `builtins/` | 各 Object Type 的 method 定义 + renderXml + visible 组件 | 重复的工具函数（抽 `_shared/executable/`） |

### 3.3 builtins 目录形态

```
builtins/
├── _shared/
│   ├── executable/             # NEW
│   │   ├── guidance.ts         # guidanceWindows() + makeBasicFormHandler()  消 19+38 处重复
│   │   ├── delegator.ts        # makeRootDelegator()                        消 10 处重复
│   │   ├── viewport-adapter.ts # makePrefixedViewport()                      消 2 处重复
│   │   └── utils.ts            # isString / basenameOfPath / emptyIntent     消 40+ 处重复
│   └── visible/utils.ts        # 已有
├── root/executable/
│   ├── method.talk.ts          # 从 command.talk.ts 改名
│   ├── method.do.ts            # 从 command.do.ts 改名
│   └── ... (共 13 个 method.*.ts)
├── search/executable/
│   └── method.set-results-window.ts
└── (删除 command_exec/ 空遗留目录)
```

---

## 4. 执行批次（自上而下可独立推进）

### 批次 A：死代码删除 + Bug 修复（≤ 1 天）

| # | 行动 | 影响文件 | 子方案 |
|---|------|---------|--------|
| A1 | 删除 `collectExecutableKnowledgeEntries` / `deriveRelationWindow*` 3 个 / `renderContextXml` backward-compat shim，迁移对应测试 | synthesizer.ts、context/render.ts、~6 test files | thinkable |
| A2 | 删除 `persistable/serial-queue.ts` deprecated wrapper | 1 文件，调用方改直接 import runtime/serial-queue | persistable |
| A3 | 删除 `executable/index.ts` barrel（只剩 thinkable 的反向 re-export） | 1 文件，调用方改从 thinkable/knowledge import | executable |
| A4 | 删除 `executable/server/loader.ts` deprecated thin wrapper，全量调用方改 `runtime/server-loader` | 1 文件 + 若干 import | executable |
| A5 | 删除 `builtins/command_exec/` 空遗留目录 | 1 目录 | builtins |
| A6 | 清理 `synthesizer.ts:288-297` 9 个 `void xxx` 未用 import 抑制 | 1 文件 | thinkable |
| A7 | 清理 `processors/knowledge.ts` 3 个 `void xxx` 未用 import 抑制 | 1 文件 | thinkable |
| A8 | **Bug**：合并 BudgetManager 双分配（thinkloop.ts:293 + pipeline.ts:58） | thinkloop.ts、pipeline.ts、~1 test | thinkable |
| A9 | **Bug**：消除 `(thread as any).intentCache` 3 处 cast（字段已正确声明） | 3 文件 | thinkable |
| A10 | **Bug**：`STONE_OBJECTS_SUBDIR` 常量统一替换 10+ 处硬编码 `"objects"` 字符串 | ~10 文件（persistable + runtime + programmable 预演） | persistable |
| A11 | **Bug**：检查 XmlRenderer 双 `readReadable` 问题并修复 | 1 文件 | thinkable |

### 批次 B：builtins 重复代码抽取 + 命名统一（≤ 2 天）

| # | 行动 | 影响文件 | 子方案 |
|---|------|---------|--------|
| B1 | 新建 `builtins/_shared/executable/guidance.ts`，抽取 `guidanceWindows()` + `makeBasicFormHandler()`，替换 19+38 处重复 | +1 文件，改 15+ builtins 源文件 | builtins |
| B2 | 新建 `builtins/_shared/executable/utils.ts`，抽取 `isString` / `basenameOfPath` / `emptyIntent = () => []`，替换 40+ 处重复 | +1 文件，改 10+ 文件 | builtins |
| B3 | 新建 `builtins/_shared/executable/delegator.ts`，抽取 `makeRootDelegator()`，替换 10 处 root thin delegator | +1 文件，改 10 个 root/executable/method.*.ts | builtins |
| B4 | 新建 `builtins/_shared/executable/viewport-adapter.ts`，合并 `history-viewport.ts` + `results-viewport.ts` | +1 文件，改 2 文件 | builtins |
| B5 | `root/executable/command.*.ts` → `method.*.ts`（13 文件） | 13 文件改名 + import 更新 | builtins |
| B6 | `search/executable/command.set-results-window.ts` → `method.set-results-window.ts` | 1 文件 | builtins |
| B7 | `extendable/_shared/command-types.ts` → `method-types.ts`（23 处 import 更新） | 1 文件改名 + ~23 import | executable + builtins |

### 批次 C：中立共享类型包 `_shared/types/` 建立（2-3 天，最大单项）

| # | 行动 | 子方案 |
|---|------|--------|
| C1 | 新建 `packages/@ooc/core/_shared/` 包骨架（package.json + index） | shared-types |
| C2 | 迁出 `ContextWindow` 家族类型（含 `BaseContextWindow`、所有子类型、`ObjectType`、常量、viewport 纯函数、transcript-viewport 纯函数） | shared-types + executable + thinkable |
| C3 | 迁出 `ObjectMethod` / `MethodExecutionContext` / `MethodKnowledgeEntries` / `MethodOutcome` | shared-types + executable + builtins |
| C4 | 迁出 `ObjectDefinition` / `ObjectRegistry` 接口（实现留 runtime/object-registry.ts） | shared-types + executable + thinkable |
| C5 | 迁出 `ThreadContext` / `ProcessEvent` / `ThreadMessage` | shared-types + executable + thinkable + runtime |
| C6 | 迁出 `Intent` / `FormChangeEvent` / `IntentCache` / `MethodCallSchema` / `MethodArgSpec` | shared-types + executable + thinkable + builtins |
| C7 | 迁出 `XmlNode` / `xmlElement` / `xmlText` / `escapeXml` / `serializeXml` | shared-types + executable + thinkable + builtins |
| C8 | 迁出 `KnowledgeFrontmatter` / `KnowledgeDoc` / `ActivatesOn` / `ActivationLevel` | shared-types + thinkable |
| C9 | 更新所有 barrel re-export（保持对外兼容的 re-export） | 所有模块 |
| C10 | 全量 `bun tsc --noEmit` 验证 + `bun test` | 所有模块 |

### 批次 D：executable/ 内部清理 + 命名（≤ 1 天）

| # | 行动 | 子方案 |
|---|------|--------|
| D1 | `executable/server/` → `executable/object/`（5 文件），同步 `window-types.ts` → `object-types.ts`、`ObjectWindowDefinition` → `StoneObjectDeclaration` | executable |
| D2 | `form.command` 字段 → `form.method`（26 处引用 + thread-json backward-compat 层） | executable + persistable + thinkable + builtins |
| D3 | 删除 `StonesPathClass` / `classifyStonesPath`（迁移到 packages 命名） | executable |
| D4 | `enrichProgramFormMethod` → `enrichMethodExecForm` 或直接删除（只是 thinkable 一行透传） | executable |
| D5 | `openMethodExec` 更名评估（`dispatchMethodCall` 或保持现状，看调用方） | executable |
| D6 | 统一 logger：executable/thinkable 中 15+ 处 `console.*` → observable 注入的 logger，debug 开关联动 | executable + thinkable + observable |

### 批次 E：persistable 瘦身 + 子模块建立（1-2 天）

| # | 行动 | 子方案 |
|---|------|--------|
| E1 | 新建 `packages/@ooc/core/programmable/`（从 persistable 迁出）：`stone-versioning.ts`、`stone-git.ts`、`stone-bootstrap.ts`、`versioned-write.ts` | persistable + programmable(new) |
| E2 | `mention.ts` → `_shared/utils/mention.ts` | persistable + shared-types |
| E3 | CSV parser → `_shared/utils/csv.ts`，`csv-pool.ts` 只留 IO wrapper | persistable + shared-types |
| E4 | `thread-json.ts` 拆分：IO 部分留在 persistable/thread-io/；135 行 context 重建逻辑 → thinkable/context/ 或 executable/windows/ | persistable + thinkable |
| E5 | 删除 `command_exec → method_exec` / `status: executed → failed` 等过期 backward-compat（若测试数据已更新） | persistable |
| E6 | 删除 deprecated path fallback（`_deprecatedPackageDir`、visible→client 等双读，评论已有过期日期） | persistable |

### 批次 F：observable 并入 runtime + app/server 清理（≤ 1 天）

| # | 行动 | 子方案 |
|---|------|--------|
| F1 | `observable/` 合并进 `runtime/`（observable-store.ts 已是 canonical source，observable/index.ts 只剩 thin wrapper），删除重复的 `beginLlmLoop`/`finishLlmLoop` 实现 | observable + runtime |
| F2 | `app/server/runtime/` → `app/server/scheduler/`；`app/server/modules/runtime/` → `app/server/modules/debug/`（解决命名冲突） | app/server |
| F3 | 补齐 `app/server/modules/pools/` + `flows/`（被 index.ts import 但目录不存在） | app/server |
| F4 | `ui/api.list-window-types.ts` 逻辑下沉到 executable registry 层（70+ 行 extractBasicDescription 不该在 HTTP 层），UI API 只做 HTTP 暴露 | app/server + executable |
| F5 | `thread-transition.ts` + `resume.ts` 逻辑评估是否迁到 thinkable/recovery | app/server + thinkable |
| F6 | pause 两套抽象合并（`runtime/pause-store.ts` + observable pause checker） | runtime + observable |
| F7 | bootstrap/ 下 5 个 migration 脚本的深层 `../` import 清理（尤其 check-state-context-split.ts 跨 6 层 import 到 scripts/） | app/server |

### 批次 G：thinkable 内部整理（≤ 1 天）

| # | 行动 | 子方案 |
|---|------|--------|
| G1 | 拆分 `context/index.ts`（746 行）：`ProcessEvent`、`ThreadContext` 去 _shared（批次 C 已覆盖）；`processEventToItems` 650 行拆到 `context/process-events.ts` | thinkable |
| G2 | `thinkloop.ts` 529 行中 permission/tool dispatch loop（115 行）拆成独立函数 | thinkable |
| G3 | `estimateWindowsTokens` 与 BudgetManager token 估算去重 | thinkable |
| G4 | `XmlRenderer` 中 `filterMessagesForDoWindow` / `filterMessagesForTalkWindow` 通过 registry 抽象而非直接 import window 子模块 | thinkable + executable |

---

## 5. 验收标准

每批次完成后必须过：

1. `bun tsc --noEmit` 全项目 0 errors（除预先存在的 web 3 个错误）
2. 该批次涉及的模块 `bun test` 全绿
3. `git diff` 只含该批次声明的文件范围
4. 每个重命名/删除都在对应子方案文档中留有记录

---

## 6. 相关文档

- `meta/object.doc.ts` — 8 维度概念权威
- `docs/plans/2026-06-03-001-refactor-deprecated-code-cleanup-plan.md` — phase 1 计划（已完成）
- `docs/refactor_0604/*.md` — 各模块子方案
