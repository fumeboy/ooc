# Storybook —— 体系化系统端到端测试框架（设计）

> OOC 能力测试框架（2026-06-07）：把 storybook 升级为 OOC 的**统一能力目录/showcase**——每个能力
> （8 维度 + class）一个可运行 story，同时给**控制面确定性验证**（可 CI）和 **agent-native 过程可见
> 演示**（真 LLM）。维护：断言锚 `file:行号`；活文档，随 story 演进更新。
> 实现位置：`packages/@ooc/storybook/`。上游：supervisor `knowledge/testing-strategy.md`（`.ooc-world-meta`，e2e 策略）。

## 1. 定位与三层边界

storybook = **OOC 能力目录**：回答「OOC 能做什么 + 证明它能 + 展示它怎么做」。它把原先分散在
`_verify.ts`（4 特性控制面）/`_demo_session.ts`（2 场景演示）/`tests/harness/playbooks`（8 维度）里的
「能力证明」收编成一个**有覆盖矩阵的体系**。与其它测试层分工：

| 层 | 职责 | 进 CI |
|---|---|---|
| unit（各模块 `__tests__/`） | 函数级 | ✓ |
| **storybook（本框架）** | **能力目录**：9 特性 × {控制面确定性 + agent-native 演示} | Tier A ✓ |
| e2e backend/frontend（S1-S6 / F1-F7） | **用户任务场景**端到端不退化 | ✗（env-gated） |
| harness orchestrate（体验官） | **深度主观评估**（spawn Claude Code 找问题、长报告）；场景定义收编入 storybook specs | ✗ |

## 2. 两个 Tier

**Tier A —— 控制面确定性（`app.handle` 进程内、零真 LLM、可进 CI gate）**
- 每特性一个纯 story 模块 `stories/<cap>.story.ts`，导出 `runControlPlane(): Promise<StoryResult>`。
- 被 `stories/_control-plane.test.ts`（`bun:test`）逐特性收为一个 `it`，断言无 FAIL → `bun run test:storybook` 作 CI gate。
- 基座 `_harness/control-plane.ts`：`mkServer()` = `ensureStoneRepo` + `buildServer` + `app.handle`
  （createStone 经 HTTP 走 worktree 版本化的已验证方式）；`postJson/putJson/getJson`；`writeStoneFile`
  （非 versioning 热更直写）；`stoneCommits`/`readThreadJson`；`StoryRecorder`。
- **关键约束**：versioning 写（self/readable/executable）**必经 HTTP API**（worktree commit）；直写未提交
  会和后续 ff-merge 冲突——只用于非 versioning 的 executable 热更。

**Tier B —— agent-native（真 LLM、env `RUN_STORYBOOK_AGENT=1`、过程可见）**（Phase 2）
- 每特性 `runAgentNative()`：对运行中的 world 派演示任务，agent 在 thinkloop 亲手行使能力，
  抽**过程轨迹** + 确定性产物核验（不做文本匹配）。复用 `_harness/agent-native.ts`
  （`processTrace`/`waitJob`，源自 `_demo_session.ts`）+ harness playbook rubric 作判据。

## 3. 目录结构

```
packages/@ooc/storybook/
  _harness/{types.ts, control-plane.ts, agent-native.ts}
  stories/<cap>.story.ts           # 9 能力 story（runControlPlane/runAgentNative）
  stories/L<n>_<layer>.stories.ts  # 单元化 catalog（一条 story 一个预期）
  stories/{_control-plane,_catalog}.test.ts   # bun:test 汇总入口（CI gate）
  runner.ts / catalog-runner.ts    # 聚合 → dashboard / stories-report
```

> 测试规格（Tier A TC + Tier B rubric）已归属各维度 OOC Object 的 `knowledge/tests.md`（Phase 3，
> 2026-06-09）；原 `specs/capability_<cap>.md` 已删，orchestrate 读对象树。测试代码留本目录可跑。

## 4. 复用清单（不重复造轮子）

| 复用 | 来源 | 用途 |
|---|---|---|
| `mkServer` 基座 | `_verify.ts:49-107` 模式（ensureStoneRepo+buildServer） | createStone 经 HTTP worktree 的正确前提 |
| 观察孔/评分纯函数 | `packages/@ooc/tests/e2e/backend/_fixture.ts`（`scoreScenario:620`/`stoneFileCommits:488`/`listMemoryFiles:561`/`hasValidFrontmatter:580` 等） | Tier B 产物核验 |
| `processTrace`/`waitJob` | `_demo_session.ts:46/34` | Tier B 过程轨迹 |
| `pool`/`writeDashboard` 范式 | `tests/harness/orchestrate.ts:204/217` | runner 并发 + 矩阵 |
| playbook rubric | `tests/harness/playbooks/<dim>.playbook.md` | Tier B 判据来源 |
| instantiate supervisor | `bootstrap/instantiate-classes.ts` | 进程内 agent-native 需 supervisor 时 |

## 5. 当前状态（as-built）

- ✅ **Phase 1 完成**：9 特性 Tier A 控制面套件全绿（28 PASS + 2 SKIP / 0 FAIL，零真 LLM），
  `test:storybook` 作 CI gate。覆盖：thinkable(2)/executable(2)/collaborable(2)/observable(2)/
  reflectable(6)/programmable(4)/visible(3+2SKIP)/persistable(3)/class(4)。
- ✅ runner + dashboard（`docs/ooc-6/storybook/dashboard.md`）。
- ⏳ **Phase 2** agent-native（每特性 `runAgentNative`）；**Phase 3** harness 收编（playbook→specs，
  orchestrate 改读 specs）；**Phase 4 剩余** 9 份 spec + coverage-matrix。

## 6. Tier A 的诚实边界

thinkable/observable 的「知识激活**质量** / context 多轮连贯 / 每轮 loop-debug 落盘」本质需真 LLM——
Tier A 只断**结构/通道**（knowledge 被 loadKnowledgeIndex 加载、activity/debug 端点结构、talk inbox
投递、git commit 版本化）。**质量判据下放 Tier B**。visible 的 Vite serve/安全边界需 live Vite 指向同
world，否则 SKIP（不阻 gate）。
