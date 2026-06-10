# persistable / programmable 清理进度（2026-06-10）

> 与 `docs/2026-06-10-type-system-cleanup-progress.md`（类型系统线）**并行的另一条清理线**：
> 聚焦 `core/programmable` 子包——去 metaprog 手术后的残渣清理，最终**整包并入 persistable**。
> 本文档跟踪**已完成 / 进行到一半 / 后续待办** + **符号变更速查**，避免跨会话丢失进度。
> 原则（AGENT.md 性格段）：厌恶不良代码/注释、警惕新增名词、克制熵增。

## 总览：本轮动机

`core/programmable/` 是一个**经历过大手术（2026-06-09「去 metaprog」）但没缝合干净**的模块。
核心判断（梳理调用链路后定稿）：

- **名实不符**：programmable 是「能力维度」名（Object 自我迭代 / 自写方法），但目录里装的全是**机制**
  （git 薄包装、repo bootstrap、commit/merge/PR-Issue/rollback 编排）。能力入口其实在
  `builtins/root/executable/method.evolve-self.ts`。
- **可编程核心已被抽走**：去 metaprog 删掉 `supervisorCreateObject` / `versionedStoneWrite` /
  metaprog worktree 后，「programmable」的语义支点不在了，剩下纯粹是 **stone 的 git 版本化 + 合入治理**。
  名字不再约束内容 → 积了 10 个死 import、一堆 metaprog 残留命名。
- **外界早已当它是 persistable**：消费者全从 `@ooc/core/persistable` barrel 进；且
  `persistable/stone-worktree.ts` 反向 import `programmable/git`，违反 programmable 自己声明的
  「`programmable → persistable` 允许，反向禁止」——形成双向依赖。
- **化石证据**：这些文件的测试一直躺在 `persistable/__tests__/` 下，名叫 `stone-versioning.test.ts` /
  `stone-git.test.ts` / `stone-bootstrap.test.ts`。**并入 persistable 是认祖归宗。**

---

## ✅ 已完成

> 前五批（A–E）随用户 commit `01cdcca1` 一并入库；后两步独立成 `ad6a55de` / `1385062c`。
> 全程行为零变化，守门测试每批跑（最终 69 pass / 0 fail，tsc 无 programmable 相关错误）。

### A. 死代码删除（commit 01cdcca1）
- 删 `generateToken()`（全仓零调用——去 metaprog 后无人生成 `metaprog/{id}/{token}` 分支）。
- 删 `MetaprogWorktreeRef.baseCommit` 字段（全仓**只写不读**；注释还谎称「merge 时 gitMergeBase 重解析」）。
- 删 `void rm` / `void stat` keep-alive 黑魔法 + YAGNI 注释。

### B. 去 metaprog 命名（commit 01cdcca1）
- `MetaprogWorktreeRef` → **`SessionWorktreeRef`**（跨 5 文件），并砍掉死字段 `objectId`
  （合入路径全另收 `authorObjectId` 参数，无人读 `worktree.objectId`）→ 瘦身成 `{ baseDir, branch, path }`。
- `WORKTREE_BRANCH_PREFIX` 注释正名为「历史 metaprog 残留目录名，仅供 GC」。

### C. 死/半死导出消重（commit 01cdcca1）
- classify 核心抽成无 queue 的内部 `classifyDiffAgainstMain(repo, branch, authorObjectId)`，
  `classifyWorktreeBranch`（带 queue）与 `tryMergeSelf`（已在 queue 内、不能自调用否则 serial-queue
  重入死锁）共用，消除内联复制。
- **保留**了 `gitWorktreeRemove`（撤回删除：它是 git.ts 薄包装完整成员、有独立测试，删它=赌「未来永不硬删 worktree」）。

### D. 样板提取 + 隐藏 bug 修复（commit 01cdcca1）
- 提取 `cleanupWorktreeAfterMerge(repo, wtPath, baseDir, branch, ctx)`，消掉 `tryMergeSelf` +
  `resolvePrIssue(merge/reject)` **三处逐字重复**的 unregister+prune+gc+warn。
- **修掉隐藏 bug**：`gitWorktreeUnregister` 内部已 prune，resolvePrIssue 那两处的额外
  `gitWorktreePrune` 是**冗余双 prune**——随提取一并消除。
- `pruneStaleWorktrees` 的动态 import + `void stat` 半空转 → 顶层 `stat` 的诚实存在性检查。

