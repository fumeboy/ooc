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

## 已执行偏离汇总
- **D6（logger 统一）** → 推迟到批次 F：依赖 F1（observable 并入 runtime）后才有 runtime 统一 logger API。
- **D5（openMethodExec 更名）** → 跳过：计划自身建议"先保持现状"。
- **D7（WindowManager 1160 行拆分）/ D8（删 relation/）** → 跳过/暂缓：可选增强项，非结构必需。
