---
date: 2026-05-20
type: feat
origin: docs/brainstorms/2026-05-20-stones-git-versioning-requirements.md
status: active
---

# feat: Stones 目录的 Git 版本管理与 Object 元编程沙箱

## Summary

把 `.ooc-world-test/stones/` 升级为 git-versioned 多 worktree 布局：`stones/main/` 是默认的 stones 工作树，`stones/{branch}/` 是其他分支（含 Object 元编程的临时沙箱）。OOC Server 启动接受 `--stones-branch=main`（默认 main）。新增 `src/persistable/stone-git.ts`（git CLI 薄包装）+ `src/persistable/stone-versioning.ts`（worktree / commit / 路径划界 / merge / PR-Issue / rollback 编排）。Object 通过 reflectable knowledge 学到协议，自行 shell 出 git worktree 与第二个 OOC Server 做试运行；A3 把 commit 评估、merge / PR-Issue 路由、回滚等收口在 persistable 层。

---

## Problem Frame

OOC programmable 维度让 Object 改自己的 stone（self.md / server / knowledge）；当下 `src/persistable/stone-*.ts` 直接对 stone 做 fs 写、没有版本机制：错了立即生效、没有可回看轨迹、没有试错沙箱、并发修改无仲裁。元编程是自举的核心动作，需要一层"安全试错 + 可回退 + 可审计"的 git 基础设施（详见 origin: `docs/brainstorms/2026-05-20-stones-git-versioning-requirements.md`）。

---

## Actors

继承 origin（A1 OOC Object、A2 Supervisor、A3 Stone Versioning 子系统）。本计划落实 A3 = `src/persistable/stone-git.ts` + `src/persistable/stone-versioning.ts` 中的若干函数（不引入新模块/抽象层，函数级补进 persistable）。

---

## Output Structure

落地后 `.ooc-world-test/` 期望布局：

```
.ooc-world-test/
├── stones/                         # git 工作根，包含 .git/
│   ├── .git/                       # 单 repo
│   ├── .gitignore                  # 暂只忽略本目录内 worktree linkfile 之类
│   ├── main/                       # 默认 stones 工作树（main 分支）
│   │   ├── agent_of_thinkable/
│   │   ├── agent_of_persistable/
│   │   ├── ...
│   │   └── supervisor/
│   ├── metaprog-{objectId}-{token}/   # 元编程 worktree（动态生成、可被 GC）
│   └── ...
├── flows/                          # 不入 git
│   ├── super/
│   │   ├── issues/                 # PR-Issue 落点（复用现有 Issue + super session 长寿）
│   │   └── ...
│   └── {sessionId}/...
└── debug/                          # 不入 git
```

实现者可在边界细节上调整（worktree 命名约定、.gitignore 内容），但顶层形状以本图为准。

---

## High-Level Technical Design

> 以下示意是 review 用的方向性表达，不是实现规范；实现者按 Per-unit Approach 字段决定真实代码形态。

### 路径解析

```text
StoneObjectRef {
  baseDir: string         // .ooc-world-test
  stonesBranch: string    // "main" by default; per-server config
  objectId: string
}
stoneDir(ref) = ${baseDir}/stones/${stonesBranch}/${objectId}
```

每个 OOC Server 进程绑定一个 `stonesBranch`；切换 stonesBranch 不在运行期发生，而是通过启动新进程实现（worktree-as-second-world 的核心兑现）。

### Worktree 元编程协议（Object 视角）

```text
1. Object 决定元编程 → 调用 reflectable 知识里给的协议指引
2. shell:  git -C .ooc-world-test/stones worktree add ./metaprog-{id}-{token} -b metaprog-{id}-{token} main
3. 在 stones/metaprog-.../{self}/ 下编辑文件（可由 Object 自己的 server 方法执行 fs 写、或 shell out 写）
4. （可选）shell: bun run src/app/server/index.ts --world ./.ooc-world-test --stones-branch metaprog-{id}-{token} --port {ephemeral}
   → 用第二个 OOC Server 实例启动起来，验证修改后的 self.md / server 在另一个独立进程下能正常加载、运行
5. 通过主 Server 上的 stone-versioning 函数（或 server method）请求 merge：
     A3: rebase metaprog-... onto main HEAD
     A3: branch 累积 diff vs merge-base 路径分类
        → 全在 stones/main/{authorId}/ 内？fast-forward merge
        → 任一文件越界？打开 PR-Issue（flows/super/issues/）, 等 Supervisor 决议
6. PR-Issue resolved-merge → A3 fast-forward；resolved-reject → 整 branch archived under refs/ooc/rejected/{branch}, worktree 销毁；request-changes → worktree 保留，等 Object 下一轮迭代
```

### 路径划界（branch-net-diff vs main）

```text
classifyDiffForBranch(branch, mainRef, authorObjectId): "self-scope" | "cross-scope"
  let names = git diff --name-only ${mainRef}...${branch}
  if authorObjectId === "supervisor": return "self-scope"   // R12 例外
  for each name in names:
    if !name.startsWith(`${authorObjectId}/`): return "cross-scope"
  return "self-scope"
```

注意 path 起点是 stones/{branch}/ 工作树根（即 agent_of_X/ 直接在分支根下，不再多一层 `stones/` 前缀）——这是 Output Structure 重构的副效益，让 path 划界更简洁。

### 序列化

所有 git 子命令（init / worktree add|prune / branch / rebase / merge / commit / diff / 等）通过 `enqueueSessionWrite("git:" + baseDir, ...)`（已存在于 `src/persistable/serial-queue.ts`）串行化到单 repo 上；同 baseDir 内 git 操作严格串行，不同 baseDir 并行。

### 元编程子进程 OOC Server 与主 Server 的关系

主 Server 是控制面：持有 jobManager / pauseStore / 主 stones-branch（默认 main）。
子 Server 是验证沙箱：进程独立，配自己的 port 和 stones-branch，jobManager / pauseStore 是新实例。两者唯一共享的是 `.ooc-world-test/.git/`（git 内部锁文件保证原子性）和文件系统。子 Server 不参与主 Server 的 worker 调度。

---

## Requirements

继承 origin 全部 R1-R12，本计划逐个落实并对应到 U-IDs。下列为对应矩阵：

