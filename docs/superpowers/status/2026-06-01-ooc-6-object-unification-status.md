# OOC Object Unification (ooc-6) — Status Report

**日期：** 2026-06-01
**设计文档：** [2026-05-28-ooc-object-unification-design.md](../specs/2026-05-28-ooc-object-unification-design.md)
**实现计划：** [2026-05-28-ooc-object-unification-plan.md](../plans/2026-05-28-ooc-object-unification-plan.md)
**当前分支：** ooc-6
**最新提交：** `bbb191e` feat(ooc-6): Remove windows/&lt;type&gt; shells + update meta + scripts

---

## 1. 任务背景

### 1.1 核心思想

OOC-6 的根本设计变更：**Window = Object in Context**。

ooc-2 及之前：ContextWindow 是独立于 Object 的临时数据结构，存在"window 包装 object"的两层抽象。custom object 需要通过 `customWindowIdOf` 做 id 映射，通过 `custom:` type 前缀做间接包装。

ooc-6 之后：每个 Window **就是**一个 Object。window.id === object.id，WindowType 直接对应 Object 类型，不再有中间层包装。

### 1.2 关键设计变更

| 维度 | ooc-2（旧） | ooc-6（新） |
|------|------------|------------|
| Window / Object 关系 | Window 包装 Object，两层抽象 | Window = Object in Context，一层 |
| WindowType | 封闭联合 + `custom:` 前缀包装 | 开放联合 `"root" \| "do" \| ... \| (string & {})` |
| 用户自定义 object | `customWindowIdOf` + `type="custom"` 间接 | `registerNewObjectType()` 运行时注册，type = object.id |
| 方法目录名 | `server/index.ts` | `executable/index.ts` |
| UI 目录名 | `client/index.tsx` | `visible/index.tsx` |
| 身份文档 | `readme.md` | `readable.md`（向后兼容旧 `readme.md`） |
| builtin 实现位置 | `src/extendable/base/<type>/` | `packages/@ooc/builtins/<type>/` |
| 关系窗口 | `relation` window 类型显式管理 | peer/children 自动注入 ContextObject |

### 1.3 附加约束

升级同时伴随着 **bun monorepo 重构**（独立于 ooc-6 但同步进行），源码从 `src/` 整体搬到 `packages/@ooc/{core,builtins,meta,tests,web}/`。计划文档中仍有 `src/extendable/base/` 等旧路径描述，属于计划文档更新滞后。

---

## 2. 项目状态

### 2.1 已完成阶段（Plan 对照）

| Plan Phase | 状态 | 说明 |
|------------|------|------|
| Phase 0: Meta 文档更新 | ✅ 基本完成 | `meta/object.doc.ts` 共 222 行修订；仅剩 programmable 章节 ~30 处 custom window 概念叙述需改写（见 3.1） |
| Phase 1: 类型系统 & 持久化辅助 | ✅ 完成 | `ObjectMethod` / `ObjectDefinition` 类型扩展、persistence 目录辅助函数、runtime context 辅助函数全部落地 |
| Phase 2: Registry & 方法可见性 | ✅ 完成 | `WindowRegistry` → `ObjectRegistry` 别名、prototype chain 方法查找、方法可见性过滤全部实现 |
| Phase 3: Readable 概念 | ✅ 完成 | `readable.md` 主加载逻辑、`createStoneObject` 默认写 `readable.md`、双读兼容旧 `readme.md` |
| Phase 4: Builtin Objects 迁移 | ✅ 完成 | 9 个 builtin 类型全部迁移到 `packages/@ooc/builtins/<type>/`，实现按 `executable/` / `visible/` / `readable.md` 新结构拆分 |
| Phase 5: Runtime Object Persistence | ⚠️ 部分完成 | P5.1/P5.2（同步写入 context/ 目录 + 双源读取）在当前提交中已有部分落地，但 P5.3/P5.4（停止写入 thread.contextWindows[] + 移除字段）未做。需重新核对。 |
| Phase 6: Relation → Peer/Children 自动注入 | ⚠️ 部分完成 | relation window 已加 deprecated 注释并被 peer Object 自动注入替代，但类型和代码仍保留兼容，未完全移除。 |
| Phase 7: Web UI 迁移 | ❌ 未开始 | `*Diff.tsx` 迁移到 builtins 的 `visible/`、API 路由更新等全部未做。 |
| Phase 8: Knowledge Trigger 迁移 | ❌ 未开始 | 新旧 trigger 格式自动映射、builtin knowledge 更新到新格式、lint 规则全部未做。 |
| Phase 9: Cleanup | ❌ 未开始 | deprecated 函数移除、`thread.contextWindows[]` 字段移除、旧 API 路由 alias 移除、旧 trigger 兼容代码移除、`src/executable/windows/` 目录（剩余部分）移除 全部未做。 |
| Phase 12: Scripts & CI | ✅ 完成 | 3 个 check 脚本（tsc / silent-swallow / deprecated-symbols）全部对齐到 `packages/@ooc/` 新布局，baseline 错误清零。 |