### E. bootstrap 分层（commit 01cdcca1）
- `bootstrap.ts` 17 处 `Bun.spawnSync` + 13 处 `new TextDecoder().decode(...)` 样板收口进本地
  `runGit` helper（−278/+103 行）。保留抛错式 fail-loud 契约（bootstrap 操作 bare/scratch/push，
  git.ts 故意不覆盖；不强行混用 `{ok}` 返回式）。顺手删原本就没用的 `cp` import。

### F. 死 import + 注释精简（commit ad6a55de）
- **删 10 个去 metaprog 删函数后遗留的死 import**（tsc 未开 `noUnusedLocals` 故一直未报）：
  `createStoneObject` / `stoneKnowledgeDir` / `writeSelf` / `writeReadable` / `gitCurrentBranch` /
  `gitWorktreeAdd` / `gitWorktreeRemove`〔在 versioning 内死，但 git.ts 仍导出〕/ `isValidBranchName` /
  `isBuiltinObjectId` / `GitResult`。
- 模块头 31→16 行；清散落的 `2026-06-09` / `task#16` / `R12` / `(2026-05-21 layout)` / `U3 实现` 等
  考古噪音。**保留** serial-queue 重入、silent-swallow 理由、嵌套 child 物理路径误判、gitignore
  白名单、fail-loud convention doc 指针等解释 WHY 的注释。

### G. programmable 子包并入 persistable（commit 1385062c）
- **撤销 `@ooc/core/programmable` 独立子包**，4 文件 git-rename 为 persistable 的 stone-* 家族：
  - `programmable/git.ts` → `persistable/stone-git.ts`
  - `programmable/bootstrap.ts` → `persistable/stone-bootstrap.ts`
  - `programmable/versioning.ts` → `persistable/stone-versioning.ts`
  - `programmable/evolve-self.ts` → `persistable/stone-evolve-self.ts`
- 删 `programmable/index.ts`（导出已被 persistable barrel 转发）+ `package.json`（含 `role:"metaprog-versioning"` 残留）。
- **双向依赖违规根除**：`stone-worktree.ts` 不再跨包 import `../programmable/git`，改包内 `./stone-git`。
- import 路径同步：persistable/index barrel（4 段）、versioning-helper（`@ooc/core/programmable`→`persistable`）、
  4 个测试文件、迁入文件内部（`../persistable/X`→`./X`、`./git`→`./stone-git`）。

### H. CLAUDE.md / AGENT.md 同步（本批，普通 commit 范畴）
- 源代码结构段删 `programmable/` 行，persistable 行补「stone-* git versioning + evolve-self 合入，
  programmable 机制寄居于此」。
- 「维度 ≠ 目录一一对应」段补入 programmable 寄居 persistable（同构 reflectable 寄居 thinkable）。

---

## 🔶 进行到一半 / 待清理尾巴

### I. `.ooc-world-meta` 对象树未同步（submodule，待 review）
- `children/programmable/` 维度对象的**物理寄居描述**需更新：programmable 机制寄居
  `persistable/stone-*`、能力入口在 `builtins/root` evolve_self method。叙事对齐
  「reflectable 寄居 thinkable」「collaborable 寄居 executable/windows」。
- 约束：对象树是 submodule，须先在 submodule 内 commit，再回父仓库 bump 指针（AGENT.md 关键约束 #2）。
- **未做**——按边界应走对象树 review，不混进代码 commit。

### J. 维度叙事：programmable 作为独立目录已消亡
- 9 维度里 programmable 能力**不消失**，但它不再有独立 core 目录。这影响 9 维度的「目录心智模型」，
  CLAUDE.md 已更新（H），但对象树 supervisor `self.md` / `knowledge` 里若有「programmable=一个目录」
  的旧表述，需随 I 一并校正。

---

## ⬜ 后续待办（明确范围）

### K. 收窄过度暴露的公共 API（设计取舍，需拍板）
- `classifyWorktreeBranch`：**纯 test-only 公共 API**（真实合入路径 tryMergeSelf 用内部
  `classifyDiffAgainstMain`，零非测试 caller）。保留作「可观测原语」还是降为内部？
- `commitWorktree` / `requestPrIssueReview`：实质是 stone-versioning **内部函数**（仅 stone-evolve-self
  调），却作公共 API 导出。`tryMergeSelf` 也只多一个 storybook caller。若保留「Object 未来可自己编排
  合入」的扩展性则导出合理；否则可收窄 barrel 暴露面。