| Origin 需求 | 实现单元 |
|---|---|
| R1 单 repo `.ooc-world-test/stones/.git/` + 启动自动 init | U1 |
| R2 仅 stones/ 入 git，flows/ 等瞬态 | U1 + U2 |
| R3 worktree = 独立 world 目录 | U2 + U7 |
| R4 commit 由 Object 署名（F3 例外 → Supervisor） | U3 + U4 + U6 |
| R5 self-scope fast-forward + rebase + 重试运行 | U4 |
| R6 cross-scope（任一 hunk 越界整 branch 越界） | U4 |
| R7 PR-Issue 复用 Issue 机制 + 载荷 | U5 |
| R8 PR-Issue resolution → worktree 命运 | U4 + U5 |
| R9 评审期间 main 不变 | U4 |
| R10 Supervisor 署名回滚 commit | U6 |
| R11 worktree 可丢弃 | U4 |
| R12 Supervisor 元自治例外 | U4 |

---

## Key Flows

继承 origin F1-F3。详见 origin doc。本计划在 F1 step 6 / F2 step 3 / F3 上对应 U-IDs 实现。

---

## Acceptance Examples

继承 origin AE1-AE8（已修订），每个 AE 对应到至少一个 U-ID 的 test scenarios。详细的 test inputs / actions / outcomes 见各 U 的 `Test scenarios`。

---

## Implementation Units

### U1. 重构 stones/ 为多 worktree 布局 + 启动自动 init

**Goal:** 把 `.ooc-world-test/stones/` 重塑为 `stones/{branch}/` 嵌套布局；首次启动时 `stones/.git/` 不存在则自动 init + 一次性 squash bootstrap commit；写出最终 `.gitignore`。

**Requirements:** R1, R2 (see origin: `docs/brainstorms/2026-05-20-stones-git-versioning-requirements.md`)

**Dependencies:** （无）—— 这是 base unit，所有后续 unit 假设此布局

**Files:**
- 修改 `src/app/server/index.ts`（boot 序列加 git 自检）
- 新增 `src/persistable/stone-bootstrap.ts`（init + squash + .gitignore 写入）
- 新增 `src/persistable/__tests__/stone-bootstrap.test.ts`
- 修改 `.gitignore`（外层仓库已忽略 `.ooc-world-test/`，无需改；如有需补充也只在 world 内的 .gitignore）
- 迁移现有 `.ooc-world-test/stones/agent_of_*/` 到 `.ooc-world-test/stones/main/agent_of_*/`（**仅本仓库 dev 状态需要**；运行时若用户的 world dir 是空，bootstrap 直接 init 即可）

**Approach:**
- Boot 序列检查 `${baseDir}/stones/.git/` 是否存在
- 不存在：`git init -b main` 在 `${baseDir}/stones/`，将其下当前所有内容（包括 `main/`）作为初始 squash commit，author = `bootstrap <bootstrap@ooc.local>`，commit message `chore(bootstrap): import existing stones/`
- 写 `${baseDir}/stones/.gitignore`：暂时为空（worktree linkfile 由 git 自动管理；本期不在 stones/ 内忽略额外路径）
- 已存在但 HEAD 未生根（dirty fresh init）：补一个 bootstrap commit
- 已存在且 dirty（有未跟踪文件）：把所有内容并入下一个 commit by Supervisor 还是 by bootstrap？本期约定 by `bootstrap`，记一条 warning 日志，让运维有迹可循
- **重要副效益**：path scope 比较从 "stones/{objectId}/" 改为 "{objectId}/"，因为 git 工作树根就在 stones/{branch}/ 一层，不需要再带 `stones/` 前缀

**Patterns to follow:**
- `Bun.spawnSync(["git", ...], { cwd, stdout: "pipe", stderr: "pipe" })` —— 与 `src/executable/program/shell.ts:6` / `src/executable/windows/root/grep-impl.ts:64` 同款
- 测试用 `mkdtemp` 创建独立 world，`afterEach` rm 清理 —— 同 `src/persistable/__tests__/issue.test.ts`

**Test scenarios:**
- Happy path: 空 baseDir → 启动后 `stones/.git/` 存在、有一条 bootstrap commit、HEAD 在 `main`
- 已有内容：`stones/main/agent_of_X/self.md` 预置，启动后该文件被 git 跟踪、bootstrap commit 包含它
- Idempotent：重复启动不产生新 bootstrap commit、不报错
- HEAD 未生根：`git init` 已跑过但 0 commit → 补 bootstrap commit
- 错误路径：`stones/.git/` 是损坏的 git 目录 → 明确错误信号、不静默 init 覆盖

**Verification:** 启动器跑过一次后 `git -C stones log --oneline` 至少有 bootstrap commit，且 `git -C stones status` 干净

---

### U2. 新增 `--stones-branch` 启动参数 + StoneObjectRef 加 stonesBranch 字段

**Goal:** OOC Server 启动接受 `--stones-branch=main`（默认 main），所有 stone 路径解析变为 `${baseDir}/stones/${stonesBranch}/${objectId}/...`。

**Requirements:** R3 (see origin)

**Dependencies:** U1（依赖目录布局）

**Files:**
- 修改 `src/app/server/bootstrap/config.ts`（加 `stonesBranch` 字段 + `--stones-branch` flag + `OOC_STONES_BRANCH` env）
- 修改 `src/persistable/common.ts`（`StoneObjectRef` 加 `stonesBranch?: string` 字段；`stoneDir(ref)` 实现从 `${baseDir}/stones/${objectId}` 改为 `${baseDir}/stones/${ref.stonesBranch ?? "main"}/${objectId}`）
- 修改所有创建 `StoneObjectRef` 的代码：`src/app/server/...` 路由层从 config 读 stonesBranch、`src/executable/...` worker 层从 RuntimeJob 拿 stonesBranch
- 修改 `src/persistable/__tests__/persistable.test.ts` / `stone.test.ts` 等：构造 ref 时显式 stonesBranch
- 修改 `RuntimeJob` schema（`src/app/server/runtime/job-manager.ts`）加 `stonesBranch?: string` 字段（透传给 worker）
- 测试：`src/persistable/__tests__/stone-ref.test.ts`（新增，验证路径组合）

**Approach:**
- 默认值在 config 层注入；下游可一直读 ref.stonesBranch 不带 nullish。
- `process.cwd()` 仍是兜底 baseDir；`stonesBranch` 在 baseDir 之后兜底
- 路径不再带 `stones/` 前缀（已通过目录重构吸收），即 `stoneDir({ baseDir, stonesBranch, objectId }) = join(baseDir, "stones", stonesBranch, objectId)`

