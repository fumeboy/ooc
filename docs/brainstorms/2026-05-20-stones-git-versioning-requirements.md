---
date: 2026-05-20
topic: stones-git-versioning
---

# Stones 目录的 Git 版本管理与 Object 自我编程沙箱

## Summary

为 OOC world 的 `stones/` 目录引入 git 版本管理。每个 Object 在 git worktree 中安全地试错自己的元编程修改，错了能回退；改完按路径自动判定——只动 `stones/{objectId}/` 内文件的修改由 Object 自治 merge，跨出去的修改通过 PR-Issue 提交给 Supervisor 决策。

---

## Problem Frame

OOC 把"程序性"作为 Object 的一项基础能力（programmable）：Object 可以为自己写 `stones/{objectId}/server/` 方法库、改 `self.md` / `readme.md` 身份描述、增删 `knowledge/` 内容。这意味着 Object 在 super flow 里会修改自己的"身体"。

当下 `src/persistable/stone-*.ts` 直接对 stone 文件做 fs 读写，没有任何版本机制。后果是：

- 一次错误的自我编程（写崩 `self.md`、写错 `server/index.ts`、覆盖 `knowledge/relations/{peerId}.md`）会立即生效，下一轮 super flow 启动就可能跑不起来或行为漂；
- 没有可观察的轨迹：Object 改了什么、为什么改、什么时候改的，无从回看；
- Agent 没有"试一下不行就退回"的安全空间——元编程是高赌注操作，每一次都直接落地 main state；
- 多个 Object 并发修改 stones/ 时（特别是涉及彼此 relation 文件的交叉修改）没有任何冲突感知或仲裁。

元编程是 OOC 自举（dogfooding）的核心动作；要让 Agent 自我演化变成日常操作而不是一次性的危险动作，需要一层隔离与可恢复机制。

---

## Actors

- A1. **OOC Object（agent_of_X / supervisor 等）**：在 super flow 中产生元编程意图，开 worktree、改自己 stone 文件、提交 commit；自治区内自行 merge，跨界则发起 PR-Issue。
- A2. **Supervisor（在 Object 形态下也是一个 Object）**：接收跨界修改的 PR-Issue，审阅 diff 与意图，决定 merge / reject / 要求修改。
- A3. **Stone Versioning 子系统**：persistable 维度新长出的子组件，封装"开 worktree / 提交 / 判定路径范围 / 自治 merge / 发 PR-Issue / 回滚"的原子操作，对 Object 提供能力，对 git 屏蔽细节。

---

## Key Flows

- F1. **自治区元编程**
  - **Trigger:** Object 在 super flow 中决定修改自己的 stone（如改写 `self.md`、新增一个 server 方法）
  - **Actors:** A1, A3
  - **Steps:**
    1. Object 通过 A3 从 main 当前 commit 开一个 worktree branch（等价于一份独立的 world 目录）
    2. 在 worktree 内编辑 `stones/{objectId}/` 下的文件
    3. （可选）启动一个独立 OOC 实例指向该 worktree 目录，加载、调用、试运行修改后的 server 方法以自我验证
    4. Object 通过 A3 把 worktree 内的变更 commit，作者为该 Object
    5. A3 检查 commit 的 diff 路径是否完全落在 `stones/{objectId}/` 内
    6. 落在自治区内，A3 把 worktree branch rebase 到 main HEAD（fast-forward only）；rebase 后若 base 已飘，Object 重做一次试运行确认结论仍成立
    7. fast-forward merge 进 main
  - **Outcome:** main 推进一个由该 Object 署名的 fast-forward commit；下一轮 super flow 看到的就是新版本的 stone
  - **Covered by:** R3, R4, R5, R8

- F2. **跨界元编程的 PR-Issue 评审**
  - **Trigger:** Object 的 commit diff 触及了 `stones/{objectId}/` 之外的任何路径（即使大部分 hunk 在自治区内，整 commit 也视为越界）
  - **Actors:** A1, A2, A3
  - **Steps:**
    1. Object 在 worktree 内完成编辑与 commit（与 F1 步骤 1–4 相同）
    2. A3 检查 diff 路径，发现越出自治区，拒绝直接 merge
    3. A3 向 Supervisor 发起一个 PR-Issue，载荷为 diff、Object 的修改意图说明、worktree branch 引用 （这个 issue 仍然在 super 这个 session 内）
    4. Supervisor 在自己的 super flow 中读到该 Issue，审阅 diff 与意图
    5. Supervisor 把 Issue 解决为 merge / reject / request-changes
    6. A3 根据 Issue 的解决状态推进或丢弃 worktree（reject 时整 commit 丢弃，包括其中的自治区合法部分）
  - **Outcome:** 跨界修改要么被 Supervisor 批准并 merge 进 main，要么被整体 reject；main 在评审期间保持不变
  - **Covered by:** R6, R7, R8, R9

