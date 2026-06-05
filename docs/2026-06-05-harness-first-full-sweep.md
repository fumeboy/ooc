# 维度体验官 Harness · 首轮全 8 维度 sweep 汇总

> run_ts 2026-06-05T11-56-48 · mode full · 并发 4 · 超时 1200s/officer · 真 LLM 双层。
> 报告目录 gitignored，故把档位矩阵 + 各维度结论 + 暴露 Issue + 横切发现 curate 进 docs/ 持久化。
> 体验官只报告不修；下列 Issue 回流对应 AgentOfX（由 Supervisor 派单）。

## 档位矩阵
| 维度 | tier | 耗时 | officer | 一句话 |
|---|---|---|---|---|
| executable | **Good** | 626s | ✓ | 核心动作闭环全 Good（**就地复验了 guidance 修复**：smoke1=Bad→修复后=Good）；但 `../` 可逃逸 world 根写任意位置（无沙箱，high） |
| reflectable | **Good** | 907s | ✓ | 沉淀(write)半边 Good（S1 七规则全中，回归锚守住）；但召回(recall)半边断裂——memory 只写不读（high） |
| collaborable | **Bad** | 1163s | ✓ | talk 机制本身 Good，但**新建对象不进 runtime registry → world 级 think 崩**（high） |
| thinkable | OK | 1202s | TIMEOUT | 多轮连贯/knowledge 激活/长文档检索质量高；无 `activates_on` 的 knowledge 静默永不激活（med） |
| observable | OK | 452s | ✓ | debug 落盘扎实；但 pause 是单向陷阱——无 HTTP resume 路径（high） |
| visible | OK | 837s | ✓ | 机制链路通；Agent 开箱不知 canonical 路径致首产页 404；更新任务 intermittent 崩（med） |
| persistable | OK | 824s | ✓ | 落盘/恢复完整；但 self.md 改动进不了 git versioning，working dir 与 git 视图分叉（high） |
| programmable | — | 1202s | TIMEOUT | 无报告（officer 超时，框架正确记录+清理）；需单独加长超时重跑 |

## ⭐ 横切发现（跨维度共性，最高优先）

**X1【high·5 维度独立命中】`GET /api/flows/<sid>/threads` 列表端点恒返回空 `{items:[]}` —— ✅ 已修复**
executable / thinkable / observable / visible / persistable 全部撞到：session 下确有 thread（per-object
端点 `/flows/<sid>/<obj>/threads/<tid>` 正常返回 status/events、磁盘文件齐全），但**列表端点**返回空数组
→ cheatsheet 的 poll 配方永远空转、假阴性。
**根因（确诊）**：我 F3 恢复 flows module 时，`listThreads` 沿用 9bd8640b^ 的 `flows/<sid>/objects/<obj>/`
布局扫描，但当前 `objectDir = flows/<sid>/<nestedObjectPath>`（**无 `objects/` 段**，objects 是 session 根
直接子）→ 扫描目录不存在 → items 恒空。**这是 X1 被 5 维度命中的 F3 回归。**
**修复**：`listThreads` 改扫 `flows/<sid>/` 直接子（`service.ts` objectsDir→sessionRoot）。
**验证**：真实 server 端到端（seed 后 list 返回 assistant+user 两 thread，修复前为空）；
回归测试 `issue-6-api-consistency.test.ts` 加「seed→list 非空」；app/server 96 pass / tsc 干净。
**附带**：X1 修好后 cheatsheet 的 list-endpoint poll 配方自动恢复可用（修了根，非症状）。

**X2【med·executable+persistable】文件命令相对路径基准错乱**
相对路径不落「自身 stone 自治区」：executable 看到落 world 根、persistable 看到解析到 `packages/`。
cwd 语义对 Agent 不透明且与 playbook/cheatsheet 文档不符。叠加 X-esc：executable E2 实测 `../escape.txt`
逃逸 world 根（无路径沙箱，high）。→ 回流 AgentOfExecutable（file window base proto）。

**X3【doc drift·harness 自维护】**
(a) cheatsheet/playbook 写 `stones/main/objects/<id>/`，实际 `stones/<id>/`（每对象独立 worktree，bare 在 `stones/.stones_repo`）；
(b) cheatsheet 的 poll 配方用了 X1 的坏端点；(c) collaborable 的 `talks.json` 反向路由落盘已不存在（改进 thread.json inbox/outbox）。
→ 我修 cheatsheet（见下）。

## 修复进度（Supervisor 以 AgentOfX 身份逐项修，均验证+回归测试+push）

