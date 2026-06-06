# Harness Sweep 复盘（2026-06-06 会话）

> 本会话以 8 维度体验 harness 为驱动，系统性修复其暴露的高严重度 bug，并把 persistable 的
> stone/flow 分层从 plain overlay 升级为 session-worktree 统一模型。10 个 commit
> （`bc0d3553`..`19d39f16`），全部 push ooc-6。
> 维护：成果与待办的事实锚是 git log + harness 报告（`docs/harness-reports/`，gitignored）。

## 1. 一句话结论
8 维度 harness 全跑：**Good = thinkable/executable/collaborable/reflectable；OK =
persistable/observable/visible；programmable 从 TIMEOUT 救活为可出报告**。本会话修复了 reflectable
身份、programmable 四层根因、observable resume、collaborable 并发竞态共 8 个 bug，并完成 overlay→worktree
设计升级 + 地基落地。

## 2. 成果（10 commit）

### 维度 bug 修复
| commit | 维度 | 根因 → 修复 | 验证 |
|---|---|---|---|
| `bc0d3553` | reflectable/thinkable | 框架序言缺「身份接管」声明 → 模型 fallback 出厂身份「Kiro」并视其高于 self.md、拒改 self.md。加声明：出厂身份作废、self.md 是唯一权威且可改写 | harness **Good**，Kiro 消失，改名 task 被接受 |
| `b8f7bc41` | reflectable e2e | S5 头注释残留旧 `pools/objects/` 布局 + `selfModifiedByAgent` 仅凭 author 判定（createStone 也署名 agent → 假阳性） | tsc + 模拟 3 类 commit 判定 |
| `1fe94790` | persistable | form-bound guidance（派生窗）被持久化成指向缺失 state.json 的死 `_ref`，reload 刷屏 + program 场景累积膨胀 thread-context.json。新增 `isVolatileDerivedWindow` 谓词，写盘端剔除 | persistable 170 + executable 370 |
| `a87906b7` | runtime（programmable 超时主因） | **max_ticks self-requeue 被 dedupe 自吞**：thread 跑满 15 ticks 在 runJob 内 createRunThreadJob，当前 job 仍 running → findRunning 命中自己 → 续跑被吞 → 永久冻结。续跑移到 processQueuedJobs 标 done 后 | harness 从 TIMEOUT→出报告，冻结/nudge 归零；2 个真实 claim 路径回归 |
| `727a33a7` | programmable | `$OOC_SELF_DIR` 硬拼旧 `stones/<id>/`（P1 收口回归）→ 写入孤儿路径、call_method METHOD_NOT_FOUND。改用 `stoneDir()` | tsc + executable 370 |
| `44acb56d` | observable | resume 编排预翻转 paused→running 后入队，handler 又断言 `status==="paused"` → 必崩「is not paused」、任务卡 running。删编排预翻转 | tsc + runtime；新增 resume-orchestration 回归 |
| `917db9f5` | collaborable | inbox 随 thread.json 整体 write，worker 持 caller 长跑期间外部 append 被整体覆盖 → 并发回报丢正文。inbox 拆 per-message append-only 目录（写入点零改动） | harness **Good**（竞态消失）+ 3 并发回归 + 全套单测 |

### harness 工具
| commit | 内容 |
|---|---|
| `624e0199` | officer 用 `--output-format stream-json --verbose` + 增量落盘 → 超时维度不再黑盒（正是它让 max_ticks 根因从 officer 自述浮现） |

### 设计升级
| commit | 内容 |
|---|---|
| `1c6372d0` | design doc：stone/flow 从 plain overlay 升级为 **session-worktree 统一模型**（§0/§3/§4 重写 + §0.1 动因 + §4.1 三点厘清） |
| `19d39f16` | worktree 模型**地基**：`stone-worktree.ts` 的 `resolveStoneIdentityDir` + lazy `ensureSessionWorktree`，4 测试绿 |

## 3. 关键设计决策：plain overlay → session-worktree

**动因**（harness 三个 high 同根）：plain 稀疏 overlay 须 shadow 读 → ① 裸读死穴（program shell
看不到 main 未改文件）② 读写不对称 ③ 实验分支冗余。

**新模型**：business flow session 改 identity = 从 main **lazy 派生 git worktree 分支 `session-<sid>`**
（完整副本，非稀疏）。读写都指向一个目录、无需 shadow、program shell 裸读裸写都对。super flow
`evolve_self` = commit session 分支 + merge main（**不再新建独立实验分支**——session 分支本身即演化单元）。
统一访问层塌缩成单原语 `resolveStoneIdentityDir`。

**用户两个 grill 推动了收敛**：「你这里统一了写，读呢」戳破读写不对称；「参考 git worktree 完整拷贝」
一举消解三连锁问题。详见 `docs/2026-06-05-stone-flow-overlay-versioning-design.md`（worktree 模型）。

## 4. 待办

### A. worktree 模型完整落地（P2'/P3'，大工程，地基已就绪）
> **完整可执行接续清单见 `docs/2026-06-06-worktree-implementation-guide.md`**
> （文件清单 + 每步改法 + 复用接口 + 建议实施顺序）。下次会话主线从那里进入。

- **接 5 通道过 `resolveStoneIdentityDir`**：write_file 写 / executable·visible·readable loader 读 /
  `loadSelfInstructions` / program shell `$OOC_SELF_DIR`（从止血的 main 改指 worktree）/ 控制面 visible
  client-source-url endpoint（带 sessionId）。
