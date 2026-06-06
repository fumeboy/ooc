# Stone/Flow 身份分层与演化设计（session worktree 模型）

> 确立「main 分支 = canonical stone，business flow session = 从 main lazy 派生的 **git worktree
> 分支**（完整工作副本，session 内试验身份），super flow = 把 session 分支 merge 回 main 的演化闸门」。
> 来源：harness persistable/programmable/visible 高 severity 发现 + 与用户的多轮设计确认
> （2026-06-05 plain overlay 初版 → 2026-06-06 升级为 worktree 统一模型）。
> 状态：设计定稿（worktree 模型），P1 已落地，P2'/P3' 待落地。

## 0. 决策记录
- **canonical stone = `stones/main/objects/<id>/`**（main git 分支 worktree）。git 分支设计保留。
- 默认所有 flow session 读 main 分支的 object 定义（self.md / executable / visible / readable / seed-knowledge）。
- **【2026-06-06 升级】business flow session 改 identity → 从 main lazy 派生一个 session git worktree
  分支 `session-<sid>`，完整 checkout（非稀疏 plain overlay）。该 session 对该 object 的 identity
  读写都指向这个 worktree。**
- **super flow = 身份演化唯一正式通道**：commit session 分支 → merge 回 main（**不再新建独立实验分支**
  ——session 分支本身即演化单元）。
- 控制面 HTTP（putSelf/putServerSource/createStone）直写 main 经 versioning，**不走 session worktree**
  （外部/人类权威写入）。

### 0.1 为何从 plain overlay 升级为 worktree（升级动因）
plain 稀疏 overlay（初版）= 只存改动的补丁层 → 读必须 shadow（overlay ?? main 逐文件叠加）。
harness 暴露三个连锁问题：
- **裸读死穴**：program shell（`$OOC_SELF_DIR`）裸读稀疏 overlay 看不到 main 未改文件；shadow 是
  「两目录逻辑叠加」，无法用单一目录喂给裸进程。
- **读写不对称**：写能用「一个路径」重定向，读只能「内容级逐文件 shadow」，统一访问层被迫拆两原语。
- **实验分支冗余**：plain overlay 不是 git 分支，super flow 合入须先把补丁 apply 到一个新建实验分支
  才能 merge。

worktree（完整副本）一举消解三者：overlay 完整 → 读直接读它（无 shadow）→ 裸读看到全部 → 读写都指向
一个目录 → session 分支本身可 merge（无须实验分支）。唯一代价（每 session 副本开销）用 **lazy 创建**
（仅首次写 identity 才建）缓解。

## 1. 概念（锚定 object.doc.ts persistable 三分）
Agent 持久层三分 **stone（静）/ pool（积）/ flow（动）**：
- **stone** = 长期身份与设计源码（self.md / readable.(md\|ts) / executable / visible / seed-knowledge），
  跨 session 共享、进 git review。
- **flow** = session 级运行态（每 session 一个 flow object）。
- **pool** = 跨 session 累积事实（sediment knowledge），不进 git。

本设计把 stone 的 git 分支语义与 flow 的会话性显式分层：
- **main 分支 = canonical stone**：Object「已提交的权威自我」，唯一读源。
- **business flow session = 从 main 派生的 git worktree 分支**：session 内对 identity 的试验都在它上面，
  完整、隔离、不污染 main。
- **super flow = 把 session 分支 merge 回 main 的闸门**：身份从「动（试验）」到「静（提交）」的唯一关口。

## 2. 路径收口（P1，已落地）
canonical 读路径 = main 分支 worktree `stones/main/objects/<nestedObjectPath>/`。`stoneDir` 默认路由
（无 `_stonesBranch`）返回 main worktree（非扁平 `stones/<id>/`、非 `packages/`）。`_stonesBranch` set
时走 `stones/<branch>/objects/<id>/`（versioning worktree）。保留 `resolveSessionPath` 安全 clamp
（不得逃逸 world 根）。这一阶段消除了历史三套路径分叉。

## 3. business flow session = lazy git worktree 分支
**模型**：每个 business flow session 对某 object 的 identity 改动，发生在该 session 从 main 派生的
**git worktree 分支** `session-<sid>` 上（完整 checkout，复用 stones bare repo）。

**lazy 创建**（缓解开销）：
- session **不写 identity** → 不建 worktree，所有 identity 读直接走 main canonical（零开销；绝大多数对话如此）。
- session **首次写 identity 文件** → `git worktree add` 从当前 main HEAD 建 `session-<sid>` 分支 worktree
  （完整副本）；此后该 session 对该 object 的 identity 读写都指向 worktree。

**覆盖范围 = stone identity 文件**：`self.md` / `readable.*` / `executable/**` / `visible/**` /
seed-knowledge。（pool sediment 不在内——它独立、不进 git。）

**统一访问层（读写对称，一个目录）** —— 核心：
```
resolveStoneIdentityDir(ref):
  business session 且已建 worktree → 该 worktree 目录
  business session 未建 worktree   → 读:main / 写:触发 lazy 建后返回 worktree
  super flow / 控制面              → main（或 super 操作的目标分支）
```
所有 identity 访问通道**都过它**（结构上杜绝再漏接）：
- `write_file` / `open_file`+edit → 写 `resolveStoneIdentityDir`。
- executable / visible / readable loader、`loadSelfInstructions` → 读 `resolveStoneIdentityDir`
  （worktree 完整，**无需 shadow**）。
- **program shell `$OOC_SELF_DIR` = `resolveStoneIdentityDir`** → 业务 session 指 worktree（完整副本，
  裸读裸写都对，program shell **完全可参与自我编程**，不再被迫退出 identity）。
- 控制面 visible client-source-url endpoint：带 sessionId 时读该 session worktree，否则 main。