**Patterns to follow:** 现有 `readServerConfig` flag 解析模式（`src/app/server/bootstrap/config.ts:36`）

**Test scenarios:**
- `stoneDir` 路径正确组合：`{base, "main", "agent_of_X"}` → `base/stones/main/agent_of_X`
- `--stones-branch metaprog-foo` 启动后所有 stone 读写指向 `stones/metaprog-foo/`
- 缺省时 stonesBranch === "main"
- env `OOC_STONES_BRANCH` 兜底
- 多个 ref 同 baseDir 不同 stonesBranch 互不干扰（隔离测试）

**Verification:** `bun test src/persistable/__tests__/` 全过；启动 `bun run src/app/server/index.ts --world .ooc-world-test --stones-branch main` 行为等同改造前

---

### U3. `src/persistable/stone-git.ts` —— git CLI 薄包装

**Goal:** 不引入 git npm 依赖，用 `Bun.spawnSync` 把 plan 需要的所有 git 子命令包成 typed async 函数。所有函数 cwd 参数化，不修全局 git config。

**Requirements:** R3, R5, R6, R8, R10 间接依赖

**Dependencies:** U1（git repo 已存在）

**Files:**
- 新增 `src/persistable/stone-git.ts`
- 新增 `src/persistable/__tests__/stone-git.test.ts`

**Approach:**
- 导出函数（每个返回 Promise 或同步——按调用模式选择）：
  - `gitInit(repoDir)` / `gitCurrentBranch(repoDir)` / `gitHead(repoDir)`
  - `gitStatus(repoDir)`（解析 porcelain）
  - `gitDiffNames(repoDir, baseRef, headRef)` 返回 `string[]`（branch-累积 path 列表）
  - `gitCommit(repoDir, { authorName, authorEmail, message })`（per-call `-c user.name=...` `-c user.email=...`，避免 mutate global config）
  - `gitWorktreeAdd(repoDir, path, branch, baseRef)` / `gitWorktreeRemove(repoDir, path)` / `gitWorktreeList(repoDir)` / `gitWorktreePrune(repoDir)`
  - `gitRebase(repoDir, ontoRef)`（捕获 conflict 状态，返回 `{ ok: true } | { ok: false, kind: "conflict", details }`）
  - `gitMergeFastForward(repoDir, branch)`（fast-forward only；非 ff 直接报错）
  - `gitArchiveBranch(repoDir, branch)`（refs/ooc/rejected/{branch} 存档 + 删原 branch，对应 R8 reject）
  - `gitVerifyTreeLoadable` —— 不属于 git 命令，留给 stone-versioning 编排
- 错误形态：每个函数返回 `{ ok: true, ... } | { ok: false, code: string, stderr: string }`，绝不 silent fail（参考 `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md`）
- 不导出 raw shell helper；每个 git 子命令是单独函数，禁止 caller 自己拼

**Patterns to follow:**
- `Bun.spawnSync` 的 stdout/stderr pipe + exitCode 检查（`src/executable/windows/root/grep-impl.ts`）
- `safeObjectId` / 路径验证，所有 user-controlled string（branch name、worktree path）必须 reject `..` / 控制字符 / 空 / 过长
- 测试 `mkdtemp` + 真实 `git` 二进制（CI 必有）

**Test scenarios:**
- happy path: init → commit → diff → branch list → worktree add → worktree remove → 全过
- author 注入：commit 后 `git log --pretty=full` 拿到的作者就是传入的 objectId（按约定 `<id>@ooc.local`）
- ff merge 条件不满足时返回 ok:false code:"non-fast-forward"
- worktree path 含 `..` reject
- branch name 含空格或控制字符 reject
- rebase conflict 返回 conflict 信号、不留 dirty 工作树
- 错误 stderr 透传给 caller，不被吞

**Verification:** 该 unit 可在不依赖 stone-versioning 的情况下完成；契约稳定后 U4 才能上

---

### U4. `src/persistable/stone-versioning.ts` —— 高层编排

**Goal:** worktree open / commit / scope 评估 / merge / PR-Issue 调度 / rollback / GC 全部收口；通过 serial-queue 串行化对单 repo 的 git 操作。

**Requirements:** R3-R12 全部（核心实现）

**Dependencies:** U2（StoneObjectRef.stonesBranch）, U3（git 子命令）, U5（PR-Issue 持久化）

**Files:**
- 新增 `src/persistable/stone-versioning.ts`
- 新增 `src/persistable/__tests__/stone-versioning.test.ts`
- 修改 `src/persistable/index.ts`（导出新 API）

**Approach:**
- 主要导出函数：
  - `openMetaprogWorktree({ baseDir, objectId })` → `MetaprogWorktreeRef { baseDir, objectId, branch, path, baseCommit }`：在 `${baseDir}/stones/metaprog-{objectId}-{token}/` 处 git worktree add，base = main HEAD
  - `commitWorktree(worktreeRef, { intent: string, authorObjectId })` → `{ commitSha }`：stage all + commit，作者写 `${authorObjectId} <${authorObjectId}@ooc.local>`
  - `classifyWorktreeBranch(worktreeRef, authorObjectId)` → `"self-scope" | "cross-scope"`：调 `gitDiffNames(repo, mainRef, branchRef)`，按 R6 规则比对 `${authorObjectId}/`，Supervisor 例外（R12）
  - `tryMergeSelf(worktreeRef, authorObjectId)` → `{ kind: "merged" } | { kind: "needs-rerun"; reason } | { kind: "rebase-conflict" } | { kind: "must-pr-issue" }`：
    1. `gitRebase(repoDir, mainRef)` → conflict ⇒ `rebase-conflict`
    2. classifyBranch → cross-scope ⇒ `must-pr-issue`（caller 应改走 `requestPrIssueReview`）
    3. self-scope ⇒ caller responsibility 是先 re-run try-test；本函数只做 ff-merge：`gitMergeFastForward(repoDir, branchRef)` → ff 失败（race）⇒ caller retry
    4. ff merge 成功 → cleanup worktree → 返回 merged
  - `requestPrIssueReview(worktreeRef, { intent, authorObjectId })` → `{ issueId }`：把 diff（`gitDiffNames` 列名 + `git format-patch` patch 文本）+ intent + branchRef 打包，交给 issue-service 在 `flows/super/issues/` 创建 Issue（U5）
  - `resolvePrIssue({ issueId, decision: "merge" | "reject" | "request-changes" })` → 根据 decision 推进 worktree 命运（merge → ff-merge；reject → archive-and-remove；request-changes → 保留）
  - `rollback({ baseDir, objectId, targetCommit, supervisorAuthor })` → `{ commitSha }`：在 stones/main 工作树上 `git checkout {targetCommit} -- {objectId}/`，commit 时 author = supervisor（R4 例外）
  - `pruneStaleWorktrees(baseDir)` → 启动 hygiene：列 worktree、删除 already-merged-and-archived 的、删除 24h+ 未活动且无关联 PR-Issue 的
  - `mainRef(repoDir)` 内部 helper（解析 `refs/heads/main`）