### 2.2 代码层面已落地的关键变更

1. **删除 9 个薄壳目录**（`bbb191e`）：`packages/@ooc/core/executable/windows/` 下的 `{command_exec,file,knowledge,plan,program,search,skill_index,todo,root}/` 共 ~3.3k 行重复代码彻底移除。这些目录之前是纯 re-export 壳子，指向 `@ooc/builtins/<type>/`。
2. **`_shared/types.ts` 引用重定向**（`bbb191e`）：从相对路径 `../<type>/types.js` 改为直接 `@ooc/builtins/<type>/types.js`。
3. **import 路径清理**（`bbb191e`）：5 个测试文件中的 `../windows/<type>/` 相对路径全部改成 `@ooc/builtins/<type>/`。
4. **Meta 文档概念更新**（多轮）：`packages/@ooc/meta/object.doc.ts` 中 extendable/base → builtins、server/ → executable/、client/ → visible/、readme.md → readable.md、custom window → 开放 WindowType + registerNewObjectType 全部替换。
5. **Scripts 对齐**（Phase 12）：3 个 check 脚本扫描范围从 `src/` 改成 `packages/@ooc/`，tsc baseline 清零。
6. **3 个 root 测试搬家**（`bbb191e`）：从 `windows/root/__tests__/` 搬到 `core/executable/__tests__/`，与其他 core executable 测试同目录。

### 2.3 质量状态

- **TypeScript：** `bun tsc --noEmit` 干净通过，无 baseline 错误
- **Check Scripts：** 3 个 check 脚本（tsc / silent-swallow / deprecated-symbols）全部通过
- **Tests：** 139 个核心测试（root 3 个 + windows/__tests__ 98 个 + 其他）全部通过
- **计划文档滞后：** `docs/superpowers/plans/2026-05-28-ooc-object-unification-plan.md` 中仍有 `src/extendable/base/` 等旧路径引用，属于文档更新滞后，代码层面已全部迁移。

---

## 3. 剩余工作

### 3.1 P0 剩余：Meta 文档 programmable 章节概念改写（中优先级）

`packages/@ooc/meta/object.doc.ts` 的 programmable 章节（3300-3700 行附近）仍有 ~30 处 "custom window"、"type=custom dispatcher"、"customWindowIdOf"、"CustomCommandContext" 等旧概念叙述。这些不是过期路径（不会导致 tsc 错误），但叙述的仍是 ooc-2 的两层模型，与 ooc-6 "Window = Object" 设计冲突。

**工作量估计：** 需要改写大段文字，涉及 `type=custom dispatcher` → `registerNewObjectType`、`CustomCommandContext` → 统一 `CommandExecutionContext`、`customWindowIdOf` → 直接 `object.id` 等概念替换。

**风险：** 低风险（纯文档，不影响运行时），但长期留着会误导后续开发者。

### 3.2 P5 剩余：Runtime Object Persistence 完全落地（高优先级）

计划的 P5 是整个设计中影响最大、风险最高的阶段：

1. **P5.1：WindowManager 同步写入 context/ 目录** —— 每个 Object 的 state 以文件形式持久化到 `context/objects/<id>/state.json`
2. **P5.2：buildContext 双源读取** —— 从 `context/objects/` 和 `thread.contextWindows[]` 同时读取，前者优先
3. **P5.3：停止写入 thread.contextWindows[]** —— 所有 state 写入 `context/objects/`，`thread.contextWindows[]` 只作为兼容读取
4. **P5.4：移除 thread.contextWindows[] 字段** —— 过渡期后彻底移除

**当前状态：** P5.1/P5.2 可能已有部分代码落地（需要仔细核对 `buildContext` 和 `WindowManager` 实现），但 P5.3/P5.4 肯定没做。

**工作量估计：** 大。涉及所有持久化路径、所有 window 修改操作、所有 context 构建路径。需要完整的 e2e 测试覆盖。

**风险：** 高。这是 runtime 核心数据结构变更，涉及持久化兼容性。需要设计严格的回滚策略和双写期。

### 3.3 P6 剩余：Relation 完全移除（中优先级）