- F3. **错误自我编程的恢复**
  - **Trigger:** 某个 Object 在自治区内 merge 了一次自我编程，但下一轮（或当轮后续）启动 / 运行时发现该 Object 的 stone 处于不可用状态（self.md 跑不起来、server 方法报错等）
  - **Actors:** A2, A3（Object 此时可能已加载不动，无法主动参与）
  - **Steps:**
    1. 启动器或 Supervisor 观察到 Object 处于不可用状态
    2. 通过 A3 把该 Object 的 stone 状态回滚到 main 上的某个先前 commit（仅影响该 Object 自治区内的文件）
    3. 回滚动作本身也是一个 commit，由 **Supervisor** 署名（R4 例外条款），落在自治区内，走 fast-forward merge 落到 main
  - **Outcome:** 该 Object 的 stone 恢复到先前可用状态，回滚动作本身留有以 Supervisor 署名的记录
  - **Covered by:** R4, R10, R11, R12

---

## Requirements

**仓库布局与版本范围**
- R1. `.ooc-world-test/.git/`（即 OOC world 目录自身）是版本管理的单一 git 仓库，与 OOC 源码仓库相互独立。启动时若 `.git/` 不存在，由 OOC 启动器一次性自动初始化（无需区分由谁触发）。
- R2. 只有 `stones/` 进入 git 跟踪；`flows/`、debug 文件、其他运行时产物全部 gitignore，保持瞬态。

**自治区内的元编程**
- R3. 每个 Object 都能开一个 git worktree，分支自 main 当前 commit，作为隔离的元编程沙箱。worktree 等价于一份独立的 world 目录——可被单独启动一个 OOC 实例指向它进行试运行验证（不依赖 loader 重定向）。同一 Object 多次元编程可串行使用同一 worktree 或不同 worktree，由实现决定。
- R4. Object 在 worktree 内的 commit 必须以该 Object（objectId）为作者署名，让 git 历史天然成为可归因的 Object 演化轨迹。**例外**：F3 的回滚 commit 由 Supervisor 署名（发生回滚时 Object 自身可能已加载不动，无法签名）。
- R5. 当 commit 的 diff 路径**完全**落在 `stones/{objectId}/` 内时，Object 可以将 worktree branch merge 进 main，不经任何外部审阅。Merge 必须是 **fast-forward only**：Object 在 merge 前必须先把 worktree branch rebase 到 main HEAD，并对 rebase 后的状态重做试运行；rebase 期间 main 已飘的修改若让本次 worktree 试运行结论失效，Object 须重新决策是否提交。

**跨界修改的 PR-Issue 评审**
- R6. 当 commit 的 diff 触及 `stones/{objectId}/` 之外的**任何**路径（包括其他 Object 的 stone、stones/ 根级文件等），整个 commit 视为越界——即使其中部分 hunk 在自治区内，Object 也不得就该部分自行 merge。
- R7. 此时由 Stone Versioning 子系统向 Supervisor 发起一个 PR-Issue，复用现有 Issue 机制，载荷至少包含 diff、修改意图说明、worktree branch 引用。本期不引入新的 ContextWindow 类型。
- R8. PR-Issue 的解决状态（merge / reject / request-changes）驱动 worktree 的最终命运：merge → 落到 main，reject → 丢弃 worktree（**整 commit 丢弃**，不保留任何自治区合法部分），request-changes → worktree 保持以便 Object 继续修改并重新提交。
- R9. PR-Issue 未解决期间 main 保持不变；Object 的"已经改完了"状态停留在 worktree branch 上，对其他 Object 不可见。

**回滚与恢复**
- R10. 任何 Object 都能把自己的 stone 状态回滚到 main 上某个先前 commit；回滚仅作用于该 Object 的自治区。回滚 commit 由 Supervisor 署名（见 R4 例外），其余流程仍走自治 merge 路径（fast-forward only）。
- R11. worktree 在 reject 或异常情况下可被丢弃而不污染 main；Object 的元编程"白做了"是可接受的代价。

**Supervisor 例外身份**
- R12. **Supervisor 不参与 R5 / R6 / R7 协议**：对 `stones/supervisor/` 的任何修改、以及由 Supervisor 自身发起的跨 stone 修改，均由 Supervisor 自行决定是否落地，不走 worktree+PR-Issue 流程。Supervisor 作为元审阅者，本身被授予元自治；这是本期显式信任承诺，不再寻找"审 Supervisor 的 Supervisor"。

