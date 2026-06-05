# 维度体验官 Harness 设计（Dimension Experience Harness）

> 一套体系化的「多维度体验官」测试框架：用并行 `claude --dangerously-skip-permissions`
> 进程，每个进程作为一个 OOC 维度的**体验官**，驱动真实 OOC World Server 跑任务、观察落盘、
> 自评 Good/OK/Bad 并产出维度体验报告。作为现有 harness 环节的一环（与 bun:test S1-S6 互补）。
>
> 状态：设计定稿（2026-06-05）。决策来源：brainstorm Q1-Q4 + 路径 C。

## 1. 目标与边界

**目标**：把「派 AgentOfExperience 验证某维度达 Good 档」（此前手动，如 reflectable=S5 Good）
systematize 成覆盖全 8 维度、并行 claude 进程驱动、可复现+可探索、自动产报告的框架。

**8 维度**：thinkable / executable / collaborable / observable / reflectable / programmable
/ visible / persistable。

**与现有层的关系（互补，不取代）**：
- bun:test S1-S6（`tests/e2e/backend/`）：进程内 `app.handle`、快、CI gate、`scoreScenario` 判档 —— **保留不动**。
- 本框架：真 HTTP server + 外部 claude 进程、慢（~10-30min/全维度）、自主+深度、按需触发的**深度体验 harness**。种子场景受 S1-S6 能力目标启发但独立定义。

**非目标**：不替代 CI gate；体验官不改 `src/`（只产报告 + Issue，回流给 AgentOfX）；不追求每 commit 跑。

## 2. 架构与目录

落点 `packages/@ooc/tests/harness/`：

```
packages/@ooc/tests/harness/
├── playbooks/<dim>.playbook.md      # 8 维度 rubric playbook
├── driver/
│   ├── cheatsheet.md                # OOC HTTP 驱动手册（curl 配方 + fs/git 观察）
│   └── ooc-drive.ts                 # 薄驱动 CLI（封装高频操作）
├── officer-prompt.md                # 体验官 prompt 模板（注入 dim/playbook/port/world/report）
├── report-schema.md                 # 报告结构契约
├── orchestrate.ts                   # 编排脚本
└── README.md                        # 用法
报告产出 → docs/harness-reports/<timestamp>/（进 git 留趋势，仿 round-N-experience-report）
```

**数据流**（每维度一条隔离流水线，编排脚本驱动）：
1. mkdir 隔离 world `/tmp/ooc-harness-<dim>-<ts>/` + 分配端口（base 4100 + index）
2. 起 server：`bun packages/@ooc/core/app/server/index.ts --world <world> --port <port>`，poll `/health` 等 ready
3. 起体验官：`claude -p "<注入后的 officer-prompt>" --dangerously-skip-permissions --add-dir <world>`（print 模式，自主跑完退出；stdout 落日志）
4. 体验官按 playbook：HTTP seed OOC Agent + talk 派任务 → 观察（HTTP 读 + fs/git 读 world）→ 种子场景自评 + 1-2 探索 → 写 `docs/harness-reports/<ts>/<dim>.report.md`
5. 编排监控全部（并发上限默认 4 / 每官超时默认 1200s / 失败兜底续跑）→ 全完聚合 `dashboard.md` → 杀 server + 清理 world

**隔离**：每维度独占 world+端口，并行互不干扰。
**两层 LLM**：体验官=Claude Code（自身 auth）；被测 OOC Agent=OOC_PROVIDER（env `ANTHROPIC_AUTH_TOKEN`）。两者都需真 LLM。

## 3. Playbook 格式（rubric playbook）

每维度一份 markdown，结构固定：