relation window 类型和代码仍保留，仅加了 deprecated 注释。计划要求完全移除类型和实现，仅保留已持久化 thread 数据的兼容加载。

**工作量估计：** 中。需要修改 `_shared/types.ts` 移除 `RelationWindow`，修改 `registry.ts` 取消注册，修改所有 `import "./relation/index.js"` 的地方。

**风险：** 中。如果还有代码路径通过 relation window 交互而没有走新的 peer 自动注入，会导致功能回归。需要在移除前做全面的 call site 审计。

### 3.4 P7: Web UI 迁移（中优先级）

- P7.1 API 路由更新：`/api/windows/*` → `/api/objects/*`
- P7.2 前端 Hook 更新：`useWindow` → `useObject`
- P7.3 Window Diff Registry 动态加载
- P7.4 逐个迁移 `*Diff.tsx` 到 `packages/@ooc/builtins/<type>/visible/`

**当前状态：** 全部未开始。

**工作量估计：** 大。涉及前端 UI 组件迁移、路由变更、可能需要向后兼容期。

**风险：** 中。前端变更容易有视觉回归，需要 e2e 测试覆盖。

### 3.5 P8: Knowledge Trigger 迁移（低优先级）

- P8.1 新旧格式自动映射
- P8.2 更新 builtin knowledge 到新格式
- P8.3 添加 lint 规则禁止旧格式

**当前状态：** 全部未开始。

**工作量估计：** 小-中。是概念性的清理，不影响功能，主要是 lint 约束。

**风险：** 低。

### 3.6 P9: Final Cleanup（低优先级，必须在所有其他 Phase 完成后）

- P9.1 移除 deprecated 旧函数
- P9.2 移除 `thread.contextWindows[]` 字段（P5.4 没完成前不能做）
- P9.3 移除旧 API 路由 alias（P7 没完成前不能做）
- P9.4 移除旧 trigger 格式兼容代码（P8 没完成前不能做）
- P9.5 移除 `packages/@ooc/core/executable/windows/` 目录（P4/P6/P7 全部完成后，`do/`、`talk/`、`relation/`、`_shared/` 都应不再需要）

**当前状态：** 全部未开始。

**工作量估计：** 中。是收尾工作，但有严格的前置依赖。

**风险：** 低，但顺序错了会出问题。

### 3.7 Plan 文档自身更新（中优先级）

`docs/superpowers/plans/2026-05-28-ooc-object-unification-plan.md` 顶部有一条自注：

> **本设计部分过时**: ooc-6 按照 bun monorepo 的方式进行了重构，重构后，builtin objects 不再放置在 `src/extendable/base/` 目录下，而是放在 ./packages/@ooc/builtins 目录下。

计划文档内大量引用 `src/extendable/base/`、`src/executable/windows/` 等旧路径，也没有反映 "Window = Object" 的最终设计结论。作为执行依据，应该在做 P5 之前把计划文档更新到当前状态。

---

## 4. 优先级建议

按依赖关系和风险排序，推荐的后续推进顺序：

| 顺序 | 任务 | 前置 | 说明 |
|------|------|------|------|
| 1 | **更新 Plan 文档**（3.7） | 无 | 先让计划文档反映真实状态，再推进后续工程 |
| 2 | **P5: Runtime Object Persistence**（3.2） | Plan 文档更新 | 核心架构变更，风险最高，尽早做 |
| 3 | **P7: Web UI 迁移**（3.4） | P5 完成后 | 前端 + API 路由变更，可与 P6 并行 |
| 4 | **P6: Relation 完全移除**（3.3） | P5 完成后 | 可以和 P7 并行 |
| 5 | **P0 Meta programmable 章节改写**（3.1） | 无 | 纯文档，随时可插空做 |
| 6 | **P8: Knowledge Trigger 迁移**（3.5） | 无 | 低优先级，可插空 |
| 7 | **P9: Final Cleanup**（3.6） | P5/P6/P7/P8 全部完成 | 最后一步 |

---

## 5. 回滚与中止条件

当前代码库状态是稳定的：所有 Phase 0-4 + Phase 12 已完成，tsc / tests / check scripts 全绿，已持久化的 thread 数据仍然兼容。

**回滚点：** `ea41b8d`（Object Unification 基础提交）是稳定回滚点。`bbb191e`（当前 HEAD）也是稳定的。

**中止条件：** 如果 P5（Runtime Object Persistence）实现中发现无法解决的持久化数据丢失问题，或性能退化超过 30%，应回滚到 `bbb191e`，保留 Phase 0-4 的成果，重新设计 P5。
