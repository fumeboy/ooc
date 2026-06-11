# reflectable 沉淀 = feat-branch PR 流程（目标设计，2026-06-11）

> 用户拍板的 reflectable 目标流程。本文是实现 spec；落地后回流对象树 reflectable/persistable。

## 0. 地基不变量（用户澄清，最高优先）

**`session-<sid>` worktree branch 是纯运行时派生物**：从 `stones/main` 派生，只为取得完整对象配置 + 工作区用于**运行**；**永不合并回 main**，session 归档即弃。

推论（**退役**当前实现）：
- `evolve_self`「合 `session-<sid>` worktree → main」整条退役；`tryMergeSelf` 的 self-scope ff / cross-scope→PR 二元闸（作为「session 合入闸」）退役。
- `create_object` 现注释「end→super flow evolve_self 合入 main」作废：业务 session 新对象天生 ephemeral，本 session 内可用（session-aware 读已修，62871c50），进 main 走下文 feat-branch PR。

**保留复用**：super-alias 路由（`talk(target="super")`→caller 在 super session 的 thread，`worker.ts:274`）；PR-Issue 存储与决议机制（`pr-issue.ts` + `resolvePrIssue` 的 ff-merge/archive，`stone-versioning.ts:499`）——但语义从「session 合入闸」改挂到「feat-branch PR」。

## 1. 目标流程（reflectable 沉淀）

1. **触发**：业务 session 下的 `foo` 想沉淀知识/功能 → 主动 `talk(target="super")`，说明沉淀需求。
2. **路由**：系统派生 `foo` 在 super session 下的 thread = **`super(foo)`**（已有机制）。
3. **选 channel**（super(foo) 决定）：
   - **仅知识/文档** → 可自由选 ① 写 foo 自己的 **pool**（`pools/foo/...`，write-through，**不 PR、不 branch**，立即生效）；或 ② 写 **stone**（versioned）→ 走 PR（同代码路径）。
   - **涉代码 / 任何 stone 变更** → 必须 feat-branch + PR。
4. **编辑 + 发起 merge**（**直接编辑落法，用户拍板 2026-06-11**）：super(foo) 调 `new_feat_branch(intent)` 从 `main` 派生 feat 分支 worktree（落 `stones/<branch>/`，命名见 §决策1）并把分支名绑到本 thread（`thread.persistence.stonesBranch`，随 thread.json 持久化、跨 exec tick 存活）。绑定生效后 super(foo) **用普通 `write_file` / `file_window.edit` 直接编辑** feat worktree 下文件（**不**把文件内容作方法参数传）——`resolveStoneIdentityRef` 在 sessionId 路由最前面优先认 feat 绑定，读写自然落 feat worktree。编辑完调 `evolve_self`（**finalizer，无 edits 参数**）：读绑定 → commit feat worktree（署名 foo）→ 发起 merge 流程 → **创建 PR** → 清除绑定。
5. **程序化 scope 检查 + reviewer 冒泡**：merge 流程检查变更文件范围：
   - 全部落在 `foo` 的对象目录内（`objects/foo/**`，**含 `objects/foo/children/**`**）→ reviewer = {supervisor}。
   - 超出 → **向上冒泡**，匹配与变更范围相适应的对象，相关对象一起参与 review。**supervisor 始终参与。**
   - 每个 reviewer 的 thread 获得一个 **PR context window**，并**激活相关 knowledge**。
6. **审批 + 合入**：所有 reviewer approve 后 → 合入。合入方式由 `.world.json` 配置控制：**自动合入** 或 **用户确认后合入**。
7. **失败回修**：合入失败 → message 给 `super(foo)`，由其修复（repair loop）。

## 2. 待你确认的微决策（我做了默认，标出）

