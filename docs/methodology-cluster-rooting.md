# Cluster Rooting — 把分散 Issue 收敛到根因层的方法论

> **类别**：OOC 工程组织方法论 / 设计实践
>
> **起源**：2026-05-24 体验官 6 轮累计 49 Issue + 17 反馈，Supervisor × user 一轮设计对话后
> 收敛到 3 条契约 + 10 根因；10 commits 全部落地后 0 Regression、代码量净减少。
>
> **触发条件**：当 backlog Issue 数 ≥ ~30，且发现多处 facet 同根（如 R2 #6 / R3 #11 / R6 #39 / R6 #43 都是
> 前后端路径契约缺失），单点修补会增加复杂度而非降低——此时启动 cluster rooting。

---

## 0. 哲学动机

OOC 哲学是"用更少的抽象，而非更多的特殊逻辑"。Cluster rooting 是这条哲学的具体执行方法：

**反模式**：每个 Issue 加一个特殊处理。N 个 Issue → N 个补丁 → 系统熵增 → 下次出 Issue N+1 时
原有补丁已经无法维护，要么重写要么再加补丁，恶性循环。

**正模式**：N 个 Issue 收敛到 K 个根因（K << N），每个根因用一次性"收紧契约 / 删特殊路径"
修复，代码量净减少。

**核心信念**：散落的 N 个 Issue 背后通常只有 K=√N 个根因。如果实际 K 接近 N，说明系统本身
已经设计良好，只是有些孤立 bug；这种场景下不必走 cluster rooting，直接修即可。

---

## 1. 触发条件

启动 cluster rooting 的信号（满足任一即可）：

1. **同根 facet 反复出现**：≥ 3 个 Issue 描述不同但根因相同（如本次 F11：R2 #6 + R3 #11 + R6 #39 + R6 #43
   4 处都是"前后端路径契约缺失"的不同 facet）
2. **backlog 数过大单点修不可行**：≥ 30 Issue，逐个 commit 修需要 > N 周
3. **下轮体验官即将复测**：如果不收敛，复测会发现一堆"上次没修的"，浪费 LLM credit
4. **架构级反馈出现**：体验官给出 Part 4 反向 design 反馈，说明有顶层张力（不是细节 bug）

**不要**在以下场景启动：
- backlog < 10 且都是孤立 bug
- 用户明确要求"先修这 3 个 Issue 就好，不要重构"
- 系统正在 active development，每天都有新 commit（cluster rooting 需要短期 freeze）

---

## 2. 步骤（本次 49→10 实际走法）

### 步骤 1：通读全部 Issue + 反向反馈（1-2 小时）

- 把所有 Issue 一字排开（本次：体验官 7 轮报告 + audit trail）
- 每个 Issue 记录：**严重度 / 维度 / 一句话症状**
- 反向 design 反馈分开看（它们已经是高层归纳，省去 cluster 阶段的部分工作）

**产出**：一张 backlog 表，含所有 Issue 名 + 严重度 + 维度

### 步骤 2：找同源 facet（核心步骤，2-3 小时）

- **群组同症状**：用维度（thinkable/executable/...）分类是粗糙的；用"症状结构"分类才有效
- **典型同源信号**：
  - 多个 Issue 描述同一类失败（如"X 应当出现但没出现"）→ visibility 类同源
  - 多个 Issue 涉及同一个文件 / 同一个函数 → 实现层同源
  - 多个 Issue 都跨越了某条边界（如 frontend ↔ backend / persistable ↔ executable）→ 契约层同源

- **本次例子**：
  - **R2 #6 + R3 #11 + R6 #39 + R6 #43** 都涉及 "frontend 在不同地方假设了 backend 的存储路径形态" → 同源契约：前后端路径契约缺失（F11）
  - **R4 #19 + R4 #23** 都涉及"子 thread 想把结果带给父 thread 但通道不可发现/被吞" → 同源协议：dogfooding 子→父通道
  - **R5 #28 + R5 #34** 都涉及"persistable 层 R12 校验/错误处理不严" → 同源契约：persistable 防御深度

**产出**：facet 群组列表（每个群组含 N≥2 个 Issue + 一句话同源描述）

### 步骤 3：升维到契约层（关键步骤，1-2 小时）

把 facet 群组再向上抽象一级，找到"为什么这些 facet 全部都出"。

本次升维结果（3 条契约）：

| 契约 | 现实表现 |
|---|---|
| **契约 1：接口契约 explicit** | render 不强制 window 自带 renderXml；前端假设 backend 路径；HTTP 绕开 versioning；sediment 写入无 schema | "约定但不强制" → 实现者会漏 / 新增者会漏 |
| **契约 2：失败 explicit 由 source 报告** | 5+ 处 bare catch{}；open_knowledge 依赖 render 报错；onError 不全覆盖 | "失败被吞" → LLM/用户看不到，无法自修复 |
| **契约 3：状态翻转有唯一 owner** | worker 周期扫 + 事件驱动并存；HTTP + versioning 两路写 stone | "兜底路径" → 状态冲突 + 双写竞争 |

**3 条契约都用同一句话总结**："系统在某处放弃了 explicit 化，依赖约定/兜底/隐式行为"。

**产出**：3-5 条契约 + 每条契约的"现实表现"列表

### 步骤 4：写简化设计（每个根因 < 30 分钟）

每个 cluster 一个根因；每个根因的设计文档结构：