**生命周期**：worktree 随 session 存在；session 内改动是 worktree 工作区的 **uncommitted** 改动
（session 期间不 commit——commit 边界留给 evolve_self，见 §4.1）。session 结束/演化后 GC（§4.1）。

## 4. super flow 演化闸门 = merge session 分支
super flow（sessionId="super"，由 business session `talk(target="super")` 触发，带 creatorSessionId）
把 session 分支的试验**正式合入 main**：

**机制（无独立实验分支）**：
1. **审视**：对 creator session 的 `session-<sid>` 分支 vs main 求 diff，呈现给 agent。
2. **commit**：agent 认可 → 把 session 分支 worktree 的 uncommitted 改动 commit（署名 = self）。
3. **测**：可在 session 分支上 exercise 改动（分支已隔离）。
4. **合入**：ff/三方 merge `session-<sid>` 回 main（复用现有 merge，commit 署名 self）。main 更新，
   下一轮所有 session 见新身份。
5. 冲突/失败 → 报错，session 分支保留、main 不变，可处理后重试。

**命令面**：super flow root 注册 `evolve_self`：
- `evolve_self()` 无参 → 列 creator session 分支 vs main 的 diff。
- `evolve_self(args={ files?, message })` → commit（选定文件，缺省全部）+ merge main，返回 commitSha。

> session 分支本身即演化单元——super flow 是对它执行 commit+merge 的**角色**，不再「新建分支应用补丁」。

### 4.1 三点厘清
1. **super 自身的双重身份**：super flow（sessionId="super"）本身也是一个 session——它若也原生改
   identity，也会有自己的 `session-super` worktree（作为「被演化的分支」）；但其本职是对 *别的*
   business session 分支（creatorSessionId）执行 merge（作为「演化的执行者」）。两角色并存，按
   creatorSessionId 区分操作对象。
2. **commit 时机 = 闸门**：business session 期间 agent 在 worktree 写 identity 都是 uncommitted 工作区
   改动；只有 evolve_self 才 commit（署名 self）+ merge。「未 commit = 仍是试验 / commit = 提交身份」
   这条 git 边界天然对齐「动→静」闸门，无需额外状态机。
3. **GC（worktree/分支生命周期）**：
   - evolve_self 成功 merge 后：`git worktree remove` + 删 `session-<sid>` 分支（已并入 main）。
   - session 结束但从未 evolve：worktree 是「被放弃的试验」——随 session 目录清理时 `git worktree remove`
     + prune 分支（或保留一窗口供恢复）。
   - 防泄漏：活跃 worktree 数 = 当前「正在做自我编程的 session」数，因 lazy 而受控。

## 5. 控制面 HTTP（直写 main）
`putSelf` / `putServerSource` / `createStone` 是外部/人类权威写入：直接对 main 经 `runVersioned`
（worktree→commit→ff-merge）落 canonical，立即生效，**不走 session worktree**。与 super-flow 合入是
两条进入 canonical 的合法通道（一外部、一 Object 自我演化），互不经过对方。

## 6. agent-facing 语义（引导更新）
- business session 改 identity = 在 session worktree 上试验（完整副本，本 session 立即可用，
  **program shell 也能读写完整 self**），**不进 main**。
- 正式生效 → super flow `evolve_self`（commit + merge main）。
- 消除「直接 write_file 即永久改身份」旧心智；明确「session 是 worktree 试验场，super flow 是合入闸门」。
- **program shell 可正常自我编程**（`$OOC_SELF_DIR` 指 worktree 完整副本）——不再有「shell 改 method
  落不到位 / 读不到完整 self」的坑。

## 7. 分阶段实现
- **P1 路径收口**（已落地）。
- **P2'（worktree 重做）**：替换 plain overlay 为 lazy session worktree；落地统一 `resolveStoneIdentityDir`，
  所有通道（write_file / loader / program shell `$OOC_SELF_DIR` / 控制面 visible endpoint）改走它。
  验证：session 内改 self.md→worktree、program shell 裸读完整、main 不变、别的 session 读 main。
- **P3'（演化重做）**：`evolve_self` = commit session 分支 + merge main（去实验分支）。验证：
  session→evolve_self→main 更新→新 session 见新身份；多 session 并发 evolve 走 git 三方合并。
- **P4 引导 + 概念同步**：更新 `basic-knowledge.ts`、`meta/object.doc.ts` persistable 节点。
- **回收旧实现**：删 plain overlay（`session-overlay.ts` 的 overlay 路径读写、§3 旧重定向）；
  `OOC_SELF_DIR` 从 main（止血 727a33a7）改指 worktree。

## 8. 边界与风险
- **main 漂移 = 快照隔离**：worktree 是创建时 main 快照；session 期间 main 被控制面/别的 super-flow 改
  → worktree 不自动跟。evolve_self merge 时三方合并/冲突由 git 处理（不静默覆盖）。对「身份试验隔离」是优点。
- **多 session 并发演化同一 object**：多个 session 分支并存，各自 evolve_self merge → 原生 git 三方合并/冲突。
- **worktree 开销**：lazy 化 → 仅活跃自我编程 session 持 worktree；GC（§4.1）回收。
- **builtin objects**（user 等）走 `packages/@ooc/builtins/<id>`，不在 stones 分支模型，无 worktree/演化。

## 9. 验收
1. P2' 后：business session 改 identity 落 session worktree；program shell `$OOC_SELF_DIR` 裸读到完整
   identity；main 不变；别的 session 读 main。
2. P3' 后：`evolve_self`（commit+merge）端到端；多 session 并发 evolve 走 git 合并；reflectable 沉淀身份
   场景达 Good。
3. 全程 core/app-server 测试不回归；tsc + silent-swallow + deprecated gate 绿。
