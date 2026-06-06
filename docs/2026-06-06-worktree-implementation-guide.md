# Worktree 模型实现接续指南（P2'/P3'）

> 把 stone/flow 从 plain overlay 落地为 session-worktree 统一模型的**可执行接续清单**。
> 设计权威：`docs/2026-06-05-stone-flow-overlay-versioning-design.md`（worktree 模型）。
> 复盘背景：`docs/2026-06-06-harness-sweep-retrospective.md`。memory：`project_stone_flow_worktree_model`。

## ✅ 实施完成状态（2026-06-06）

§1-§4 已全部落地（commit c2d50665 / 726ab0e1 / db9e54ea / 881c800c / 328cea8e）：

- **§1 main-commit**：真实运行路径（HTTP 控制面 versionedStoneWrite / bootstrap）已全 commit；
  地基测试恢复 worktree 完整副本内容断言。
- **§2 五通道全接入** `resolveStoneIdentityRef/Dir`：program shell `$OOC_SELF_DIR` /
  write_file·edit·open（file builtin）/ loadSelfInstructions·object_stone_dir（context）/
  visible endpoint（client-source-url）。**loader 通道经分析确认无需改**——executable 命令集 /
  注册 readable 是全局 main-canonical（object 类型系统全局共享，per-session 改命令集走
  evolve_self→main→重注册），不 per-session 路由。
- **§3 evolve_self 重做**：commit `session-<sid>` 分支 → rebase→ff-merge main → GC（移除
  worktree + 删分支）；session 分支即演化单元（删 files 子集）；复用 commitWorktree/tryMergeSelf。
- **§4 回收 plain overlay**：删 session-overlay.ts + 单测；relWithinObjectFromPackages 移入
  session-path.ts；object.doc.ts main_overlay_evolve_model → main_worktree_evolve_model。
- **gate 全绿**：tsc / 855 core+builtins tests / silent-swallow / deprecated-symbols；
  deterministic e2e（stones-versioning / client-parity）绿。
- **剩余**：全维度 LLM harness（§5，operator 重跑获取 gitignored 体验）。

---

以下为原始施工清单（已完成，留作实现细节参考）。

## 0. 已就绪的地基（commit 19d39f16）
- `packages/@ooc/core/persistable/stone-worktree.ts`：
  - `resolveStoneIdentityDir(ref, mode: "read"|"write")` —— **统一访问原语**：business session →
    lazy worktree / super·控制面·无 session → main。读未建 worktree 透传 main，写则 lazy 建。
  - `ensureSessionWorktree(baseDir, sessionId)` —— 从 main HEAD lazy `gitWorktreeAdd` 建
    `session-<sid>` worktree（幂等）。
  - `sessionUsesWorktree` / `sessionStoneBranch`。
  - `stone-worktree.test.ts`：4 测试绿（路由 / lazy 建 / 幂等 / 纯函数）。

## 1. 【最先做】main-commit 同步（否则 worktree 永远空）
**约束（doc §8，地基实测逼出）**：session worktree 从 main 分支 **HEAD** checkout → identity 必须已
**git-commit 到 main** 才被 worktree 看到。
- 现状：P1 把 canonical 指向 main worktree **文件系统**（读不经 git）；控制面 `putSelf`/`createStone`
  经 `versionedStoneWrite` 会 commit ✓；但低层 `createStoneObject`/`writeSelf`（`persistable/stone-object.ts`）
  只写文件不 commit。
- **要做**：确保凡进入 main 的 identity 写都 commit 到 main 分支。审 `programmable/bootstrap.ts`
  的 stone import（`ensureStoneRepo` 后是否 commit）+ `createStoneObject`。
- **验证**：`stone-worktree.test.ts` 第 3 用例当前因 main 未 commit 把「worktree 完整副本含 self.md」
  降级为只验路由；补 commit 后恢复内容断言（worktree 内应能读到 main 已 commit 的 self.md）。

## 2. 五通道接入 `resolveStoneIdentityDir`（核心）
所有访问 stone identity 的通道都改走统一原语，结构上杜绝再漏接：