### L. `noUnusedLocals` 系统性缺口（全仓评估）
- tsc 没开 `noUnusedLocals` / `noUnusedParameters`，死 import / 死变量全靠人肉发现——本轮一个
  `versioning.ts` 就埋了 10 个。根治需开这两个 flag，但会在全仓暴露存量。**建议先派 agent 统计全仓
  死 import/死变量规模**，再决定是否值得开 + 分批清。

### M. 历史 metaprog GC 的退役时机
- `WORKTREE_BRANCH_PREFIX="metaprog"` + `gcEmptyWorktreeParents` / `gcEmptyMetaprogTree` 现在**只清理
  历史 metaprog 残留目录**（去 metaprog 后不再产生此类分支）。它们是纯历史遗留清理逻辑，待所有运行中的
  world 确认无 `stones/metaprog/` 残留后可整体退役。**暂留**（best-effort，无害）。

---

## 符号变更速查表

| 旧符号 | 新符号 / 处置 | 文件 |
|---|---|---|
| `MetaprogWorktreeRef` | `SessionWorktreeRef`（删 objectId/baseCommit 字段） | stone-versioning.ts |
| `generateToken()` | **删除** | stone-versioning.ts |
| （内联 classify 逻辑 ×2） | `classifyDiffAgainstMain()`（内部共用） | stone-versioning.ts |
| （三处 cleanup 样板） | `cleanupWorktreeAfterMerge()` | stone-versioning.ts |
| （17×spawnSync+decode 样板） | `runGit()`（本地 helper） | stone-bootstrap.ts |
| `@ooc/core/programmable` 子包 | **删除**（并入 persistable） | — |
| `programmable/versioning.ts` | `persistable/stone-versioning.ts` | rename |
| `programmable/git.ts` | `persistable/stone-git.ts` | rename |
| `programmable/bootstrap.ts` | `persistable/stone-bootstrap.ts` | rename |
| `programmable/evolve-self.ts` | `persistable/stone-evolve-self.ts` | rename |
| 10 个死 import | **删除**（见 F） | stone-versioning.ts |

---

## 验证状态
- 守门测试集（stone-versioning / stone-git / stone-bootstrap / flows-worktree-migration / stone-worktree
  / evolve-self / create-object / write-file.versioning）：**69 pass / 0 fail**。
- storybook 控制面（用 ensureStoneRepo / resolvePrIssue / rollback 经 barrel）：**9 pass / 0 fail**。
- tsc 全量无 programmable / stone-* 解析错误（注：全量仍有 3 个错误，**来自用户并行的 thinkable
  `synthesizer.ts` 删除**，与本线无关——见类型系统线文档协作边界）。
- 全仓 `@ooc/core/programmable` / `../programmable` import **零残留**；core 内 `programmable` 仅余
  对**维度**（能力叙事）的合法引用。

## 关键文件锚点
- stone 版本化高层编排：`packages/@ooc/core/persistable/stone-versioning.ts`
- git CLI 薄包装：`packages/@ooc/core/persistable/stone-git.ts`
- repo bootstrap：`packages/@ooc/core/persistable/stone-bootstrap.ts`
- evolve_self 合入闸门：`packages/@ooc/core/persistable/stone-evolve-self.ts`
- 能力入口（method）：`packages/@ooc/builtins/root/executable/method.evolve-self.ts`
- barrel 对外面：`packages/@ooc/core/persistable/index.ts`
- HTTP 控制面适配：`packages/@ooc/core/app/server/modules/stones/versioning-helper.ts`

---

## ✅ 第二轮：persistable 全模块审视清理（2026-06-11，commit c21c490e）

> 并入 programmable 后对整个 persistable（30 文件 / 5353 行）的审视。三组并行审计 agent
> （stone-* / flow-* / pool+基础设施）→ Supervisor 交叉验证 → 分四批执行，每批守门。
> 净删 110 行，行为零变化（一处隐藏 bug 修复）。

### N. 死代码删除（grep 坐实零生产 caller）
- **删 `flow-relation.ts` 整文件** —— 4 个导出零生产 caller，是「relation_window 功能未实装
  就提前建的 IO 层」（YAGNI）。两组审计独立确认。连 barrel 4 段转发一起删。
- **`stone-readme.readableTsFile`** —— 只在 barrel 转发，server-loader 内联了 `join`，无真实 caller。
- **`flow-runtime-object.createRuntimeObject`** —— 与 `writeRuntimeObjectState` 等价的 stub，
  测试只验证等价性。删函数 + 转发 + 该测试。