**✅ 已修复（关键正确性 bug：崩溃/静默失败/安全/召回断裂类）**
- **guidance window 渲染崩**（refine→failed thread）— commit 2cb17108
- **X1 listThreads 列表端点恒空**（F3 回归，5 维度命中）— commit b758360f
- **collaborable world 级 think 崩**（未注册 peer 渲染崩）— commit 8019765e（fail-soft 渲染）
- **collaborable 新对象惰性注册**（非 dev 不注册）— commit 8cc5a499（createStone/putServerSource 显式注册）
- **reflectable 召回断裂**（window::root 永不激活，memory 只写不读）— commit 72a5aa6c（root always-on）
- **executable 路径逃逸 world 根**（`../`/绝对路径无拦截，安全）— commit e62bb20e（resolveSessionPath clamp）

**⏳ 剩余 backlog（feature 补全 / 复杂区，宜单独 scope）**
- **observable pause 单向陷阱**：resume 机制已存在（resumePausedThread/resume-thread job/resumeSession），缺 HTTP 触发 + global-pause/disable 的 re-enqueue 编排。落在 **F6 推迟项**（pause 两套抽象待合并）复杂区 → 随 F6 一并做。
- **persistable versioning 缺口**：self.md/server 改动无 agent-facing version 命令，working dir 与 git 视图分叉。需新 method（executable 层）+ 厘清 stones/<id> vs stones/main 权威 → 设计性 feature。
- **thinkable** knowledge 无 activates_on 静默永不激活（写入 API 应警告，med）。
- **visible** Agent 开箱不知 canonical `visible/index.tsx` 路径致首产页 404（med，可由 self/readable 引导或 endpoint 兼容具名文件）。
- **reflectable** self.md 改写失败却被 agent 当成功上报（false success claim）——与 persistable versioning 同源（写失败不可观测）。

## 各维度高严重度 Issue（回流 AgentOfX）

- **executable**：`../` 逃逸 world 根写任意位置，无路径沙箱（high）→ AgentOfExecutable
- **reflectable**：① `window::root` trigger 沉淀的 memory 在新 thread 永不激活（运行时无 `type:"root"` window）→ memory 只写不读，自演化闭环静默断（high）② self.md 改写失败却被 agent 当成功上报（false success claim，high）③ super→origin 的 `do_window.continue` 跨 session 找不到目标线程（静默失败，med）→ AgentOfReflectable（+协查 Thinkable/Executable/Collaborable）
- **collaborable**：新建对象惰性注册——只有首次被 `targetObjectId` 命中才进 registry；任意对象 build think 上下文会枚举 world 全部 on-disk 对象并 `getObjectDefinition`，撞上任一「存在于盘但未注册」对象即 `think_error` → **全 world 谁都不能 think**（high）→ AgentOfCollaborable + 对象注册/getObjectDefinition 加载链 owner
- **observable**：pause 单向陷阱——global-pause 能停，但无任何 HTTP resume/step 路径，已暂停 thread 永久卡死（high）→ AgentOfObservable
- **persistable**：① self.md/server 改动无 agent-facing versioning 入口（stone-versioning 触发面缺失），显式要求 commit 空转 6min git 零更新（high）② `stones/<id>/`（活动）与 `stones/main/`（git 视图）self.md 永久分叉，两个 source of truth（high）→ AgentOfPersistable
- **thinkable**：knowledge 无 `activates_on` 静默永不激活、写入 API 无警告（med）→ AgentOfThinkable + Persistable
- **visible**：Agent 开箱不知 canonical `visible/index.tsx` 路径致首产页 404（med）；更新任务 intermittent thread 崩（status=failed/error=null，med）→ AgentOfVisible + Thinkable

## 框架自身表现（validated）
- 8 维度并行 2 波跑通，6/8 出报告 + Good/OK/Bad 全档位都出现（判档有区分度）。
- **guidance 修复就地复验**：executable 从 smoke1 的 Bad 升到 Good。
- timeout 处理验证：thinkable/programmable 超时被正确记录+清理（programmable 无报告=officer 太慢，非框架故障）。
- 横切信号涌现：X1 被 5 维度独立命中——多体验官交叉验证比单测更易暴露系统级 bug，**正是本 harness 的核心价值**。

## 下一步（Supervisor 派单建议）
1. **X1 先查**（我自查，疑 F3 回归，影响 poll + 多维度观测）。
2. cheatsheet doc drift 修（我直接修，恢复 poll 可用）。
3. 各 high Issue 回流对应 AgentOfX 逐项修（reflectable 召回断裂、collaborable 注册崩、observable pause 陷阱、persistable versioning 缺口、executable 路径沙箱）。
4. programmable 加长超时单独重跑补档。