- **所有上述函数体统一通过 `enqueueSessionWrite("git:" + baseDir, async () => { ... })` 包一层**，保证同 repo 串行
- **Supervisor 例外**：`classifyWorktreeBranch` 在 authorObjectId === "supervisor" 时直接返回 self-scope；`tryMergeSelf` 对 Supervisor 不开 worktree 也合法（Supervisor 直写 stones/main/supervisor/ 即可，本期约定）
- **不暴露的私有函数**：worktree 命名（`metaprog-{objectId}-{ulidLike}`）、archived ref 命名（`refs/ooc/rejected/{branchName}`）、author email 拼接，等

**Technical design (sketch — directional):**

```text
type MetaprogWorktreeRef = {
  baseDir: string
  objectId: string         // 创建者
  branch: string           // metaprog-{objectId}-{token}
  path: string             // ${baseDir}/stones/${branch}
  baseCommit: string       // 创建时的 main HEAD SHA
}

state machine of MetaprogWorktreeRef.branch:
  draft (created, not yet committed)
    ─ edit/commit ─▶ submitted-self-scope ▶ tryMergeSelf
                    │                       ├ rebase-conflict ▶ draft (Object 重决策)
                    │                       ├ needs-rerun     ▶ draft
                    │                       └ merged          ▶ <gone, worktree pruned>
                    └ submitted-cross-scope ▶ requestPrIssueReview ▶ pr-pending
  pr-pending
    ─ resolve(merge)            ▶ merged ▶ <gone>
    ─ resolve(reject)           ▶ rejected ▶ <archived under refs/ooc/rejected/, worktree pruned>
    ─ resolve(request-changes)  ▶ draft (Object 继续编辑同 worktree)
```

**Patterns to follow:**
- `enqueueSessionWrite` 用法见 `src/persistable/issue-service.ts`
- 错误对象同 U3：永远 `{ ok, code, ... }` 不 throw 子进程结果
- 测试 `mkdtemp` + 真 git 二进制 + `__resetSerialQueueForTests()`

**Test scenarios:**
- **Covers AE1.** Object A 在自治区内编辑、commit、merge → main 上多一个由 A 署名的 fast-forward commit；不开 PR-Issue
- **Covers AE2.** Object A commit 内同时改 A 自治区文件与 B 自治区文件 → tryMergeSelf 返回 must-pr-issue → requestPrIssueReview 创建 Issue → main 不变
- **Covers AE3.** PR-Issue resolve(reject) → branch 被存档到 refs/ooc/rejected/，worktree 销毁，main 不变
- **Covers AE6.** Object A 与 Object B 同时从 main@C0 开 worktree；A 先 merge 推到 C1；B tryMergeSelf 触发 rebase（rebase 期间 main 已飘）→ Object B 拿到 needs-rerun 信号
- **Covers AE7.** Branch 95% 在自治区、5% 越界 → branch 累积 diff vs main 含越界文件 → cross-scope，整 branch 走 PR-Issue（不存在"自治区那 95% 单独 merge"的路径）
- **Covers AE8.** Supervisor 直接修改 stones/main/supervisor/self.md（不开 worktree）→ 不报错，对应 R12 的"不参与 R5 协议"约定
- **Covers F3 / R10.** `rollback({ objectId: agent_of_X, targetCommit })` → main 上多一个 author=supervisor 的 commit，agent_of_X stone 内容回到 targetCommit 状态
- 并发：两个 tryMergeSelf 调用通过 serial-queue 串行；同 baseDir 任意两次 git 操作不交错
- rebase conflict（mock：手动构造一个 cross-branch 改同文件场景）→ 返回 rebase-conflict、无 dirty 工作树留下
- pruneStaleWorktrees：mock 出 worktree 列表 + 时间戳 → 正确分类应保留 / 应删除
- 路径校验：worktree path 越出 baseDir → reject

**Verification:** 配套 e2e（U9）跑通 AE1-AE8 全部场景

---

### U5. PR-Issue 持久化（super-session 复用）+ payload 扩展

**Goal:** PR-Issue 落在 `flows/super/issues/`（super session 不被清理，天然长寿）；扩展 Issue payload 携带 diff + worktree branch + intent；不引入新 ContextWindow 类型。

**Requirements:** R7, R8, R9 (see origin)

**Dependencies:** U2

**Files:**
- 修改 `src/persistable/issue.ts`（Issue 增加 optional 字段：`prPayload?: { diff: string; branch: string; intent: string; baseDir: string }`，向后兼容）
- 修改 `src/persistable/issue-service.ts`（暴露一个 `createPrIssue({ baseDir, sessionId="super", title, prPayload, createdByObjectId })` 便利函数；底层仍走 `createIssue`）
- 修改 `src/persistable/__tests__/issue.test.ts` / `issue-service.test.ts`（payload roundtrip + super session 隔离测试）
- 评估是否需要在 `IssueIndexEntry` 加 `kind: "regular" | "pr"` 让 list 视图区分（v1 可不加，标题加 prefix `[PR]` 即够）

**Approach:**
- Schema：`Issue` 现有字段保留；新增 `prPayload` 是 optional discriminator；非 PR 类 issue 该字段 undefined
- 写入路径仍是 `flows/{sessionId}/issues/issue-{id}.json`，对 PR-Issue 强制 sessionId="super"
- 读路径：通过现有 `findIssueSubscribers(baseDir, "super", issueId)` 即可被 Supervisor super flow 看到（mention / inbox 机制不变）
- 4KB 单条 comment 限制保留；diff 文本可能超限 → 放 prPayload（不计入 comment 限制）
- payload 验证：diff 非空字符串、branch 命名格式（同 U3 校验）、intent 合理长度（< 4KB）—— 验证不过抛错而非静默吞
- 不破坏现有 IssueWindow 渲染：UI 端若读到 `prPayload` 仍照常渲染 title/comments，prPayload 暂作为附加 metadata 不渲染（v1 不上 UI；UI 后续单独迭代）