- **main-commit 同步**（地基实测发现，doc §8）：worktree 从 main HEAD checkout → identity 必须
  git-commit 到 main 才可见；P1 canonical 是 main worktree 文件系统（不经 git），须补「凡进 main 的
  identity 写都 commit」——**worktree 相对 plain overlay 多出的核心约束**。
- **`evolve_self` 重做**：commit session 分支 + merge main（复用 `programmable/versioning` `tryMergeSelf`）。
- **回收 plain overlay**：`session-overlay.ts` 的 overlay 读写路径。
- **harness 体验**：persistable/programmable/visible 多维度复跑验证。
- 基础设施齐全：`programmable/git.ts`（worktree add/remove/list/prune）+ `versioning.ts` + `versioned-write.ts`。

### B. overlay 余波 high（worktree 落地后大部分自然解决）
- **executable [high] 裸相对路径写逃出 overlay → world 根**（**正交**于 overlay，独立小修：非 identity 相对
  写该落 flow 工作区 `flows/<sid>/<objId>/` 而非 world 根）。
- **visible [high]** overlay 产物 endpoint 解析不到 → 并入 worktree P2' 的 visible endpoint 接入。
- **programmable** self-programming 闭环（tier=Bad 真实功能层）→ 并入 worktree（$OOC_SELF_DIR 指 worktree）。

### C. 各维度残留 med/low（harness 报告，未阻塞）
- thinkable [med] open_file 截断标记误导→LLM confabulation；[low] `object::root` knowledge 无界膨胀。
- executable [med] 沙箱只认 world 根、不认对象自治区（跨 object 写无隔离）；[low] playbook 工作目录陷阱过时。
- collaborable [low] playbook 仍引用已废弃 `talks.json`（实为 per-message inbox）；[low] wait 模式终态 waiting≠done。
- observable [low] paused 任务把 run-thread job 标 done 掩盖未完成；[low] 观测分层语义/权限观测槽位缺。
- visible [med] 无 flow scope endpoint；[med] 被测 Object 不知 visible canonical 落点；[low] overlay×endpoint 心智错误。
- programmable [med] program 结果只埋 contextWindows.history、未在 thread events 暴露；[low] 缺自我编程持久化引导。

## 5. 方法论收获（沉淀）
- **false-positive 测试反复出现**（本会话至少 4 例）：`worker-yield.test` 用未注册进 jobManager 的 job →
  dedupe 形同虚设、掩盖冻结；`program.test` 断言锚定 P1 回归的孤儿路径；`thread-transition.test` 只测纯函数
  漏覆盖编排集成；S5 `selfModifiedByAgent` 凭 author 假阳性。**教训：fixture 不完整 / 断言锚定 bug 行为 /
  只测纯函数漏集成缝，都会让测试绿着却掩盖真 bug。修 bug 时同步修掩盖它的测试。**
- **systematic debugging**：programmable 三层（guidance 刷屏 → 修了仍超时 → 逼出 officer 可观测 → 才发现
  max_ticks 才是根因）。"修了一个真实症状 ≠ 修了根因"。
- **harness 可观测先于诊断**：超时维度因 officer.log 黑盒不可诊断，先修可观测（stream-json）才看到真相。
- **设计靠 grill 收敛**：overlay→worktree 的统一不是一次想到，是用户连续追问（"读呢"/"worktree 完整拷贝"）
  逐层逼出。

## 6. 接续参考索引（下次会话从这里进入）
- **worktree P2'/P3' 实现**（主线）：`docs/2026-06-06-worktree-implementation-guide.md` —— 可执行接续清单
  （5 通道文件 + 改法 + main-commit 同步前置 + evolve_self 重做 + 回收 overlay + 实施顺序）。
- **worktree 设计权威**：`docs/2026-06-05-stone-flow-overlay-versioning-design.md`（§3 访问 / §4 evolve_self / §8 约束）。
- **memory**：`project_stone_flow_worktree_model`（模型 + 落地进度 + 基础设施速查）。
- **地基代码**：`packages/@ooc/core/persistable/stone-worktree.ts`（+ `.test.ts`，commit 19d39f16）。
- **harness 报告 gitignored** —— §4.C 各维度 med/low issue 细节需**重跑获取**：
  ```
  NO_PROXY=localhost,127.0.0.1 bun packages/@ooc/tests/harness/orchestrate.ts --dimensions <dim> --timeout 1500
  ```
  报告落 `docs/harness-reports/<ts>/<dim>.report.md`（含现象/复现/证据/建议）。playbook 在
  `packages/@ooc/tests/harness/playbooks/<dim>.playbook.md`（场景定义，进 git，可直接读）。

### executable [high] 裸路径逃逸（正交独立小修，不并入 worktree，细节内联防丢）
- **现象**：带 `stones/` 前缀的写被 overlay/identity 解析捕获，**裸相对路径**（如 `a.txt`）逃出、落到
  world 根并污染它；world 根 `../../` 逃逸已被拦，但对象自治区边界未强制。
- **复现**：建 assistant → 让它 program shell `echo x > a.txt`（不带前缀）→ 查 world 根出现 `a.txt`。
- **修向**：非 identity 的相对写应 clamp 到 flow 工作区 `flows/<sid>/<objId>/` 而非 world 根。
  文件：`packages/@ooc/core/executable/windows/_shared/session-path.ts`（`resolveSessionPath` 已有
  world 根 clamp，扩展为「相对写默认落对象 flow 工作区」）。