---

## Acceptance Examples

- AE1. **Covers R5.** Given Object `agent_of_thinkable` 的 worktree 中只修改了 `stones/agent_of_thinkable/server/index.ts`，when 它请求 merge，then 直接 merge 进 main，不产生 PR-Issue，不通知 Supervisor。
- AE2. **Covers R6, R7.** Given Object `agent_of_thinkable` 的 worktree 中同时修改了 `stones/agent_of_thinkable/self.md` 和 `stones/agent_of_persistable/knowledge/relations/agent_of_thinkable.md`，when 它请求 merge，then 自治 merge 被拒绝，一个 PR-Issue 被开给 Supervisor，main 不变。
- AE3. **Covers R8, R11.** Given 一个 PR-Issue 被 Supervisor 解决为 reject，when 解决状态被观察到，then 对应 worktree branch 被丢弃（**整 commit 丢弃**，包括其中自治区内的合法 hunk），main 保持不变，发起 Object 的 stone 状态也保持不变。
- AE4. **Covers R4, R10, R12, F3.** Given Object `agent_of_executable` 最近一次自治 merge 后 self.md 处于无法 load 的状态，when Supervisor 触发对其 stone 的回滚到上一个 commit，then 它的 stone 文件恢复到上一个可 load 的版本，且这次回滚 commit 在 git 历史里留有一条以 Supervisor 署名的记录。
- AE5. **Covers R2.** Given Object 在 super flow 中向 `flows/{flowId}/` 写入运行痕迹，when 检查 git 状态，then 这些文件不被 git 跟踪，不出现在任何 commit、不参与路径范围判定。
- AE6. **Covers R5.** Given Object A 与 Object B 在 t0 同时从 `main@C0` 开 worktree，A 先完成自治 merge 把 main 推到 C1，when B 准备 merge，then A3 拒绝直接 merge 要求 B 先 rebase 到 C1（fast-forward only），B rebase 后 A3 提示 B 重做一次试运行验证。
- AE7. **Covers R6, R8.** Given Object `agent_of_thinkable` 的 commit 中 95% hunk 在 `stones/agent_of_thinkable/` 内，仅一行修改触及 `stones/agent_of_persistable/`，when 它请求 merge，then 整个 commit 视为越界，自治 merge 被拒绝，需走 PR-Issue。Object 不能就自治区那 95% 部分单独 merge。
- AE8. **Covers R12.** Given Supervisor 修改 `stones/supervisor/self.md`，when 它请求 merge，then 不走 worktree+PR-Issue 流程，由 Supervisor 自行决定是否落地。

---

## Success Criteria

- 一个 Object 能够进行一次元编程修改、观察结果、必要时回滚——整个过程不需要外部人手介入 git 命令。
- `.ooc-world-test/.git/` 的提交历史是一份按 Object 署名的演化轨迹：任何时刻可以回看"哪个 Object 在哪一刻改了自己的什么"。
- 当一个 Object 的修改触及他者的 stone 时，必然产生一个可被 Supervisor 看到的 PR-Issue；没有"安静地越界写"的路径。
- 下游 ce-plan 在不发问的情况下能直接进入实现：信任边界（路径划界）、评审通道（Issue 复用）、版本范围（stones/ only）、责任划分（自治区 Object 自负其责）都已经在文档里定下。

---

## Scope Boundaries

- 不对标 gitagent.sh / GAP 协议；只借鉴"git-native agent"的思想，不做协议兼容。
- 不做 branch-per-Agent 的并行探索 / 反事实时间旅行调试；本期只解决"自我编程出错能回退"。
- `flows/` 不进 git，super flow 的运行时痕迹保持瞬态。
- 自治 merge 不设 self-test / 编译检查 / lint 关口；Object 对自治区内的正确性承担全部责任，验证靠"启动独立 OOC 实例指向 worktree 试运行"自我兜底。
- 不为 PR-Issue 引入新的 ContextWindow 类型；评审走现有 Issue 通道。
- 不引入 per-Object 独立 git 仓库；单 repo + 路径划界。
- 不为 `stones/supervisor/` 设计审阅关口；Supervisor 是显式信任的元自治身份（R12），不寻找"审 Supervisor 的 Supervisor"。
- 不允许 self-scope merge 产生 merge commit；fast-forward only，base 已飘则强制 rebase + 重新试运行。
- 不允许"半 merge"：单 commit 内只要有一行越界就整体走 PR-Issue，reject 时整 commit 丢弃。
- 不处理 OOC 源码仓库与 OOC world（`.ooc-world-test/`）之间的同步、迁移、打包策略；两者各自独立演化。
- 不设计跨 world 的 stones 同步 / 分发 / 复制机制；本期只关注单一 world 内部的版本管理。