**Patterns to follow:**
- 现有 `createIssue` 接口 + `enqueueSessionWrite("super", ...)` 串行
- 错误 message 包含字段名 + 期望形态（同 `llm-tool-handlers-fail-loud` 模式）

**Test scenarios:**
- happy path: createPrIssue → getIssue 取回 prPayload 字段一致
- super session 文件实际位置：`flows/super/issues/issue-{id}.json` 存在
- payload 验证：缺 diff / 越界 branch 名 / 超长 intent → reject 报错明确
- 跨 session 读：在不同 sessionId 下 listIssues("super") 仍能列到 PR-Issue（验证 super 是世界级长寿）
- 兼容旧 Issue：现有不带 prPayload 的 issue.json 仍能被读出且 prPayload === undefined

**Verification:** `bun test src/persistable/__tests__/issue*.test.ts` 全过

---

### U6. HTTP 与 LLM 写入面收口 + 回滚入口

**Goal:** 让 Object 元编程协议有具体的 server-side 入口；维持现有 `root.write_file` 行为（写入 `stones/{branch}/` 当前对应文件）；回滚作为 server method 暴露给 Supervisor。

**Requirements:** R10 + 实现 F1/F2/F3 在主 Server 上的可调用面 (see origin)

**Dependencies:** U2, U4

**Files:**
- 修改 `src/executable/windows/root/write-file.ts`：currently `path` 是 `stones/<self>/<...>`；新代码下，`path` 仍是 `stones/<self>/<...>`（LLM prompt 接口不变），底层映射到 `stones/${stonesBranch}/${self}/<...>` —— 即 baseDir 下绑定的当前 server stones-branch；这样 Object 在主 Server（main）写就是写 main 工作树，在 metaprog 子 Server 写就是写那个 worktree
- 新增 `src/executable/windows/root/metaprog-merge.ts` —— 一个 root.* 命令 / server method，签名约：`metaprog_merge({ branch })`：
  - 调用 `stoneVersioning.tryMergeSelf({ baseDir, branch, authorObjectId: caller.id })`
  - 返回 `{ kind, ... }` 对应 stone-versioning 的状态机
- 新增 `src/executable/windows/root/metaprog-rollback.ts` —— 仅 Supervisor 可调（`if caller.id !== "supervisor": reject`）
- 修改 `src/app/server/modules/stones/service.ts`：现有 `PUT /stones/:id/...` 路由的写入端调用既有 `writeSelf` / `writeServerSource` 等 helper —— 这些 helper 已经被 U2 改造为按 stonesBranch 读写。本 unit 不再额外加 worktree 路由层；HTTP 控制面在哪个 server-branch 启动就改哪个 server-branch 的 stones（与 LLM 写入对称）
- 新增 `src/executable/windows/root/__tests__/metaprog-merge.test.ts`

**Approach:**
- write_file 不需要"路径感知 worktree"——通过启动期 `--stones-branch` 已经决定写入哪个工作树，所以 root.write_file 的修改是机械的（拼接 stonesBranch 进路径而已）
- metaprog_merge / metaprog_rollback 是 Object 协议的最小机械入口；其他细节（如何开 worktree、何时调 merge）由 reflectable knowledge（U7）告诉 LLM

**Test scenarios:**
- write_file 写到 stones-branch=main 的 server → 文件确实落在 `${baseDir}/stones/main/${self}/...`
- write_file 写到 stones-branch=metaprog-foo 的 server → 文件落在 `${baseDir}/stones/metaprog-foo/${self}/...`
- write_file 试图越出当前 stones-branch（比如显式 path 含 `../main/`）→ reject 路径越界
- metaprog_merge 走 self-scope → 成功 merge，main HEAD 推进；调用方拿到 merged
- metaprog_merge 走 cross-scope → 拿到 must-pr-issue + Issue id（caller 在 LLM 侧用这个 id 等待 Supervisor 决议）
- metaprog_rollback 由非 supervisor 调用 → reject 401-style 错误，main 不变
- metaprog_rollback 由 supervisor 调用 → main 上多一个 author=supervisor 的 commit，agent_of_X stone 回到目标 commit

**Verification:** 在 .ooc-world-test 实际跑一次 metaprog_merge / metaprog_rollback；HTTP API roundtrip 保留

---

### U7. Reflectable knowledge：元编程协议指引

**Goal:** 在 super flow 中给 LLM 注入"如何走 worktree 协议"的提示词，包括：开 worktree 的 shell 命令、启动子 OOC Server 验证的命令、调 metaprog_merge 的方式、PR-Issue rejection 的恢复方式、recovery 触发方式（仅 Supervisor）。

**Requirements:** R3 试运行入口的"reflectable knowledge"形态 (see origin user decision Q2)

**Dependencies:** U6（让 reflectable 引用的命令真的存在）

**Files:**
- 修改 `src/thinkable/reflectable/reflectable-knowledge.ts`（在现有 super-flow knowledge bundle 中新增 `metaprog-protocol.md` 内容片段或独立节点）
- 新增 `src/thinkable/reflectable/__tests__/metaprog-knowledge.test.ts`（验证内容被注入 super flow context 且不重复）
- 可能新增 `meta/object.doc.ts` 节点描述 reflectable 维度新增的 metaprog 协议引导（详见 U8 一并改 meta）

