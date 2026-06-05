# 重构执行期决策记录（Supervisor）

> 计划是指引而非契约。以下为执行 `docs/refactor_0604/*` 期间，Supervisor 基于
> "代码质量 / 控制复杂度 / 避免中途变更太多" 做出的偏离/排序裁决，附理由，供追溯。

## DD1 — D2（`MethodExecWindow.command` → `.method` 字段重命名）推迟

**裁决（2026-06-05）**：暂不执行，推迟到主干重构（D 剩项 / E / F / G）稳定且 harness 验证就绪后单独处理。

**理由：**
1. **不是孤立字段，而是术语簇**：`command` 与 `commandPaths` / `commandKnowledgePaths` / `openCommandExec` 同处一个 interface 与调用链。只改 `command` 留下 `commandPaths`，比现状（全 `command`）更不一致——属于劣化。要做就得全簇迁移。
2. **全簇迁移 = 持久化数据迁移**：`MethodExecWindow` 随 `thread.contextWindows` 序列化进 `thread.json`，旧 session 存有 `"command"` 字段。重命名须在 `persistable/thread-json.ts` 加读迁移层（旧 `command` → 新 `method`）。这类迁移的正确性 **tsc 测不出**，只有跑真实旧 session 才暴露——当前 harness 未就绪，无法即时验证。
3. **零行为价值**：纯术语对齐，不改任何运行时行为。
4. **与 goal 直接冲突**：goal 明确要求"控制复杂度、避免中途变更太多、不被测试/迁移工作拖慢偏离方向"。在主干未稳、测试未修时引入一个 58+ 引用、需运行时验证的持久化迁移，性价比为负。

**复做前提**：D/E/F/G 主干绿 + 测试修复批次完成 + harness 能加载真实旧 session。届时作为独立 commit，全簇（`command`/`commandPaths`/`commandKnowledgePaths`/`openCommandExec`）一次迁移 + thread-json backward-compat read + 专门的迁移单测。

## DD2 — 批次 E 范围裁剪：现在只做 E1，E4/E5/E6 推迟

**裁决（2026-06-05）**：
- **E2/E3** 已由 batch C3 完成（mention/csv 已在 `_shared/utils/`，persistable 侧 re-export）。
- **E1（programmable/ 抽取）现在做**：高价值（落地 README 理想中的第 4 个一级模块）、低风险（外部调用方走 `@ooc/core/persistable` barrel，re-export 即零改动）、tsc 可验。
  - 层级规则：`programmable → persistable`（versioning 建立在 raw IO 之上）允许；`persistable → programmable` 禁止。
  - 解 `pr-issue → stone-bootstrap` 纠葛：把 `STONES_MAIN_BRANCH` / `STONES_BARE_REPO_DIR` 常量移到 `persistable/common.ts`，bootstrap（迁入 programmable）与 pr-issue 都从 persistable 引，无反向依赖。
- **E4（thread-json 拆分）推迟**：E4.1（IO 拆分）单独做不破任何反向 import、纯文件重排无架构收益；真正价值在 E4.2（迁 195 行 rehydrate 逻辑），但那是 session-loading 运行时敏感逻辑，且目标模块（thinkable vs runtime）是需结合反向 import 分析的真设计决策。整体推迟到 harness 就绪后作为一个单元做（可即时验证 session reload）。
- **E5/E6（删过期 backward-compat）推迟**：同 D2——删持久化迁移层只有跑真实旧 session 才能验证安全，放到 harness 阶段。

## DD3 — 整个批次 F 推迟到 harness 运行时阶段

**裁决（2026-06-05）**：批次 F（observable 并入 runtime + app/server 清理）整体推迟，与 D2 / E4 / E5 / E6 合并为 harness 阶段的"运行时敏感 pass"，在真实 OOC World Server 旁逐项做 + 即时验证。

**理由（逐项）：**
- **F1**（observable→runtime 合并）：observable 是 8 维度之一，把其目录并入 runtime 是有概念分量的架构声明；且 `observable/index.ts` 的 module-level 函数被测试 spy 耦合。与 **D6**（logger 统一，本就依赖 F1 的 runtime logger）合成一个"可观测性 pass"。
- **F2**（`app/server/runtime/`→`scheduler/`、`modules/runtime/`→`modules/debug/` 重命名）：被重命名的 `app/server/runtime/` 恰好含 `resume.ts` / `thread-transition.ts`——即 **F5** 要迁走的 session 逻辑。现在改名、harness 阶段再迁 = 双重 churn。F2+F5 一起做。
- **F3**（补 `modules/pools` + `modules/flows`）：`poolsModule`/`flowsModule` 被 index.ts import 但**无任何定义**，是 HTTP 功能缺失（前端 `domains/flows` 仍在用）。恢复需对照前端契约 + 跑真实 server 验证返回值。属 baseline，gate 已排除，非回归。
- **F4**（`ui/api.list-window-types` 逻辑下沉到 executable registry）：跨模块，需 executable 先暴露 `listVisibleWindowTypes()` API；HTTP 行为变化需 live 验证。
- **F5/F6**（resume/thread-transition 迁 thinkable/recovery、pause 两套合并）：session 恢复与 pause 是运行时核心，bug 只在 live 暴露。
- **F7**（`check-state-context-split` 的 6 层 `../` import 到 scripts/）：单个 cosmetic 深 import，且该文件是一次性 state-context-split 迁移检查（P6 已完成），可能可删——并入 harness 阶段的 backward-compat 清理一起判。

**结果**：结构安全 pass（现在）只剩批次 G（thinkable 内部拆分，tsc 可验）。所有 app/server / observable / 持久化迁移类改动集中到 harness 阶段。

## DD4 — 批次 G 裁剪：G2+G4 做，G1 跳过，G3 推迟

**裁决（2026-06-05）**：
- **G1**（拆 context/index.ts）**跳过**：batch C 已把 ProcessEvent/ThreadContext 迁出，index.ts 现 354 行（< 800 上限，符合 coding rule），无需再拆。
- **G2**（thinkloop.ts 533 行抽 ~115 行 permission/tool dispatch loop 成独立函数）**做**：纯文件内提取、行为保留、tsc 可验。
- **G4**（xml.ts 经 registry 抽象消除对 `executable/windows/{do,talk}` 的直接 import）**做**：给 `ObjectDefinition` 加 `consumedMessageIds?(window, thread)` hook，do/talk 注册指向各自 `filterMessagesFor*Window`，xml.ts 改走 registry 派发——破 batch C 残留的最后一处 thinkable→executable 渲染耦合。同一逻辑仅改派发方式，行为保留。
- **G3**（estimateWindowsTokens 与 BudgetManager token 估算去重）**推迟到 harness 阶段**：token 估算直接影响 budget overflow / 压缩决策；两估算器若非逐字等价，合并会改渲染行为。需 live render 验证等价后再合并。

## 已执行偏离汇总
- **D6（logger 统一）** → 推迟到批次 F：依赖 F1（observable 并入 runtime）后才有 runtime 统一 logger API。
- **D5（openMethodExec 更名）** → 跳过：计划自身建议"先保持现状"。
- **D7（WindowManager 1160 行拆分）/ D8（删 relation/）** → 跳过/暂缓：可选增强项，非结构必需。
