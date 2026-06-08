# 去除 metaprog,统一为「session worktree + super flow 唯一合入闸门」

> 设计裁决（Supervisor，2026-06-09）。动方向：**只保留一套 worktree 机制**——LLM 在 session 内的所有 stone 写都落 `flows/<sid>` 的 session worktree，合入 main 统一经 super flow 判断；删除并行的 metaprog worktree 写路径。
>
> 前置回顾：`docs/2026-06-05-stone-flow-overlay-versioning-design.md`（session-worktree 统一模型）、`docs/ooc-6/reflectable/2026-06-06-iteration-01.md`（evolve_self 即演化单元）。

## 1. 决策记录

| 分叉 | 决策 | 理由 |
|------|------|------|
| LLM session 内的写（改自己 / 建别人 / 改别人） | 全落 `flows/<sid>` session worktree，**不 commit、不立即落 main** | 单一落点；worktree 隔离本就是为 LLM 试验服务 |
| 合入 main 的闸门 | **唯一**经 super flow（`evolve_self`），由它分类 self-scope ff-merge / cross-scope PR-Issue | 「哪些合、怎么合」收敛到一处 |
| session 未 evolve 即被 GC | 改动随之丢失，**不做防丢机制** | 用户明确接受；session 是 ephemeral 试验层，要保留就走 super flow |
| HTTP 控制面写（人类前端保存 self/readable/executable，无 session） | **直接 commit main，立即生效，不开 worktree** | 人类经控制面的编辑即「已决策/已评审」操作，所见即所得，不需隔离与评审 |

## 1bis. 物理布局裁决（方案 A，2026-06-09 确认）

session worktree 的物理位置与时机：

- **`flows/<sessionId>` 目录本身 = 从 `stones/main` 派生的 git worktree 分支**（取代当前 `stones/session-<sid>`）。
- **eager**：session 创建即 `git worktree add flows/<sid>` checkout main 全部文件 → 名副其实「session 一开始就有 main 全部文件」。取代当前 lazy 建。
- **运行时数据与 tracked stone 文件共存一目录**：thread.json / inbox / context.json / thread-context.json / state.json / .flow.json / .session.json / window 目录通过 stone repo main 分支的 `.gitignore`（白名单 `objects/`、排除运行时产物）排除，不污染 `git status` / evolve diff。
- **落地约束**：`git worktree add` 要求目标空目录 → session 创建流程必须**先 `worktree add` 再写运行时数据**。
- 备选方案 B（worktree 留 `stones/session-<sid>` + `flows/<sid>` 软链接）已否决——A 更名副其实，gitignore 排除运行时是标准做法。

> 注：之前误判「flows 不能直接做 worktree，因运行时文件污染 git」——已撤回，gitignore 即可排除，不构成障碍。

## 1ter. 关联并行目标：thread context 三文件收敛（独立技术债）

调查 session 时发现的**未完成迁移技术债**，与本重构一并推进（独立线、不混改）：

- 三处存储同一份 thread context：`thread.json.contextWindows[]`（pre-P5'.1 legacy，计划 P5'.4 退役未退）/ `context.json`（P5'.1 registry，视角参数）/ `thread-context.json`（P6.§6「权威」完整落盘）。
- 实测**双写漂移**：`thread.json`(6 window) vs `thread-context.json`(5 window) 不一致；当前靠 `thread-json.ts:191` legacy fallback 把 `thread.json` 多的补回，**不立即丢数据但脆弱**——一旦按计划退役 `thread.json.contextWindows[]`，缺的 window 真丢。
- 根因：某条「往 `thread.contextWindows` 加 window」的路径没同步写 `thread-context.json`（待 research:thread-context 定位）。
- 收敛目标：`thread-context.json` 为唯一完整权威 + `context.json` 只留视角参数 + 退役 `thread.json.contextWindows[]` + 修双写不同步根因。完成 P5'.4 + §10 两笔 cleanup 欠账。

## 2. 新模型：两类写、两个落点、一个 LLM 合入闸门

```
LLM（在某 flow session 内）── write_file/edit 任何 stone ──▶ flows/<sid> worktree（plain write，不 commit）
                                                                  │
                                              super flow evolve_self（唯一闸门）
                                                                  │ tryMergeSelf 分类
                                              ┌───────────────────┴───────────────────┐
                                       self-scope（只改自己）                cross-scope（动了别人/新建对象）
                                          ff-merge → main                      PR-Issue → supervisor resolve

人类（HTTP 控制面）── PUT self/readable/server-source、createStone ──▶ 直接 commit main（立即生效）
```

- **新对象创建**：supervisor 在 session 里直接写 `objects/<newId>/{self.md,readable.md,...}` 到 session worktree → 走一次 super flow 合入（cross-scope → supervisor 自审 resolve）。取代 `create_object` 快捷命令。
- **治理能力保留**：PR-Issue 评审（`resolve`）、回滚（`rollback`）独立于写落点，保留为 super flow / supervisor 能力。

## 3. 关键洞察：底层 git 编排几乎全部保留

「去 metaprog」**不是**重写版本化内核，而是**改写入路由 + 删命令面 + evolve_self 把 cross-scope 转正**。以下底层在新模型里原样复用：

| 底层（`programmable/versioning.ts`） | 新模型角色 |
|------|------|
| `commitWorktree`（`:322` `gitCommitAll` stage 全部） | super flow commit session worktree 全部改动（含 cross-object） |
| `classifyWorktreeBranch`（`:365`）/ `tryMergeSelf`（`:405`） | super flow 合入分类：全落自治区→ff；有越界→`must-pr-issue` |
| `requestPrIssueReview` / `resolvePrIssue` / `rollback` | cross-scope 评审 + 治理 |