**Approach:**
- knowledge 内容（中文，给 super flow 的 LLM）覆盖：
  1. 何时开 worktree：决定改 self.md / server / knowledge/* 等"身体"性文件时
  2. 开 worktree 的 shell：`git -C .ooc-world-test/stones worktree add metaprog-{my-id}-{token} -b metaprog-{my-id}-{token} main`
  3. 写 worktree：写 `stones/metaprog-.../{self}/<path>`（直接 fs 写 / shell tee）
  4. 启动子 Server 试运行：`bun run src/app/server/index.ts --world ./.ooc-world-test --stones-branch metaprog-{...} --port 0`，访问 http://localhost:{port}/ ... 验证
  5. 请求 merge：调 `metaprog_merge` server method
  6. PR-Issue 状态读取：通过 IssueWindow（已有机制）观察 Supervisor 决议
  7. Recovery（仅 Supervisor）：`metaprog_rollback({ objectId, targetCommit })`
- 注意：不重复实现命令，knowledge 文档只描述协议；命令真实可调由 U6 保证

**Patterns to follow:**
- `src/thinkable/reflectable/reflectable-knowledge.ts:14` 已有 `REFLECTABLE_BASIC_PATH = "internal/executable/reflectable/basic"` —— 新增另一条 path 或扩同一条
- `src/thinkable/knowledge/synthesizer.ts:29` super session injection gating 已有 —— 新内容只在 super flow 注入

**Test scenarios:**
- knowledge 内容在 super session（sessionId="super"）的 thread context 中存在
- 非 super session 的 thread 不注入
- 内容包含每条命令模板（at least 检查 keywords：`worktree add`, `--stones-branch`, `metaprog_merge`）
- snapshot 测试防止意外删改

**Verification:** 跑一次 super flow 在 LLM context 中能看到指引

---

### U8. 启动期 Recovery 自检 + meta/*.doc.ts 文档同步

**Goal:** Server 启动时 loader 试加载所有 stones/main/{objectId}/server/index.ts；失败的 Object 写一条 PR-Issue（kind=`recovery-needed`）让 Supervisor 看到。把整个新能力写进 meta 知识图谱并通过 `bun tsc --noEmit` 校验。

**Requirements:** F3 trigger surface + AGENTS.md 的 meta-doc 约束

**Dependencies:** U4（rollback 函数）, U5（PR-Issue 通道）, U7（recovery 命令在 reflectable knowledge）

**Files:**
- 修改 `src/app/server/index.ts`（boot 序列追加 recovery 自检步骤，在 U1 git auto-init 之后跑）
- 新增 `src/app/server/bootstrap/recovery-check.ts`
- 新增 `src/app/server/bootstrap/__tests__/recovery-check.test.ts`
- 修改 `meta/object.doc.ts`：在 persistable 维度子节点下加 `stone-versioning` 概念，sources 引用 `src/persistable/stone-versioning.ts`、`src/persistable/stone-git.ts`；在 programmable 维度引用 R3 worktree 沙箱的协议；在 reflectable 维度引用 metaprog-protocol knowledge
- 修改 `meta/engineering.harness.doc.ts`：Supervisor 角色追加"PR-Issue 评审 + recovery 触发"职责
- 验证：每改一个 `meta/*.doc.ts` 立刻 `bun tsc --noEmit meta/<file>.doc.ts`（per AGENTS.md memory）

**Approach:**
- Recovery 自检逻辑：遍历 `stones/main/` 下所有 agent_of_*/，对每个 try `loadServerEntry({ baseDir, stonesBranch: "main", objectId })`；catch import error → 记录到 `BrokenObjectReport[]`
- 报告动作：每个 broken Object 创建一条 PR-Issue（标题 `[recovery-needed] {objectId} stone unloadable`，prPayload 留空，body 描述 import error + 建议 candidate commits 列表）
- 不自动回滚——回滚需要 Supervisor 决策（避免破坏审计承诺）
- 自检不阻塞 server 启动：失败的 Object 仍可被列出但不参与超流（worker 跳过）；Supervisor 通过 super flow 看到 PR-Issue 后调用 `metaprog_rollback`

**Patterns to follow:**
- `loadServerEntry` 已有 mtime+缓存语义（`src/executable/server/loader.ts`）
- `meta/*.doc.ts` 的 DocTreeNode + sources 模式：source 是 `[any, string]`，单条不堆叠（per memory）

**Test scenarios:**
- Object 的 server/index.ts 抛 import error → 启动后 `flows/super/issues/` 多一条 [recovery-needed] PR-Issue
- 没有 broken Object → 不创建 noise issue
- 同一 Object 反复 broken（重启）→ 不创建重复 PR-Issue（去重 by title 或 ojectId+state hash）
- meta/object.doc.ts 修改后 `bun tsc --noEmit meta/object.doc.ts` 通过

**Verification:** 启动一个 fixture world，故意把 `stones/main/agent_of_thinkable/server/index.ts` 写坏 → boot 自检产出 PR-Issue；修复后下次启动不再产出

---

### U9. End-to-end 场景（与 origin 的 8 个 AE 一一对应）

**Goal:** 对照 origin 的 AE1-AE8 写成 `tests/e2e/` 层场景，覆盖 plan 的产品行为（不只是单元行为）。Backend 用 `app.handle` 直调，git 副作用从真实 `.ooc-world-test/`（test fixture）观测。

**Requirements:** AE1-AE8 (see origin)

**Dependencies:** U1-U8 全部

**Files:**
- 新增 `tests/e2e/backend/stones-versioning.e2e.test.ts`
- fixture：`tests/e2e/fixtures/stones-versioning-world/`（一份预制最小 world dir，含 2 个 Object）

**Approach:**
- 每个 AE 一个 `test()`，用 fixture 复制到 tmp、`Bun.spawn` 跑 server 或直接 `app.handle`
- 断言点放在 git 状态（`gitLog`、`gitDiff`）+ Issue 文件 + stone 文件内容
- 失败信息要明确（per `meta/engineering.testing.doc.ts` 的三档评分约定）

**Test scenarios:**
- **Covers AE1.** 自治区写入 → fast-forward merge → main HEAD 前进，无 PR-Issue
- **Covers AE2.** 跨 Object 修改 → tryMergeSelf 返回 must-pr-issue → flows/super/issues/ 出现 [PR] issue
- **Covers AE3.** Supervisor 标 reject → branch 在 refs/ooc/rejected/，worktree 销毁，main 不变
- **Covers AE4.** 模拟 Object self.md 写坏 → recovery-needed PR-Issue → metaprog_rollback by supervisor → main HEAD 上 author=supervisor 的回滚 commit
- **Covers AE5.** flows/{flowId}/ 写文件 → `git -C stones status` 不报告该路径
- **Covers AE6.** 两 Object 并发 metaprog → 第二者拿 needs-rerun 信号，main 上有且仅有第一者的 commit
- **Covers AE7.** 单 commit 95% 自治区 + 5% 越界 → 整 branch 走 PR-Issue，自治区合法部分不被单独 merge
- **Covers AE8.** Supervisor 直写 stones/main/supervisor/self.md → 不报错、不开 PR-Issue

**Verification:** `bun test tests/e2e/backend/stones-versioning.e2e.test.ts` 全过；新增到 CI 的 backend e2e 脚本（`bun test:e2e:backend`）入口