```markdown
### 根因 #N — <一句话名>

**涉及 Issue**：R_x #y / R_z #w（列举）

**根因分析**：
- 实现层在哪里破了契约？
- 为什么会破？

**简化设计**（契约 X：<契约名>）：
- 1-3 步具体改动
- 强调"删了什么"（不是"加了什么"）

**反熵措施**：
- 不引入新抽象 N（如 "renderer factory"）
- 不引入新 hook（已有 hook 就够）
- 删除现有 K 行代码

**写入 meta**：persistable.X / programmable.Y / ...
```

### 步骤 5：写 Master Fix Plan 文档

整个 cluster rooting 过程的产出是一份 `docs/<date>-fix-plan.md`：

- 顶层设计哲学（3-5 条契约）
- N 个根因（按严重性排序）
- 每个根因：涉及 Issue + 设计 + 实施步骤
- 实施顺序与派单计划
- 设计哲学总结

**本次：`docs/2026-05-24-fix-plan.md`**（283 行）。

### 步骤 6：实施 + verification probe

每个根因独立 commit，按严重性顺序实施。**关键**：每个根因必须附 verification probe（≥ 1 行可机器执行）。

本次教训：R7-1（createIssue mentions 未对称校验）就是因为 acceptance criteria 是自然语言、没 probe，
sub agent 只动了 appendComment 漏了 createIssue。

probe 格式见 `docs/2026-05-24-fix-plan.md` 末尾附录（A4 落地）。

---

## 3. 反熵手势（在每个根因上反复用）

- **删 switch case** → 接口 dispatch（如根因 #4：render.ts 692→255 行）
- **删 fs 周期扫** → 事件驱动 enqueue（如根因 #5：worker 10 jobs/s → 0）
- **删前端路径拼接** → backend dir 字段权威（如根因 #3：前端硬编码全删）
- **删 HTTP 直写路径** → 统一走底层抽象（如根因 #2：HTTP 必经 stone-versioning）
- **删 bare catch{}** → 失败 explicit 报告（如根因 #6：silent-swallow ban）
- **删 path-prefix 启发式** → 元数据探针（如根因 #3：markerFor fs.access）

**共同模式**：用更少代码、更严契约、更小 API surface 替代原有"约定/兜底/启发式"实现。

---

## 4. 风险与边界

### 风险 1：升维太早

- 现象：N 很小（< 20）就强行群组，找出的"根因"其实是 1 个 Issue 加了 attribution
- 后果：root cause 修复时间 > N 个独立 fix
- 防御：步骤 2 群组时强制每个群组 ≥ 2 个独立 Issue；< 2 的留作独立 fix

### 风险 2：升维太晚

- 现象：backlog 累积到 N > 100，cluster rooting 工作量也接近不可控
- 后果：根因依然有，但 cluster rooting 本身变成项目，需要分阶段
- 防御：体验官每 3 轮强制做一次 backlog 收敛（cluster rooting lite）

### 风险 3：群组维度错（粗 → 细）

- 现象：按维度（thinkable / executable）群组，发现群内 Issue 没有同源
- 后果：cluster 没收敛
- 防御：必须按**症状结构**群组，不是按代码层维度

### 风险 4：契约太抽象（细 → 粗）

- 现象：契约只有"系统应该 better"这种废话级抽象
- 后果：契约不可执行，根因没有可落地的设计
- 防御：契约必须能写成接口约束 / 启动期校验 / lint rule（即可机器验证）

### 风险 5：复制了原 backlog 没真简化

- 现象：N=49 Issue → K=49 个 sub agent fix → 还是补丁堆
- 后果：cluster rooting 流于形式
- 防御：步骤 4 写设计时，强制问"删了什么"。如果只有"加了什么"，没真简化。

---

## 5. 与 OOC 哲学的对应

| OOC 哲学 | Cluster rooting 中的对应 |
|---|---|
| 用更少的抽象 | 步骤 3 升维到契约后，简化设计要"删 case" 不是 "加 dispatch factory" |
| visibility-first | 步骤 6 verification probe 是 "fix 的可见性" 的实现 |
| Object 自治 | 每个根因 fix 应让某层 Object（如 persistable）自治更强（如根因 #7 R12 enforce） |
| 三分语义（stone/pool/flow） | 群组时三分边界天然让 facet 归位（如 R2 #6 + R3 #11 都跨 frontend ↔ backend 边界） |

---

## 6. 复用与启动

下次启动 cluster rooting 时：

1. 读体验官累计报告 + 本文档 → 1 小时
2. 步骤 1-3（通读 / 群组 / 升维）→ 半天
3. 步骤 4（写设计）→ 半天
4. 步骤 5（master fix plan doc）→ 半天
5. 步骤 6（实施 + probe）→ 取决于根因数量，本次 10 根因 ~2 天

**预期收益**：每次 cluster rooting 后代码量净减少 5-15%，bug 密度下降 50%+。

---

## 7. 不要做什么

- **不要**让 sub agent 自己做 cluster rooting——这是 Supervisor 哲学层工作，sub agent 擅长执行不擅长升维
- **不要**在 cluster rooting 中途接入新 Issue——会让升维过程被新数据干扰；让新 Issue 进下一轮
- **不要**让 cluster rooting 变成"重构 sprint"——它是治理动作，不是新功能开发
- **不要**省略 verification probe——R7-1 教训说明 acceptance 不可机器检查就会漏

---

## 8. 历史

- **2026-05-24**：OOC 第一次系统性 cluster rooting；49 Issue → 3 契约 + 10 根因 → 10 commits → 0 Regression
- **下次启动条件**：体验官 backlog 累积到 ≥ 30 Issue 且发现 ≥ 3 处同源 facet
