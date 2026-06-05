# Stone/Flow Overlay 与 super-flow 身份合入设计

> 收口 stone 布局三套分叉假设，确立「main 分支 = canonical stone，flow session overlay = 会话内试验层，
> super flow = 身份正式演化（分支→测→合 main）」。
> 来源：harness 首轮 sweep persistable 高严重度发现 + 与用户的设计确认（2026-06-05）。
> 状态：设计定稿，待审 → 分阶段实现。

## 0. 决策记录
- **canonical stone = `stones/main/objects/<id>/`（main git 分支 worktree）**。git 分支设计**保留**（用户拍板）。
- **默认所有 flow session 读 main 分支的 object 定义**（self.md / executable / visible / readable / seed-knowledge）。
- **flow session 内对 self 文件的变更 → plain 目录 overlay**（决策 A，非每 session 一个 git 分支），不动 main；读取时 overlay shadow main。
- **super flow = 身份演化唯一正式通道**：从 main 建实验分支 → 应用 overlay 变更 → 测 → merge 回 main。
- **控制面 HTTP（putSelf/putServerSource）直写 main 经 versioning**（决策 B），不走 overlay（外部权威写入）。

## 1. 概念（锚定 object.doc.ts persistable 三分）
`object.doc.ts`：Agent 持久层三分 **stone（静）/ pool（积）/ flow（动）**。
- **stone**＝长期身份与设计源码（self.md / readable.(md|ts) / executable / visible / seed-knowledge 五件套），跨 session 共享、进 git review。
- **flow**＝session 级运行态（每 session 一个 flow object，自己的 session 级数据与程序）。
- **pool**＝跨 session 累积事实（sediment knowledge），不进 git。

本设计把 stone 的 git 分支语义与 flow 的会话性显式分层：
- **main 分支 = canonical stone**：Object「已提交的权威自我」，唯一读源。
- **flow session overlay**：会话内对 self 文件的试验性改动，session 私有、即时可见、不污染 canonical。
- **super flow**：审视 overlay → 分支实验 → 合 main，是身份从「试验」到「提交」的唯一闸门。

## 2. 路径收口（修 bug 的根）
现状三套分叉（persistable agent 实测）：① 运行时读 `stones/main/objects/<id>/`（main worktree，事实权威）② session-path 把 `stones/<id>` rewrite 成 `packages/<id>`（deprecated，空）③ `stoneDir` 默认声明扁平 `stones/<id>/`（M2，但 bootstrap 没落这）。

**收口规则**：
- canonical 读路径 = **main 分支 worktree** `stones/main/objects/<nestedObjectPath>/`。`stoneDir` 默认路由（无 `_stonesBranch`）改为返回 main worktree，而非扁平 `stones/<id>/`，也非 `packages/`。
- `session-path.ts`：**删除 `stones/<id>`→`packages/<id>` 的 rewrite**（rewritePackagesPath 退役该分支）；agent 写的 `stones/<id>/...` 解析到 stone 解析器（见 §3 overlay 重定向），不再撞 packages/。
- `_stonesBranch` set 时仍走 `stones/<branch>/objects/<id>/`（versioning worktree，super-flow 实验分支 + 控制面 versioned write 用）——分支设计保留。
- 保留 §6 安全 clamp（resolveSessionPath 不得逃逸 world 根，已实现）。

## 3. Flow session overlay（决策 A：plain 目录）
**落点**：`flows/<sessionId>/<objectId>/overlay/<相对 stone 根的路径>`。
覆盖范围 = **stone identity 文件**：`self.md` / `readable.md` / `readable.ts` / `executable/**` / `visible/**`。（seed-knowledge 属设计源码，纳入；pool sediment 不在此——它本就独立、不进 git。）

**写重定向**：flow session（非 super、非控制面）内 data 原语（write_file / open_file+edit）写到 stone identity 路径时：
- 解析器识别「这是 stone identity 文件」→ 实际写到 `flows/<sid>/<objId>/overlay/...`，而非 main worktree。
- 返回成功；该改动 session 内立即生效（见读 overlay），但 main 不变。

**读 overlay（shadow main）**：所有读 stone identity 的入口——`loadSelfInstructions`（self.md 进 instructions）、executable/visible/readable loader、open_file 读 stone 文件——按序：
1. 若当前 thread 的 session 有 overlay 副本 → 读 overlay。
2. 否则读 canonical main worktree。
即 overlay 存在则 shadow，否则透传 main。**super flow / 控制面不应用 overlay shadow**（它们操作 canonical 本身）。

**生命周期**：overlay 随 session 目录存在；session 结束/清理即消亡。未经 super-flow 合入的 overlay 变更不进 canonical——这是「试验不污染身份」的体现。

## 4. super flow 身份合入（自我演化闸门）
super flow（sessionId="super"，由业务 session talk(target="super") 触发，带 creatorSessionId）提供身份合入能力：