---

## Scope Boundaries

继承 origin 的 Scope Boundaries 全部，并加：

- 不引入 git npm 依赖；用 `Bun.spawnSync(["git", ...])`，与 `src/executable/windows/root/grep-impl.ts` 同款
- 不引入 per-Object 独立 git 仓库（origin 已有；此处 reaffirm，因为 stones/{branch}/ 嵌套布局可能让人误以为 per-branch 是 per-repo）
- 不在 v1 给 PR-Issue UI 端做 prPayload 渲染；UI 看到 [PR] 标题前缀 + comments 即可
- 不实现 request-changes 的主动 Notification；Object 通过下次 super flow 看到 IssueWindow 状态变化即可（origin Outstanding Question R8 deferred 已锁定此简单形态）
- 不实现 worktree 的 quota / 数量限制；启动期 GC 是唯一节流（origin Outstanding Question 中 worktree 形态分流推迟）

### Deferred to Follow-Up Work

下列 origin 的 Deferred to Planning 项目本计划不消化，留给后续 PR：

- 元编程形态分流（memory append 走轻量直写 vs 重操作走 worktree）—— 本期一刀切都走 worktree
- "OOC 身份取向声明"作为 Key Decision 显式签字 —— 文档动作，非代码
- 回滚后 reflectable 学不到教训的诊断上下文 —— 需要先有跑数据再决策
- Problem Frame 三痛点单独核算 —— 评估性工作，不影响本期实现
- 路径划界 schema 依赖（B 修正 A 看 B 的不对称）—— 本期接受现状
- stones/ 根级共享文件特例 —— 当前没有这种文件
- A3 命名"子系统"会被翻译为新模块的风险 —— 本计划用函数级实现已规避

---

## Key Technical Decisions

- **stones/ 嵌套 worktree 布局（用户决策）**：原 `stones/agent_of_X/` 改为 `stones/{branch}/agent_of_X/`，git repo 在 `stones/.git/`。让 worktree == 独立 stones 树，无需任何 baseDir 重定向；`--stones-branch` 启动参数完成多实例隔离。
- **PR-Issue 落 super session（用户决策）**：`flows/super/issues/`。super session 不被清理，天然世界级长寿；复用现有 issue-service.ts 路径，不引入新持久化层。
- **试运行入口 = reflectable knowledge（用户决策）**：不暴露 server method 给 LLM 直接调用 try-run；teach 协议、由 Object 自行 shell 启动子 Server。最小代码面，最大 Object 自主。
- **scope 评估单位 = branch 累积 diff vs main merge-base（用户决策）**：与 GitHub PR 语义一致；Object 中间过程（试错的 cross-scope 中间 commit）不被 over-审，最终落地形态是评判依据。
- **A3 实现形态 = persistable 内的两个文件 + 函数集（不是新模块）**：`stone-git.ts`（git CLI 薄包装）+ `stone-versioning.ts`（高层编排）。沿用 issue.ts / issue-service.ts 的 schema/service 双文件惯例。
- **不引入 git 依赖**：`Bun.spawnSync` 沿用现有 process spawning 模式（`src/executable/program/shell.ts`、`src/executable/windows/root/grep-impl.ts`）；环境上已假设 `git` CLI 可用（OOC 仓库本身就要求）。
- **commit author 用 per-call -c 注入**：`git -c user.name=<id> -c user.email=<id>@ooc.local commit` —— 不污染全局 git config，作者署名直接走 git 工具链。
- **git 操作通过 `enqueueSessionWrite("git:" + baseDir, ...)` 串行**：复用 `src/persistable/serial-queue.ts` 现有原语，单 repo 内 git 命令严格串行；无需新增锁。
- **fast-forward only + rebase 重做试运行（origin Resolve-Before-Planning #1）**：`tryMergeSelf` 失败信号化（rebase-conflict / needs-rerun / must-pr-issue），交还 Object 决定下一步；A3 不做无界重试。
- **整 branch 走 PR-Issue（origin Resolve-Before-Planning #4）**：reject 时连带丢自治区合法部分；branch 在 `refs/ooc/rejected/{name}` 存档而非硬删，便于 Object 后续 diff 追溯。
- **Recovery commit by Supervisor（origin Resolve-Before-Planning #2）**：R4 例外条款；启动 recovery 自检产出 PR-Issue 让 Supervisor 决策。
- **Bootstrap 自动 init by `bootstrap` 身份（origin Resolve-Before-Planning #3）**：squash 一次性 commit，author = `bootstrap <bootstrap@ooc.local>`，分支 `main`。
- **Supervisor 元自治例外（origin Resolve-Before-Planning #6 + R12）**：Supervisor 不开 worktree、不走 R5 协议；直接修改 stones/main/supervisor/。本计划在 stone-versioning 入口检查 `objectId === "supervisor"` 直接返回 self-scope 并允许直写。

---

## System-Wide Impact

