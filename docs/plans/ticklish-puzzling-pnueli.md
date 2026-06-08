# 因子生成 Agent skills 重构计划

## Context

### 为什么要做这次重构

飞书文档 [《智能因子生成 Agent --- AI建议》](https://bytedance.larkoffice.com/wiki/UgN4wyPEriaZPXkRwqXcHfIbn1d) 对当前因子生成 Agent 的核心评价是：

> 当前 AI 机器人不是"智能因子生成 Agent"，更像是一个**流程触发器 + 文档生成器 + 被动问答机器人**。

把这条结论翻译到 `.agents/skills/` 现状，可以定位到 6 个具体短板（每条都对应到现有 skill 的某段提示词）：

| # | 短板 | 现有问题位置 |
|---|------|------|
| 1 | 输出"问题列表"，不输出"推进动作" | `sentry-factor-dev-requirement-analysis` 仅给 PASS/REJECT，无候选方案/推荐/确认人/超时策略 |
| 2 | "继续"语义不明确，用户不知道在批准什么 | `how-to-handle-factor-dev-requirement` 各阶段确认步骤都是模糊"是否继续" |
| 3 | 接口调研沉淀不到技术方案 | `sentry-factor-dev-requirement-plan-design` 单一方案、无数据链路图、无候选对比 |
| 4 | 默认值粒度过粗（"null 或 0"） | `sentry-factor-dev-requirement-analysis` 第 4 题、`sentry-factor-dev-event-factor` 默认值章节 |
| 5 | 存量检查只判定相似度，不做"可复用 vs 不可复用 vs 推荐方案" | `sentry-factor-requirement-quality-check` 第 2.2/2.3 节、`how-to-handle-factor-dev-requirement` 阶段 2 |
| 6 | 没有固定状态块 / 没有按角色路由问题 | 所有面向用户的输出都是散文 |

### 重构边界（已与用户确认）

- 只做 **skill 提示词级别**的重构，不改 sub-agent 框架，不引入新 skill 文件、不引入 owners.yaml。
- 技术方案章节必须升级为 **方案 A/B/C/D + 推荐 + 短中长期路线 + 数据链路图**（允许只有一套方案的简单需求降级为 A 一套，但必须显式声明"已评估其他方案为何不采纳"）。
- 决策路由层暂不做姓名级 routing，仅在 SKILL 提示词中要求 Agent 按"业务 Owner / 数据 Owner / 因子 Owner"三种角色分组提问。

### 预期产出

- 现有 skills 的 SKILL.md 在被 sub-agent 调用时，强制 Agent 用"主动推进者"语气输出（结论 → 阻塞矩阵 → 推荐方案 → 按角色确认 → 可并行任务）。
- 用户面前的每次回复都能在第一屏看到：当前阶段、卡点、谁要处理、推荐怎么处理。

---

## 改动清单

下面 6 个文件是这次重构的全部写入点。其他 skill（`sentry-api-*`、`sentry-factor-dev-go-factorgroup` 等）不动。

### 1. `.agents/skills/how-to-handle-factor-dev-requirement/SKILL.md`（入口，重写）

**改造重点：**

1. 在 `## 执行规则` 顶部新增 **「输出协议（强制）」** 章节，规定 Agent **每次面向用户的发言**都必须含三段：
   - `【当前状态】` ：阶段 / 任务状态（推进中 / 阻塞中 / 等待确认）/ 阻塞等级 / 当前卡点 / 当前需要确认人（按角色）/ 预计下一步
   - `【已完成】` + `【推荐下一步】`：把"我做了什么 → 我建议你做什么"分开
   - `【可并行任务】`：即使存在 P0 阻塞，也要列出哪些任务我会继续推进（草案、测试样例等）
2. 在 `## 推荐状态枚举` 新增两个状态：
   - `awaiting_decision` —— 用户需要在 A/B/C/D 之间选择（区别于 `awaiting_*_confirmation` 的"确认/调整"二选一）
   - `auto_continuing` —— 在 P0 待确认的同时，并行执行的可自动推进任务
3. 把 `阶段 3 / 阶段 4 / 阶段 5` 的「确认」步骤改造为 **决策卡片**：每次必须给用户 A/B/C/D（必带推荐项）；不允许出现"是否继续？"这种空确认。
4. 在 `## 核心工作流` 顶部加入 **「阻塞矩阵」** 概念：所有发现的问题在 SKILL 内部分类为
   - `BIZ_DEFINITION`（业务口径，必须 @ 业务 Owner）
   - `DATA_LINEAGE`（数据链路可达性，必须 @ 数据 Owner）
   - `AGGREGATION_RULE`（聚合规则，必须 @ 业务 Owner）
   - `INTERFACE_CONTRACT`（接口契约，由 Agent 自动调研）
   - `DEFAULT_VALUE`（结构化默认值，必须 @ 因子 Owner）
   - `VALIDATION`（验证用例，可后置）

   并要求 Agent 每次输出结论时按矩阵分组列出，而不是混成一个清单。
5. `## 示例对话` 全部用新协议改写一遍（结论 + 状态块 + 阻塞矩阵 + 决策卡片 + 可并行任务）。
6. 引用 `how-to-chat-with-user` 中将新增的 `state_block` 和 `decision_card` UI 标记。

### 2. `.agents/skills/sentry-factor-dev-requirement-analysis/SKILL.md`（重写输出格式）

**改造重点：**

1. 在 `## 输出规则（强制）` 新增 **「不确定性分级」** 子章节。每个 REJECT 必须落到下面四档之一（参考 Wiki 第三章「不确定性建模」）：
   - `MUST_HUMAN_CONFIRM`：必须人工确认
   - `AGENT_AUTO_RESEARCH`：可由 Agent 自动调研（query-psm-by-requirement / sentry-api-* 等）
   - `RECOMMEND_DEFAULT`：可采用 Agent 推荐的默认值，等用户一句"确认"即落
   - `POST_VALIDATE`：可在代码生成后用测试样本验证

2. 在原有 `## 输出格式（严格）` 中：
   - 把 `## 待确认清单` 整体替换为 `## 阻塞矩阵`，按 Wiki 推荐的六类（同入口 1.4）分组
   - 每条阻塞必须给出固定五字段：
     - 问题（一句话）
     - 推荐方案（带"为什么推荐这个"）
     - 候选方案（A/B/C…）
     - 确认人（业务 Owner / 数据 Owner / 因子 Owner，三选一）
     - 超时策略（若用户 X 小时未确认，按推荐方案推进）
3. 第 4 题（默认值）改造为 **结构化默认值**：禁止只回答 `null` 或 `0`，必须返回
   ```json
   {"value": null, "status": "<错误码枚举>", "reason": "<人类可读原因>"}
   ```
   并给出至少 3 类失败状态枚举建议（`DATA_NOT_FOUND` / `INTERFACE_ERROR` / `AGGREGATION_RULE_MISSING`）。
4. 第 6 题（验证）：把"用户人工验证"改为必须给出至少 4 类样本（正常 / 数据不存在 / 多对多 / 边界值）的样本表骨架，由 Agent 主动生成。
5. `### 减少无效追问` 章节保留，但加上一条：**禁止把"模糊问题"直接抛给用户**——遇到模糊问题应先用 `query-psm-by-requirement` / `sentry-api-factor-group-search` 自动调研，调研无果再追问。

### 3. `.agents/skills/sentry-factor-dev-requirement-plan-design/SKILL.md`（核心重写）

**改造重点：**

1. 在 `## 技术方案章节结构` 顶部加 **「输出原则」**：
   - 所有需求必须先生成「数据链路图」 → 再生成「方案候选集」 → 再选「推荐方案」
   - 简单需求允许只产 1 套方案，但必须显式声明"已评估替代方案 X / Y 为何不采纳"
2. 在原 `第 1 章：方案概述` 之前新增 **`第 0 章：数据链路图`**：
   - 用 ASCII 或 mermaid 画出 输入实体 → 中间实体 → 接口/表 → 输出字段 的链路
   - 每条边标注「可达 / 待确认 / 不可达」
   - 不可达边必须出现在 `阻塞矩阵`
3. 把 `第 1 章：方案概述` 改成 **「候选方案对比表」**，固定列：
   - 方案名 | 实现思路（一段话） | 实时性 | 上线风险 | 复用度 | 适用场景 | 是否推荐
   - 至少给出 2~4 个候选方向（短期复用 / 中期实时 / 长期离线预计算）；当只有 1 个时必须解释"为何无替代"
4. `第 5 章：系统详细设计` 只针对 **推荐方案** 展开（避免文档膨胀）；非推荐方案在第 1 章简要描述即可
5. 新增 `第 7 章：路线图` —— 短期 / 中期 / 长期三段式（短期=本次交付，中期=下一迭代，长期=资产沉淀）
6. 新增 `第 8 章：默认值与状态码契约` —— 强制结构化默认值 `{value, status, reason}`，并列出 status 枚举值与下游消费端的语义约定

### 4. `.agents/skills/sentry-factor-requirement-quality-check/SKILL.md`（升级存量检查）

**改造重点：**

1. 把 `### 阶段 2: 存量检查` 改造为 **「可复用评估」**，必须输出三段：
   - **可复用部分**（清单 + 引用 factor_group_id / event_factor_code）
   - **不可复用部分**（说明为何不能直接拿来用：input 不匹配 / output 缺字段 / 时间窗不一致 / etc.）
   - **推荐复用方案**（怎么把可复用部分拼到当前需求上）
2. 在 `## 输出格式` 顶部新增固定状态块 `【当前状态】`（与入口 SKILL 的协议对齐），让质检结果可以直接被前端渲染为状态卡片。
3. 把 `### [P0] 必须修复` 列表升级为 **「阻塞矩阵」**（六分类，与入口 SKILL 一致），并保留 P0 / P1 优先级；每条 P0 都必须带推荐解法 + 确认角色。

### 5. `.agents/skills/how-to-chat-with-user/SKILL.md`（扩 UI 标记）

**改造重点：**

1. 新增三种 UI 组件标记，前端按需渲染：
   - `state_block` —— 用于固定状态块（阶段 / 任务状态 / 阻塞等级 / 卡点 / 确认人）
   - `decision_card` —— 用于决策卡片（A/B/C/D 选项 + 推荐项）
   - `blocker_matrix` —— 用于阻塞矩阵（按六分类分组、含推荐方案 + 确认角色）
2. 在 `## 交互要求` 新增"角色@提问规范"：当 Agent 需要人确认时，应该按以下角色分组：
   - `@业务 Owner`：BIZ_DEFINITION / AGGREGATION_RULE 类问题
   - `@数据 Owner`：DATA_LINEAGE 类问题
   - `@因子 Owner`：DEFAULT_VALUE / 复用评估类问题

   不要求绑定具体姓名（按用户决定，先按角色分组提问）。

### 6. `meta.md`（同步索引说明）

- 在 `# Skill 索引表` 下方新增一段「Agent 输出协议」说明，引用入口 SKILL 的「输出协议」章节路径
- 在 `# 设计路线图` 下方新增一段「重构变更日志：Agent 主动推进协议（YYYY-MM-DD）」，列出本次改了哪 6 个文件、改了什么核心点

---

## 关键文件路径

| 文件 | 角色 |
|---|---|
| `/Users/bytedance/x/go/plugins_with_agent/.agents/skills/how-to-handle-factor-dev-requirement/SKILL.md` | 主入口、输出协议总规约 |
| `/Users/bytedance/x/go/plugins_with_agent/.agents/skills/sentry-factor-dev-requirement-analysis/SKILL.md` | 不确定性分级、阻塞矩阵、结构化默认值 |
| `/Users/bytedance/x/go/plugins_with_agent/.agents/skills/sentry-factor-dev-requirement-plan-design/SKILL.md` | 数据链路图、候选方案对比、路线图、默认值契约 |
| `/Users/bytedance/x/go/plugins_with_agent/.agents/skills/sentry-factor-requirement-quality-check/SKILL.md` | 可复用评估、固定状态块 |
| `/Users/bytedance/x/go/plugins_with_agent/.agents/skills/how-to-chat-with-user/SKILL.md` | UI 标记扩展（状态块 / 决策卡片 / 阻塞矩阵） |
| `/Users/bytedance/x/go/plugins_with_agent/meta.md` | 索引同步、变更日志 |

---

## 验证方式

skill 是提示词，没有可执行测试。验证手段：

1. **静态校验**：用 `grep` 检查每份 SKILL 是否都包含「输出协议」「阻塞矩阵」「决策卡片」三个关键词；入口 SKILL 是否引用了 `state_block` / `decision_card` / `blocker_matrix`；plan-design 是否包含「数据链路图」「候选方案」「路线图」「默认值契约」。
2. **示例自校**：每份改造后 SKILL 的「示例对话」段落必须用新协议重写一遍，肉眼检查 A/B/C/D 是否齐全、是否有推荐项、是否按角色分组。
3. **流程联演（人工）**：拿一个真实需求（例如 `docs/feature/all/` 里已有的样例）走一遍：
   - Agent 第一屏是否包含状态块 + 卡点 + 推荐方案 + 谁来处理；
   - 「继续」是否被替换为决策卡片；
   - 技术方案是否同时给出至少一个数据链路图 + 候选方案对比表 + 路线图。
4. **回归对比**：本次改造完成后，用同一个需求与 `git stash` 前的 SKILL.md 各跑一遍 sub-agent，对比输出是否更"主动推进"。

---

## 不在本次范围

- 不新增任何 skill 文件 / 子目录 / 脚本（用户已确认不引入新文件）
- 不实现 Owner 姓名级路由，不做 owners.yaml
- 不改造 `sentry-factor-dev-event-factor` / `sentry-factor-dev-go-factorgroup` / `sentry-factor-dev-offline-factorgroup` 这三份开发规范 skill 的核心内容（只在它们引用默认值、验证样本时让 plan-design 的契约自然生效，不直接动它们）
- 不改 `output/requirement_form.json` / `output/requirement.json` 的 schema（新状态枚举是值变化，不是 schema 变化）
- 不实现 FactorRunState 任务记忆 JSON