- **决策1 — feat 分支命名/落点**：你写 `stones/<feat-xxx>`。默认实现：git 分支名 `feat/<slug>`（或 `feat-<slug>`），从 `main` 派生；其 worktree 物理落点 `stones/<branch>/`（与 main worktree `stones/main/`、session worktree `flows/<sid>/` 并列）。**slug 由 super(foo) 给的 intent 派生还是显式传？默认 intent 派生。**
- **决策2 — 冒泡 reviewer 集的精确规则**（你说「匹配与变更范围相适应的对象，向上冒泡」，有两种读法）：
  - **(A) 逐路径拥有者**：变更触及的每个 `objects/<Y>/...`，收集其拥有对象 Y（越出 foo 子树的那些）作为 reviewer ∪ {supervisor}。改 Y 的 children → reviewer 是 Y（parent 授权其领地）。
  - **(B) 最近共同祖先**：取包含全部越界变更的最近共同祖先对象 + {supervisor}。
  - **默认取 (A)**（更细、更符合「相关对象一起 review」）；reviewer 是「领地包含变更的最近 parent 对象」。请确认 A/B。
- **决策3 — reviewer 是否含 foo 自己**：foo 是 author，默认 **不**作为 reviewer（避免自审自批；但 foo 改自己子树时 reviewer 仅 {supervisor}，符合「supervisor 始终参与」）。

## 3. 分阶段实现计划

- **P1 地基**：retire session→main 合入语义；`create_object`/evolve 文案与路径更新为「session ephemeral，不合入」；`evolve_self` 改造或新增 `sediment`/`open_pr` 类 super-flow method 的骨架（建 feat 分支、commit、调 PR 创建）。复用 PR-Issue 存储。**TDD。**
- **P2 scope 冒泡 + reviewer 集**：把 `classifyDiffAgainstMain` 的二元判定升级为「计算变更触及对象 → 冒泡出 reviewer 集（决策2）」。产出 PR record 带 reviewer 列表。
- **P3 多 reviewer 审批聚合**：PR record 加 per-reviewer approve 状态；全 approve 才可合入；`resolvePrIssue` 从「单 supervisor 一次 resolve」升级为「按 reviewer 聚合」。
- **P4 PR context window + knowledge 激活**：每个 reviewer thread 注入 PR context window（diff/intent/来源）+ 激活相关 knowledge（补 G2）。补 `GET /api/runtime/pr-issues`(list/get) 可观测端点。
- **P5 `.world.json` 合入闸**：auto-merge vs require-human-confirm 配置；接 human-in-the-loop 确认通道。
- **P6 失败回修 loop**：合入失败 → message 路由回 `super(foo)` thread（复用 talk/inbox 投递），触发其修复续作。

## 4. 与现有 PR-Issue 链路的复用/改动对照

| 环节 | 现状锚点 | 本设计 |
|---|---|---|
| 触发身份 | super-alias `worker.ts:274` | 复用 |
| 分支 | `session-<sid>`（合入单元） | **改**：feat 分支（沉淀单元）；session 分支退出合入 |
| 编辑落法 | （旧设想：evolve_self 吃显式 edits 数组） | **改（拍板 2026-06-11）**：feat 分支**直接编辑**——`new_feat_branch` 开分支 + 绑定 thread（`thread.persistence.stonesBranch`），`resolveStoneIdentityRef` 覆盖优先路由，普通 write_file / file_window.edit 直接落 feat worktree；`evolve_self` 退化为无参 finalizer（commit + PR + 清绑定） |
| scope 判定 | `classifyDiffAgainstMain` 二元 self/cross | **升级**：冒泡算 reviewer 集（P2） |
| PR 存储 | `pr-issue.ts` `flows/super/issues/` | 复用，record 加 reviewers + approvals |
| 决议 | `resolvePrIssue` 单 supervisor merge/reject | **升级**：多 reviewer 聚合 + `.world.json` 闸（P3/P5） |
| 呈现 | 无（G2） | **新增**：PR context window + knowledge 激活 + list/get 端点（P4） |
| 失败 | request-changes 留 open，无 loop | **新增**：message→super(foo) 回修（P6） |