---

## Key Decisions

- **单 repo + 路径划界，而非 per-Object 仓库：** "cross-scope"概念在多 repo 模型下无法成立；单 repo 让所有 Object 的演化轨迹同框可读，路径划界作为权限矩阵的极简替代。
- **worktree = 独立 world 目录，启动独立 OOC 实例做试运行：** 选 git 而非自建 snapshot 机制的核心理由是 worktree 天然给出一份完整 world，可以被独立 OOC 实例指向、跑起来验证。不依赖 loader 重定向 / 不需要在同一进程持有两份 server 实现——多进程多 world 比同进程多 baseDir 便宜得多。
- **路径范围判定 = 信任范围判定：** `stones/{objectId}/` 以内是 Object 的房间，自治；以外一律走 Supervisor。这一刀比按操作类型 / 文件名模式划权简单得多。
- **Self-scope merge 是 fast-forward only：** Object merge 前必须 rebase 到 main HEAD，base 飘动后重做试运行——把"两个 Object 同时 metaprog"的并发安全完全压在 git fast-forward 语义上，不引入额外锁。代价是 R4 的 Object 署名在 merge commit 上不会被破坏（fast-forward 不产生 merge commit）。
- **混合 commit 不切片：** 单 commit 内只要触及自治区外，整 commit 走 PR-Issue；reject 时整 commit 丢弃。Object 想保留自治区合法部分必须自己拆 commit / 拆 worktree——把"自治区 vs 跨界"的责任划分推回到 Object 编辑阶段，而不是让 A3 在 review 端做切片。
- **复用 Issue 而非新增 review_window：** 跨 Object 评审是异步的、可文字化的、可拒绝可重提的——这正是 Issue 的语义；新增 ContextWindow 类型会在没有真正语义差异的地方制造结构噪声。
- **自治 merge 无验证关口（编译/lint/test）：** 显式承诺 Object 对自治区内的正确性自负其责，本期不在 A3 加门禁。错了就靠 R10 / R11 的回滚兜底。验证手段是 R3 的"启动独立实例试运行"，由 Object 自己选择是否做。
- **Supervisor 元自治：** Supervisor 不参与 worktree+PR-Issue 协议（R12）。元审阅者无元审阅是有意识的简化——本期不寻找"审 Supervisor 的 Supervisor"，而是把 Supervisor 作为元信任锚。
- **Recovery commit 的署名例外：** F3 回滚 commit 由 Supervisor 署名，而非崩坏的 Object 自身（R4 例外）。回滚是发生在 Object 已加载不动的场景，强求 Object 自签会让恢复不可能；改由 Supervisor 署名既保住 audit trail 又不阻塞恢复。
- **Bootstrap 自动一次性：** `.ooc-world-test/.git/` 启动时不存在则由启动器自动 init，不细分谁触发；这是 setup 期一次性工作，没有归属语义。
- **只 stones/ 进 git：** Agent 的"身体"是可审计的、需要回退的；super flow 的运行时痕迹是瞬态的、不应该污染版本历史。

---

## Dependencies / Assumptions

- 现有 Issue 机制（`src/persistable/issue-service.ts`）需要能携带 PR 形态的 payload（diff、worktree 引用、修改意图）。如果当前结构不直接支持，由 ce-plan 决定扩展形态。
- Object 在 super flow 中已经能将"自我编程意图"识别为一类区别于普通行动的操作；本期版本管理建立在这之上，不重新设计意图分类。
- `.ooc-world-test/` 在外层 OOC 源码仓库的 `.gitignore` 中（已是事实），其内部新增的 `.git/` 与外层 git 互不影响。
- 启动 server 时已经强制要求显式 `--world ./.ooc-world-test`，这是版本管理的边界前提，本期不重新校验。

---

## Outstanding Questions

### Resolve Before Planning

无（2026-05-20 doc-review 钉入的 6 项已全部回答并吸收进 Requirements / Key Decisions / Scope Boundaries 主体——见 R5/R6/R12、AE6-AE8 与 Key Decisions 中 fast-forward / 混合 commit 不切片 / Supervisor 元自治 / Recovery 署名例外 / Bootstrap 自动 init 五条新决策）。

### Deferred to Planning

来自原 brainstorm：