`evolve_self` 早已复用 `tryMergeSelf`，其 `evolve-self.ts:185` 的 `must-pr-issue` 分支注释为「理论上不该越界」——只因当前 cross-object 写被 metaprog 抢走、从不流到 session worktree。本次把那条路径**转正为一等路径**即可。

## 4. 迁移地图（逐文件）

### 改写入路由
- **`packages/@ooc/builtins/file/executable/index.ts:614`**：去掉 `isOwnStone` 门槛——**任何** stone 写（own + cross）都落 session worktree。`relWithinObject` 对 cross 用 **target objectId** 前缀计算（非 authorObjectId）。删除 `:651` 起的 `versionedStoneWrite` 分支与 `:648` fall-through。
- **`packages/@ooc/core/app/server/modules/stones/versioning-helper.ts`**：`wrapHttpWriteInWorktree` 改为**直接在 main worktree 写 + commit**（新 helper，不开 metaprog 分支）。署名仍为目标 objectId。
- **`packages/@ooc/core/programmable/versioned-write.ts`**：删除（`versionedStoneWrite` 无 caller 后移除）。

### 删命令面
- **`packages/@ooc/builtins/root/executable/method.metaprog.ts`**：删 `open_worktree` / `commit` / `merge` / `create_object` action 与 `KNOWLEDGE` 中对应教学；**保留** `resolve` / `rollback`（治理）。考虑整命令更名为治理语义（如 `govern`/`review`），命名待定。
- **`programmable/versioning.ts`**：`openMetaprogWorktree`（`:268`）、`supervisorCreateObject`（`:829`）在无 caller 后删除；保留 `commitWorktree`/`tryMergeSelf`/`requestPrIssueReview`/`resolvePrIssue`/`rollback`。

### evolve_self 转正
- **`packages/@ooc/core/programmable/evolve-self.ts`**：`evolveSelfDiff`（`:98`）的展示清单从「只扫 `objects/<self>/` 前缀」（`porcelainLineToRel:83`）改为**列全部改动**（含 cross-object），让 super flow 看见要评审什么；`:185` must-pr-issue 转正、去掉「不该越界」注释。

### 知识与文档
- **`packages/@ooc/core/thinkable/reflectable/reflectable-knowledge.ts:128`** `REFLECTABLE_METAPROG_KNOWLEDGE`：改写——不再教 metaprog worktree 四步流程；改教「直接写 → super flow 合入」。
- **`meta/object.doc.ts`** programmable/reflectable/persistable 节点：去 metaprog worktree 概念，统一表达单 worktree 模型。
- **`docs/ooc-6/index.md`** 主线 + 对应维度迭代文档追加本次记录。

### 测试
- `persistable/__tests__/stone-versioning.test.ts`（`openMetaprogWorktree`/`supervisorCreateObject` 用例）、e2e（reflectable-sediment / versioning）、storybook（reflectable/programmable/persistable stories）：迁移到新写路径与 super-flow 合入断言。

## 5. 分阶段实施（每阶段 tsc + 相关测试绿，再进下一阶段）

1. **P1 写改道**：file builtin cross-object 写落 session worktree（`index.ts:614`）；HTTP 写直 commit main（`versioning-helper.ts`）。删 `versioned-write.ts`。
2. **P2 evolve_self 转正**：`evolveSelfDiff` 列全部改动；must-pr-issue 一等化；补 cross-scope 合入 e2e。
3. **P3 命令面瘦身**：`method.metaprog.ts` 删写 action、保治理；删 `openMetaprogWorktree`/`supervisorCreateObject`。
4. **P4 知识 + 文档 + 测试**：reflectable knowledge 改写；meta/docs 更新；测试迁移；storybook 回归。

## 6. 风险与未决

1. **cross-scope 合入粒度**：`tryMergeSelf` 是**整体**分类（一个文件越界→整 branch 走 PR-Issue），不做「自己的 ff + 别人的评审」文件级拆分。决定：**先用整体分类**（含 cross-object 的 session 整体走 supervisor 评审），不引入文件级拆分（YAGNI）。
2. **HTTP 直 commit main 与 session worktree 的 base 漂移**：人类 HTTP 改 main 后，已存在的 session worktree base 落后；evolve 时 `tryMergeSelf` 的 rebase 步骤已处理（rebase main → 冲突 fail-loud）。无需额外机制。
3. **session GC 丢改动**：按决策不防丢。需确保前端/知识清楚传达「session 内改动要 evolve 才永久」，避免用户误以为已保存。
4. **`metaprog` 命名去留**：命令族瘦身后只剩治理 action，是否更名（`govern`/`review`）待 Supervisor 定，避免「metaprog」名实不符。
5. **builtin class 写**：supervisor 是 builtin class 实例，其 self 改动经 session worktree → super flow，与普通 object 同路；需在 P2 e2e 覆盖一次。

## 7. 验证

- 每阶段 `bun run check:tsc` + 对应单测；P 全完后 `bun test packages/@ooc/core packages/@ooc/builtins` 全绿 + `bun run test:storybook` 0 fail。
- 新增 e2e：①LLM 在 session 内建新对象 → super flow 合入 → main 出现该对象；②LLM 改别人 stone → super flow → PR-Issue → supervisor resolve → 合入；③HTTP PUT self → main 立即新 commit、无 worktree 残留。
- 回归：reflectable-sediment / stones-versioning e2e 适配新路径后仍绿。