- **persistable 层**：新增 stone-git.ts / stone-versioning.ts；issue.ts 加可选字段；StoneObjectRef 加 stonesBranch；stoneDir / 各 stone-*-helper 路径解析改造。**所有 ref 创建处都受影响**——这是最大改动面。
- **executable 层**：write_file / loader 间接受影响（路径多一层 stonesBranch）；新增两个 root.* 命令（metaprog_merge / metaprog_rollback）。
- **app/server 层**：bootstrap 序列加 git auto-init + recovery 自检；config 加 --stones-branch flag；HTTP routes（modules/stones）写入路径自动落到当前 server 绑定的 stones-branch。
- **thinkable 层**：reflectable knowledge 增加元编程协议条目（仅在 super session 注入）。
- **meta/**：新增 stone-versioning 概念节点 + Supervisor 角色补充。
- **runtime（worker / job-manager）**：传递 stonesBranch 字段到 RuntimeJob；其它逻辑不变。
- **测试**：persistable __tests__ 大量受 stoneDir 路径变更影响；新增 e2e 场景。
- **现有 .ooc-world-test 数据迁移**：仓库 dev 状态的 `.ooc-world-test/stones/agent_of_*/` 需要一次性移到 `stones/main/agent_of_*/`，再 `git init`。脚本式迁移建议作为 U1 实施时的一次性操作（开发者本机）。

---

## Risk Analysis & Mitigation

| 风险 | 严重 | Mitigation |
|---|---|---|
| **路径迁移破坏现有功能**：stones/{objectId}/ → stones/main/{objectId}/ 的改造涉及全仓 ref 创建处 | 高 | U2 单独立项；改完跑一遍现有测试套 + e2e 全套；先用 `find . -name '*.ts' \| xargs grep -n 'stones/'` 列举所有硬编码路径 |
| **bun 与 git 子进程交互未知坑**：origin 已 flag `git worktree under bun` | 中 | U3 单元测试覆盖每个子命令；CI runner 上跑（CI 必有 git 二进制）；如发现 bun spawn 行为异常，降级 spawnSync |
| **多 worktree 场景下 git 自身 race**：多个 server 实例并发对同 .git/ 操作 | 中 | enqueueSessionWrite 只覆盖本进程内；跨进程依赖 git 自身 lock（git 一直对 ref 操作有 lock 文件）；e2e 场景验证两实例并发 |
| **bootstrap 误把无关文件吞进 commit**：用户的 `.ooc-world-test/` 可能有遗留状态 | 低 | bootstrap 检测 dirty tree 时落 warning 日志；不是静默吞 |
| **PR-Issue 在 super session 长寿但旧 issue 累积**：long-running OOC world 会让 flows/super/issues/ 单调增长 | 低 | 现有 Issue 关闭 / 列表分页机制即可；本期不做特殊清理 |
| **reflectable knowledge 漂移**：协议 prompt 与实际命令不同步 | 低 | U7 加 snapshot 测试；U6 + U7 同 PR 落地 |
| **AE2 / AE7 越界场景的实际触发概率**：本期承诺整 branch 走 PR-Issue 即使 95% 在自治区 | 中（产品） | 接受（origin 已用户决策）；future work 视实际跑数据再考虑 hunk 级评审 |
| **Recovery 自检覆盖面有限**：只测 server/index.ts 加载；self.md 语义破坏检测不出 | 中 | 本期接受；未来可加 self.md schema 校验 |

---

## Alternative Approaches Considered

- **Per-Object git repo（一对一）**：拒绝。"cross-scope" 概念在多 repo 下无法自然表达；origin Key Decision 已锁定单 repo + 路径划界。
- **不用 git，自建 snapshot 机制（cp -r 快照 + 简单元数据）**：拒绝。worktree 的"独立 world 跑独立实例"能力是核心差异化（用户 Q4 答复直接在此基础上设计了目录布局），自建 snapshot 不天然给出可单独 cd 进去启 server 的隔离工作树。
- **Loader 重定向到 worktree 路径**（在同一进程持有两份 server 实现）：拒绝。bun import 缓存按物理路径 keyed，技术上能跑，但代价是两份实例的 jobManager / pauseStore / pauseStore 共享同进程 → 状态污染风险高。改走"启动子 OOC Server"是物理隔离，更稳。
- **PR-Issue 落世界级 .ooc-world-test/issues/（不入 git）**：拒绝（用户 Q1 选 super session）。复用 super session 比新建持久化目录代码量小。
- **新增 ContextWindow 类型 review_window**：origin 已拒绝。
- **branch-net-diff vs per-commit scope 评估**：本计划选 branch-net-diff（用户 Q3）；per-commit 会让中途越界的实验性 commit 卡住整个 branch，与 Object "试错" 精神冲突。
- **root.write_file scope-aware（写到 stones/<self>/ 触发隐式 worktree）**：拒绝（用户 Q4 选了重构布局而非 write_file 加感知）。重构后 write_file 行为最简单：写当前 server 绑定的 stones-branch 工作树，no special cases。

---

## Phased Delivery

建议按 U-ID 顺序串行落地，每个 U 一个 PR：

- **Phase A（基础设施）：U1 → U2 → U3** —— 这三个 unit 必须串行，因为 U2 依赖 U1 布局、U3 依赖 U1 git repo
- **Phase B（核心逻辑）：U4 ← U5（并行）** —— U4 与 U5 在 U2/U3 落地后可并行；U4 需要在自己的 PR 里 stub U5 的 createPrIssue
- **Phase C（入口与文档）：U6 → U7 → U8** —— U7 引用 U6 的命令；U8 引用 U4/U5/U7
- **Phase D（验证）：U9** —— 全 unit 落地后跑 e2e 场景

每个 unit PR 都要求自带 unit 测试通过；e2e（U9）在 Phase D 一次性收口。

---

## Dependencies / Assumptions

继承 origin Dependencies/Assumptions 全部。补充：

- 假设 CI 环境与开发环境都有 `git` CLI（OOC 仓库本身依赖 git，已成立）
- 假设 bun 1.x 的 `Bun.spawnSync` 行为稳定（已被既有 grep-impl / shell-program 路径验证）
- 假设 super session 持续存在（不被代码清理）—— 这是 OOC 设计的既有约定，本计划进一步依赖之
- 假设外层 OOC 源码仓库的 `.gitignore` 已包含 `.ooc-world-test/`（已验证：`/Users/bytedance/x/ooc/ooc-2/.gitignore`），新生成的 `.ooc-world-test/stones/.git/` 不会污染外层
- 假设所有 OOC Server 实例（含子 Server）都通过 `--world` 显式指定同一 `.ooc-world-test/`，否则 `.git/` 不在同一个 world 内会破坏 worktree 一致性

---

## Outstanding Questions

### Resolve Before Implementation

无。

### Deferred to Implementation

- [Affects U1][Technical] dev 状态下现有 `.ooc-world-test/stones/agent_of_*/` 迁移到 `stones/main/` 的脚本形态：手动 `mv` 还是写一次性 migration 命令；与 git init 的执行顺序需要细化
- [Affects U3][Technical] `gitArchiveBranch` 实现细节：是 `git update-ref refs/ooc/rejected/{name} {sha} && git branch -D {name}` 还是用 reflog 标记
- [Affects U4][Technical] `pruneStaleWorktrees` 的 24h-since-last-touch 判定数据来源：mtime of worktree dir 还是 reflog；如何记录 worktree 关联的 PR-Issue id
- [Affects U6][Technical] 子 Server `--port 0` 后 Object 怎么知道实际 port：spawn 后读 stdout 还是 file-based handshake
- [Affects U7][Technical] reflectable knowledge 的内容长度——会占 super flow context window 多少 token；是否需要按用法分段加载
- [Affects U8][Technical] meta/object.doc.ts 节点放在 persistable 维度子节点哪一层：是 `persistable.stone.versioning` 还是新顶级 child；遵循现有 doc 树形深度约定