| 通道 | 文件（已确认存在） | 现状 | 改法 |
|---|---|---|---|
| `write_file` 写 | `packages/@ooc/builtins/file/executable/index.ts`（write_file package-object 分支 ~L586-627；`resolveStoneOverlayTarget` ~L391 给 file_window.edit） | plain overlay 重定向（`writeOverlayFile`） | 改为 `resolveStoneIdentityDir(ref,"write")` 写 worktree |
| `loadSelfInstructions` 读 | `packages/@ooc/core/thinkable/context/index.ts`（`loadSelfInstructions` ~L355） | `readStoneFileWithOverlay`（overlay shadow） | 改为读 `resolveStoneIdentityDir(ref,"read")`/self.md（worktree 完整，无 shadow） |
| executable/visible/readable loader 读 | grep 定位（`getObjectDefinition`/stone loader；executable: `executable/object/*`，visible/readable loader） | 读 main | overlay-aware → 经 `resolveStoneIdentityDir` |
| program shell `$OOC_SELF_DIR` | `packages/@ooc/core/executable/program/self-env.ts` | 止血指 main（`stoneDir`，commit 727a33a7） | 改 `resolveStoneIdentityDir(ref,"write")` → worktree（裸读裸写完整副本） |
| 控制面 visible endpoint | `packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts` | 只查 main、无 flow scope | 带 sessionId 时经 `resolveStoneIdentityDir(ref,"read")`（session 预览读 worktree，否则 main） |

> 注：`resolveStoneIdentityDir` 当前签名收的是 `{baseDir, sessionId?, objectId}` + mode；各通道从
> `thread.persistence` 取 ref。program shell / endpoint 注意 sessionId 来源。

## 3. P3' — evolve_self 重做（commit session 分支 + merge main）
- 文件：`packages/@ooc/core/programmable/evolve-self.ts`（当前 plain overlay diff/apply/merge）
  + root 命令 `packages/@ooc/builtins/root/executable/method.evolve-self.ts`。
- 改为：commit creator session（`creatorSessionId`）的 `session-<sid>` worktree 改动（署名 self）
  → merge `session-<sid>` 回 main。**不再新建实验分支**（session 分支即演化单元，doc §4）。
- 复用：`packages/@ooc/core/programmable/versioning.ts` 的 `commitWorktree` / `tryMergeSelf`。
- GC（doc §4.1）：merge 成功后 `gitWorktreeRemove` + 删分支。

## 4. 回收 plain overlay
- `packages/@ooc/core/persistable/session-overlay.ts`：删/替换 overlay 路径读写
  （`writeOverlayFile` / `readStoneFileWithOverlay` / `overlayStoneFilePath` / `sessionUsesOverlay`）。
- grep 所有 import 处一并切换到 worktree；`check:deprecated-symbols` gate 把关。

## 5. 验证
- 单测：`stone-worktree.test.ts`（补 main-commit 后恢复内容断言）+ 各通道单测。
- gate：`bun run check:tsc` / `check:silent-swallow` / `check:deprecated-symbols`（全绿）。
- **harness 体验**（gitignored，重跑获取）：
  ```
  NO_PROXY=localhost,127.0.0.1 bun packages/@ooc/tests/harness/orchestrate.ts \
    --dimensions persistable,programmable,visible --timeout 1500
  ```
  验收点（doc §9）：business session 改 self→worktree；program shell `$OOC_SELF_DIR` 裸读完整 identity；
  main 不变；别的 session 读 main；`evolve_self` commit+merge 后新 session 见新身份；visible session
  产物 endpoint 可解析。

## 6. 基础设施速查
- `packages/@ooc/core/programmable/git.ts`：`gitWorktreeAdd/Remove/List/Prune`（封装好）。
- `packages/@ooc/core/programmable/versioning.ts`：`openMetaprogWorktree`/`commitWorktree`/`tryMergeSelf`/`requestPrIssueReview`。
- `packages/@ooc/core/programmable/versioned-write.ts`：`versionedStoneWrite`（branch→write→commit→merge 流程范本）。
- `packages/@ooc/core/persistable/common.ts`：`stoneDir(ref{_stonesBranch})`、`STONES_MAIN_BRANCH="main"`、`STONES_BARE_REPO_DIR=".stones_repo"`、`nestedObjectPath`。

## 7. 建议实施顺序
1. §1 main-commit 同步（先打通，否则后面都验不了）→ 恢复地基测试内容断言。
2. §2 program shell `$OOC_SELF_DIR`（最小、直接修 programmable high）→ 跑 programmable harness 验。
3. §2 write_file + loadSelfInstructions + loader → 跑 persistable harness 验 overlay 隔离。
4. §2 visible endpoint → 跑 visible harness 验。
5. §3 evolve_self 重做 → 跑 reflectable/persistable 验身份合入。
6. §4 回收 plain overlay + 全量 gate + 全维度 harness 复跑。