```
# <Dimension> 体验官 Playbook
## 维度 brief        一句话：该维度是什么 + 外部可观察落点
## 驱动准备          world seed 步骤（seed 哪个 object、是否预置 docs/ 文件等）
## 种子场景（2-3 个，每个）
   - id / 名称
   - task：派给 OOC Agent 的 talk 文本（明确、低方差）
   - 观察指南：查哪些 HTTP 端点 / world 文件 / git
   - rubric：Good / OK / Bad 各自的「可观察事实」判据
## 探索提示          该维度值得自主压的 1-2 个方向
## 已知陷阱          观察该维度的坑
```

**设计原则**：rubric 用**可观察事实**（thread.status / 文件存在+内容 / git commit / 命令序列），
不用过程文本，保证体验官自评可复现、跨运行可比。低方差 task 文本减少 LLM 漂移。

## 4. 八维度观察策略（核心）

| 维度 | 种子 task（示例） | 观察手段 | Good 判据（示例） |
|---|---|---|---|
| **executable** | 「把 docs/note.md 里 foo 改名 bar / 搜索 X / 编辑后故意写错再恢复」 | get-thread 命令序列、world fs 文件 diff、git | 编辑正确落盘 / 搜索命中 / 恢复成功 |
| **thinkable** | 多轮：先问实现再追问改动，要求前后连贯 + 触发 knowledge 激活 | loop-debug（context windows + knowledge 激活）、多轮 thread 连贯 | 多轮连贯 / 相关 knowledge 被激活并影响回复 / 无上下文丢失（间接，主观性较高） |
| **collaborable** | 让 assistant 去 talk 另一个 object 协作完成子任务 | 多 object thread、talk_window 投递、talks.json 反向路由 | talk 投递 / callee 响应 / 双写一致 |
| **observable** | enable debug → 派任务 → 触发一次 pause/inspect | runtime/debug/status、loop-debug 记录、pause 行为 | debug 记录完整 / pause 被尊重 / LLM observation captured |
| **reflectable** | 「把项目约定沉淀为长期记忆」（= S5） | super thread、pools memory + frontmatter | **对齐 S5 Good 7 条**（super done / memory 落对 pool / frontmatter / 内容真提约定 / 回 user 说明）= 回归锚 |
| **programmable** | 「写一个 server method 并调用它」 | program window、stones/.../server/index.ts、method 注册+调用结果 | method 写出 / 注册 / 可调用 / 结果正确 |
| **visible** | 「为自己产出一个 client 展示页」（用**真 world stone**，非 builtin supervisor — L8 阻塞） | client/visible tsx 落盘、client-source-url endpoint 200、tsx 合法 | tsx 产出 / endpoint 解析 200 / 含 default export+react |
| **persistable** | 触发 stone versioning + thread 持久化 + pool 沉淀 | stones git commit、thread.json roundtrip、pool 文件 | versioned write 进 git / thread 持久化可恢复 / pool 落盘 |

内部 3 维（thinkable/observable/persistable）的观察更间接：依赖 debug 端点（loop-debug、debug-status）
+ world fs/git。playbook「已知陷阱」记录各自坑（如 reflectable super flow 独立 job 须等；pool flat 布局）。

## 5. 驱动 cheatsheet + officer 契约

**driver/cheatsheet.md**：documented curl 配方（带 `NO_PROXY=localhost,127.0.0.1`）：
- seed session：`POST /api/sessions {sessionId,title,targetObjectId,initialMessage}`
- 续派：`POST /api/flows/:sid/continue {text,targetWindowId?}`
- 读 thread：`GET /api/flows/:sid/:objectId/threads/:threadId`；列 thread：`GET /api/flows/:sid/threads`
- 树/文件：`GET /api/tree?scope=world|stones`、`GET /api/tree/file?path=`
- debug：`POST /api/runtime/debug/enable`、`GET /api/runtime/debug/status`、loop-debug `GET /api/runtime/flows/:sid/:objectId/threads/:tid/debug/loops`
- fs/git：直接读 `<world>/flows|stones|pools`、`git -C <world>/stones/<bare> log`
- **等 job**：派任务后 OOC Agent 真 LLM 跑数分钟，须 poll thread.status 直到 done/failed（cheatsheet 给 poll 循环），别误判未完成。