### O. 去 metaprog 残渣 + 断链 doc（延续上轮）
- metaprog 残留注释：`common.ts`（`STONE_OBJECTS_SUBDIR` 注释 + 路径优先级注释）、
  `pr-issue.ts:43`（branch 举例 `metaprog/agent_of_x/abc123` → `session-<sid>`）。
- **5 个文件断链引用已删除的 `meta/object.doc.ts`**（`stone-object` ×2 / `csv-pool` / `flow-data` /
  `pool-object` ×2 / `debug-file`）——删 dead pointer，保留解释正文。

### P. 重复样板 + 隐藏 bug 修复
- `debug-file.ts` 5 个 write 函数（writeDebugInput/Output/LoopInput/LoopOutput/LoopMeta）逐字重复
  `mkdir+writeFile` → 提取 `writeDebugFile(ref, file, record)` helper。
- **`flow-data.mergeData` 修 bug**：原内联 read-parse 对**非 object 的损坏 data.json 静默吞**
  （保持 `{}` 继续写），而 `readData` 会 fail-loud。改 `mergeData` 复用 `readData` → 损坏数据
  现在 fail-loud（兼消重）。

### Q. 命名失真
- `stone-object.ts`「B-tree 协议」→「嵌套子对象协议」（MEMORY 明确标注 B-tree 是历史误称勿用）。
- `stone-skills.ts` 删死参数 `_stonesBranch`（已 workspace 级，生产 caller `skill-index.ts` 早不传）；
  更新 2 个测试 caller。**`branchSkillsDir`/`listBranchSkills` 的 branch→workspace 重命名推迟**——
  它会动 `thinkable/context/skill-index.ts`，正是用户并行重构的区域，避让。

### 验证状态（诚实交代）
- 改动文件 **tsc 全干净**；可跑的 persistable 测试 **86 pass / 0 fail**。
- 全量 `persistable/` 跑有 **10 个失败，根因是用户并行 thinkable 重构把 `thinkable/context/intent.js`
  移走**（`executable/windows/manager.ts` 解析不到 → 凡 transitively import 它的测试整体加载失败，
  含 flow-data / csv-pool）。**与本清理无关**——stash 验证过、tsc 证逻辑无误，待 thinkable 落定自然恢复。

---

## ⬜ 第二轮新增待决（明确范围，未擅自做）

### R. 分层违规 persistable→executable（真架构问题，需设计）
- `flow-object.ts:5` 把 `builtinRegistry`（executable singleton）作默认参数；
  `thread-json.ts:6-8` import `executable/windows/_shared/init` 的 `initContextWindows` /
  `injectPeerWindowsIfObjectThread`。persistable（IO 层）反向依赖 executable（运行层）。
- 同 stone-worktree→programmable 那类违规，但修复要解决 `readThread` 用 registry hydrate
  contextWindows 的依赖——**不是一次 sed，需设计**（依赖注入 / 把 hydrate 提到 caller 层）。

### S. 半死导出（仅测试/e2e caller，需对照功能规划逐个判断）
- `flow-data` 的 `writeData`(`writeFlowData`) / `flowDataFile`：生产仅用 `readData`/`mergeData`。
- `pool-object` 的 `poolKnowledgeMemoryDir` / `poolKnowledgeRelationsDir` / `readPoolRelation`：仅测试。
- `stone-client` 的 flow-pages 四函数：仅 `tests/e2e/`。
- `csv-pool` 的 `parseCsv` / `stringifyCsvRow` re-export：canonical 在 `_shared/utils/csv.ts`，无 consumer。
- `mention.ts`（5 行 re-export）：barrel 已直连 `_shared/utils/mention.js`（line 238），文件半死
  ——**用户并行已删 mention.ts**（本轮 working tree 可见），无需重复处理。

### T. stone-skills branch→workspace 重命名（避让中）
- `branchSkillsDir` / `listBranchSkills` 名字仍暗示 branch（实际 workspace 级）。本轮只删死参数；
  重命名待用户 thinkable/skill-index 重构落定后再做（避免碰撞）。

### U. 考古注释噪音（churn 大收益低，配合后续 cleanup 顺手做）
- flow-* 的 `P5'` / `P6.§` Phase 标签、`index.ts` 日期戳、`thread-json.ts:23` 的 `Step 3` 墓碑注释、
  `debug-file` `Round 10 F2`、`world-config` 等散落日期戳。**不单独成批**。