- [Affects R3][Technical] worktree 的生命周期粒度（per 元编程意图 / per super flow / per Object session）以及命名约定。
- [Affects R7][Technical] PR-Issue 的 payload 形态：纯 patch 文本，还是结构化字段（diff + worktree branch + intent），还是 Issue 子文件。
- [Affects R5, R6][Technical] 路径范围判定的实施时机——commit hook、merge 请求时、还是 worktree 关闭时；不同选择影响 Object 的可控感与错误反馈链。
- [Affects R4][Technical] commit 作者的具体写法——`{objectId} <objectId@ooc.local>` 形态还是别的约定，是否影响 git 工具链的兼容性。
- [Affects R8][Technical] Supervisor 决议 request-changes 时，Object 如何被通知并继续在原 worktree 上迭代——是 Issue 评论拉回 super flow，还是新一轮自我编程意图重新跑 F2。
- [Affects R10][Technical] 回滚的触发面：纯 server 方法 / 启动器自检 / 一个新的 ContextWindow command；本期只要求回滚能力存在，不指定入口。
- [Affects R3][Needs research] git worktree 在 bun 环境下的并发与清理是否有坑；是否需要在 OOC 启动 / 关闭路径中加 worktree 卫生检查。

由 2026-05-20 doc-review 追加：

- [Affects R7, R8][Technical] PR-Issue 跨 super-flow 的持久性：当前 Issue 物理位置在 `flows/{sessionId}/issues/`，session 结束随 flows/ 清理。PR-Issue 需要像 GitHub Issue 一样作为独立持久层（可能位置：`stones/.pr-issues/` 或世界级 issues 目录），ce-plan 阶段确认 Issue 机制实际持久性。发起 Object 没有活 super flow 时 request-changes 的回送通路一并定。
- [Affects R5, R6][Technical] 路径划界判定对象：是单 commit 的 diff 还是 branch 相对 main base 的累积 diff。建议后者（与 PR/merge 语义一致，且 Object 中间过程不被 over-审），但需明示。
- [Affects R5, R6][Product] stones/ 根级文件由 Supervisor 修改的特例路径：Supervisor 改 stones/ 根级也越出 stones/supervisor/，按 R6 必须给自己发 PR-Issue 形成自我评审循环。需明确特例（自动 self-approve 但留 audit log，或承认 Supervisor 自治区扩展到 stones/ 根级）。
- [Affects A3, Key Decisions][Scope] A3 命名为「Stone Versioning 子系统」可能被翻译为新模块/抽象层。建议在 Key Decisions 显式声明：本期不引入独立模块，相关能力以函数形式补进 `src/persistable/` 现有文件。
- [Affects R8, R11][Scope] R11「worktree 在 reject 或异常情况下可被丢弃」与 R8 reject 分支语义重述。R11 是否折叠进 R8 或降级为 Key Decisions 中的实现性质说明。
- [Affects R3, R5][Product] 元编程形态分布与协议轻重路径：reflectable 高频场景（memory 单文件 append）走完整 worktree+commit+merge 协议是否过重。ce-plan 阶段对典型 super flow 测一组实际 worktree 数量，必要时分形态分流（轻量直写 vs worktree 沙箱）。
- [Affects Key Decisions][Product] 路径划界的简洁性依赖 OOC 当前 schema 把 relation/memory 都做成 owner-side 文件这一现状（B 想纠正 A 对 B 的认知必须走 PR-Issue 写入 A 自治区，存在归属不对称）。引入 stones 根级共享文件 / 双向协作文档时需重新评估。
- [Affects Key Decisions, Problem Frame][Product] 「自我演化变成日常操作 + 自治 merge 无验证关口」是 OOC 身份级取向。是否在 Key Decisions 显式追加一条「OOC 身份取向声明」让维护者明确签字（高自治 + 乐观恢复，验证关口刻意留给 reflectable / observable 在更高层补）。
- [Affects R10, F3][Product] 回滚后 flows/ 痕迹蒸发，reflectable 失去「刚才发生了什么」诊断上下文，下一次极可能再犯同一个错。是否要求 commit message 强制附元编程意图摘要、或回滚前把对应 flow 的关键摘要写入 stones/{objectId}/knowledge/memory/。
- [Affects Problem Frame][Product] 三痛点（错误立即生效 / 无可观察轨迹 / 无试错空间）压成同一方案：可观察性其实只需 commit 历史。ce-plan 阶段对每个痛点分别核算最小代价方案，确保 worktree 引入是为了 (a)+(c) 而不是替 (b) 单独买单——若 worktree 实施遇阻，「commit 当 audit」部分可单独抢先落地。