**机制**：
1. **审视**：super flow 读「触发它的业务 session（creatorSessionId）的 overlay」与 main 的 diff，呈现给 agent（你这次试验改了身份的哪些部分）。
2. **分支实验**：agent 决定合入 → 系统从 main 建一个实验分支（`stones/<expBranch>/objects/<id>/`，复用现有 worktree 机制），把 overlay 变更应用进去。
3. **测**：agent 可在实验分支 worktree 上 exercise 改动（读/跑改后的 self/executable）；branch 隔离，不影响 main 与其它 session。
4. **合入**：验证 OK → merge 实验分支回 main（复用现有 ff-merge / versioned-write 机制，commit 署名 = self，非 bootstrap）。merge 后 main 更新，所有 session 下一轮见新身份；该业务 session 的 overlay 可标记已合入/清理。

**命令面（初版，可迭代）**：super flow 的 root 注册一条 `evolve_self`（或 `commit_identity`）method：
- `evolve_self()` 无参 → 列出 creator session overlay vs main 的 diff（哪些文件改了）。
- `evolve_self(args={ files?: string[], message: string })` → 选定文件（缺省全部）建分支应用、测试、merge main，返回 commitSha。
- 失败（冲突/测试不过）→ 返回错误，overlay 保留，main 不变。

> 这补上了 persistable 缺失的「agent-facing version 命令」——但它不是裸 git，而是有审视+分支隔离+测试的演化闸门，契合「身份演化是深思熟虑的反思行为」。

## 5. 控制面 HTTP（决策 B：直写 main）
`putSelf` / `putServerSource` / `createStone` 等控制面写入是**外部/人类权威写入**：直接对 main 经现有 `runVersioned`（worktree→commit→ff-merge）落 canonical，立即生效，**不走 overlay**。它们与 super-flow 合入是两条进入 canonical 的合法通道（一条外部、一条 Object 自我演化），互不经过对方。

## 6. agent-facing 语义变化（须同步更新引导）
当前 `basic-knowledge.ts` 引导「业务 thread 里轻改（临时 helper method）：直接 write_file」。新模型下：
- 业务 thread 对 self 文件的改动 = 进 overlay（session 内试验），**不再即时进 canonical/git**。
- 想把改动沉淀为正式身份 → 去 super flow `evolve_self`。
更新引导：明确「self 文件改动在 session 内是试验层，正式生效须经 super flow 合入 main」；消除「直接 write_file 即永久改身份」的旧心智。

## 7. 分阶段实现（每阶段独立可验）
- **P1 路径收口（修 bug，低风险高价值）**：`stoneDir` 默认→main worktree；删 session-path 的 packages rewrite；保留 clamp。验证：现有 .ooc-world 读 self/executable 命中 main；file/search/persistable 测试不回归。**这一阶段即消除三套分叉 + edit 写错地方。**
- **P2 overlay 读写**：识别 stone identity 路径 → 写重定向到 `flows/<sid>/<objId>/overlay/`；读入口 overlay-shadow-main。验证：session 内改 self.md→本 session 读到新值、main 不变、别的 session 读到旧 main。
- **P3 super-flow 合入**：`evolve_self` 命令（diff/branch/apply/test/merge main，复用 worktree+ff-merge）。验证：overlay→evolve_self→main 更新→新 session 见新身份；冲突/失败 overlay 保留。
- **P4 引导 + 概念同步**：更新 `basic-knowledge.ts` 引导；更新 `meta/object.doc.ts` persistable 节点（stone main=canonical / flow overlay / super-flow 合入），改后 `bun tsc --noEmit meta/object.doc.ts` 验证。

## 8. 边界与风险
- **main 在 session 有 overlay 期间被控制面/别的 super-flow 改了** → overlay 仍 shadow（session 看自己的试验值）；evolve_self 合入时按当时 main 建分支，可能 merge 冲突 → 报错让 agent 处理（不静默覆盖）。
- **super flow 读不读 overlay**：super flow 操作 canonical（建分支自 main），其自身 thread 不应用 overlay shadow；但它需能「读到 creator session 的 overlay 内容」作为合入输入（显式取 overlay，非 shadow）。
- **「轻改」摩擦**：业务 thread 改 executable 加 helper 不再即时生效于其它 session（须 evolve_self）——这是有意的（身份演化要经闸门）。若高频轻改体验差，后续可加「session 内 overlay 的 executable 在本 session 即时可调」（overlay 的 executable 也参与本 session 的方法解析），已在 P2 读 overlay 覆盖。
- **builtin objects（supervisor/user）**：走 `packages/@ooc/builtins/<id>`，不在 stones 分支模型内，overlay/演化不适用（保持现状）。

## 9. 验收
1. P1 后：无 packages rewrite；stone 读写单一权威 main worktree；现有测试 + harness persistable 复跑不再「working dir vs git 分叉」。
2. P2 后：overlay 读写隔离正确（session 私有、shadow main）。
3. P3 后：evolve_self 端到端（overlay→分支→测→合 main）；reflectable e2e 沉淀身份场景达 Good。
4. 全程：core/app-server 测试不回归；tsc + silent-swallow + deprecated gate 绿。