**driver/ooc-drive.ts**：薄 bun CLI 封装高频：`ooc-drive seed|talk|wait|get-thread --port P ...`，体验官可选用（不强制）。

**officer-prompt.md**（模板，占位 `{DIMENSION}{PLAYBOOK}{PORT}{WORLD}{REPORT}`）指令体验官：
- 你是 `{DIMENSION}` 维度体验官；读 `{PLAYBOOK}` 与 `driver/cheatsheet.md`
- 驱动 `localhost:{PORT}` 上运行中的 OOC server（用 NO_PROXY）；session 用 `_test_<dim>_<ts>` 前缀
- 逐个跑种子场景：派 task → 等 job done → 按观察指南采集事实 → 套 rubric 自评 Good/OK/Bad
- 再跑 1-2 探索场景（自定 rubric）找 unknown-unknowns
- 按 `report-schema.md` 写 `{REPORT}`：基线档位表 + 探索发现 + 暴露 Issue（标 severity + 该回流哪个 AgentOfX）
- **约束**：不改 `src/`（只报告）；务实等真 LLM job；超时则记录已得部分；简洁

## 6. 报告 schema + 聚合

**每维度 `<dim>.report.md`**：
```
---
dimension, run_ts, baseline_tier(整体最差档), scenarios_run, issues_count
---
## 基线档位     表：场景 | 档位 | 关键观察事实
## 探索发现     prose：自创场景 + 结果
## 暴露 Issue   list：标题 | severity | 回流 AgentOfX | 复现要点
## 观察原始事实  关键 HTTP/fs/git 取证（供复核）
```

**`dashboard.md`**（编排聚合）：维度×档位矩阵 + 横切问题（跨维度共性）+ run 元数据（耗时/并发/失败维度）+ 各报告链接。

## 7. 编排脚本（orchestrate.ts）

bun 脚本，参数：
- `--dimensions <list>`（默认全 8）
- `--concurrency <n>`（默认 4：控 LLM 速率/成本）
- `--timeout <s>`（默认 1200/officer）
- `--smoke`：只跑 1 个维度（默认 executable，快）端到端真实验证
- `--dry-run`：只验 server spawn + officer launch 机制，officer 不真跑（注入 `echo` 替身），验编排闭环
- `--keep-worlds`：调试保留 world

逻辑：并发池（cap N）；每维度 allocate port → mkdir world → spawn server → waitForReady(/health, 30s) → spawn officer（capture stdout + report）→ per-officer timeout → 失败记录续跑 → 全完聚合 dashboard → 杀 server + 清理 world（除 --keep）。

## 8. Success criteria

1. `--dry-run` 通过：8 维度 server spawn + officer launch + 报告收集机制闭环（无真 LLM）。
2. `--smoke`（executable 真实）通过：体验官真驱动 OOC Agent 编辑/搜索 + 观察落盘 + 自评 + 写报告，端到端闭环。
3. reflectable 维度复现 **Good 档**（= S5，回归锚）。
4. 全 8 维度并行跑产出一致报告 + dashboard。
5. 框架不污染：world 清理、session `_test_` 前缀、reports 进 `docs/harness-reports/`。

## 9. 风险与缓解

- **成本/时长**：8 维度 × 真 LLM（officer + OOC agent 双层）。缓解：并发上限 4、每官超时、种子场景精简（2-3/维度）、按需触发非 CI。
- **LLM 方差**：体验官+OOC agent 都不确定。缓解：低方差 task 文本、rubric 用可观察事实、种子保基线 + 探索吸收方差。
- **嵌套 claude 进程**：从当前会话 spawn `claude -p`。缓解：smoke 先验单进程可行。
- **观察内部维度难**：thinkable/observable 主观。缓解：尽量用 debug 端点取硬事实，rubric 标注「间接判据」，报告诚实标主观性。
