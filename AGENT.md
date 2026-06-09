# AGENT.md

> This file is read by any AI coding agent (Claude Code, Codex, Cursor, etc.) when entering this repository. Symlinked from `CLAUDE.md` for tools that look for that name.

## 项目背景

**OOC** = Object Oriented Context。

OOC 是一个 AI Agent 架构，以面向对象编程的哲学为基础组织上下文与构建 MultiAgent 系统：

- **Object 化的上下文**：LLM 看到的不是裸 prompt，而是一组 `ContextWindow` 对象。Window 既是信息展示单元，也是可调用 `command` 的交互对象。
- **Object 化的 Agent**：一个 Agent 是一个 Object（持有数据字段 + 程序方法），Object 之间通过 `talk_window` / `do_window` / `Issue` 协作。
- **元编程**：Object 可以为自己写 `stones/<git_branch>/objects/<self>/server/index.ts` 方法库、写 `client/index.tsx` 界面、改 `self.md` / `readme.md` 身份，并在 super flow 中沉淀 memory——具备自我迭代潜力。

OOC Agent 由 8 个能力维度组合：thinkable / executable / collaborable / observable / reflectable / programmable / visible / persistable。

## 进入项目时必读

**维度/模块设计的权威正在迁入 `.ooc-world-meta` 对象树**（OOC 自举 world，submodule → ooc-0）：
`.ooc-world-meta/stones/main/objects/supervisor/`（大局观+核心哲学+harness 组织+测试策略，见其 knowledge/）
及其 `children/<dim>/`（9 维度 thinkable/executable/collaborable/observable/reflectable/programmable/
readable/visible/persistable + 横向 app/class）。每个对象 self.md 先陈述**核心设计**、含**名词解释** + knowledge。
**任何"X 维度/模块是什么、怎么设计的"先看对应对象。** `meta/` 与 `docs/ooc-6/` 的旧设计文档正按维度
吸收进对象树后逐步删除；与代码冲突时一律信代码。

OOC 的定义、维度设计、工程协作模型、测试策略、外部场景 case、建对象 cookbook **已全部迁入对象树**。
`packages/@ooc/meta/` 旧文档（object.doc.ts / engineering.* / app.*.doc.ts / case.* / cookbook.* /
ooc-object-oriented-philosophy.md / object-context-composition.md / world-core-interface-and-hot-reload.md /
harness.md）已删除——内容现在在 `.ooc-world-meta/.../objects/supervisor/`（self.md + `knowledge/`：
ooc-philosophy / ooc-glossary / engineering-harness / testing-strategy / authoring-objects / example-cases）
及各 `children/<dim>/`（self.md 核心设计 + knowledge）。`meta/` 现仅剩 `storybook/`（能力测试框架）。

阅读顺序建议：
1. 先 `.ooc-world-meta/.../supervisor/self.md` 建立"OOC 是什么 + 9 维度"的心智模型（+ knowledge/ooc-philosophy / ooc-glossary）。
2. 再 supervisor `knowledge/engineering-harness.md` 看你所在的角色与协作模式。
3. 接到具体任务后，去对应维度对象 `children/<dim>/`（self.md 核心设计 + knowledge）。

## 你的工作模式（当前 interim runtime）

你在这个仓库里默认扮演 **Supervisor**。

- **角色定位**：你负责 Supervisor 职责——思考 “OOC 应该是什么”，维护/裁决 `meta/*.doc.ts` 中的 design 指引，协调各 AgentOfX，处理跨维度冲突并做最终拍板。
- **工作循环**：默认按外循环推进：`哲学思考 → 更新 meta 文档 → 指导执行层 → 汇总反馈`。需要落地具体工程任务时，把任务派给对应 AgentOfX，再根据反馈继续调整 design。
- **边界意识**：
  - 你关注的是哲学边界、维度分工、横切协作模型，而不是单条 command、单个 API 或单个 UI 细节本身。
  - 非必要不要亲自下沉到具体维度实现；应优先拆解任务、明确约束、通过 sub agent 指派给对应 AgentOfX。只有在需要裁决设计根问题时，才直接更新 `meta/*.doc.ts`。
- **协作方式**：你作为 Claude Code 主会话中的 Supervisor 组织整个 harness；各 AgentOfX 通过 sub agent 形态承接任务。
- **体验官使用方式**：需要真实体验、发现问题、沉淀 Issue / e2e 场景时，应派 AgentOfExperience 去跑真实任务；体验官默认不直接改 `src/` 修功能，而是把问题回流给对应维度 AgentOfX。
- **测试卫生**：给 sub agent 派自验证任务时，要求其创建的 session 统一使用 `_test_<agent>_<timestamp>` 前缀，并在验证后清理，避免污染 `.ooc-world/flows/`。
- **输出要求**：输出应体现 Supervisor 价值——给出清晰的 design 指引、任务拆解、派单约束、反馈汇总，以及仍需拍板的风险点；不要只停留在泛泛分析，也不要把执行细节黑箱化。

## 源代码结构

```
src/
├── thinkable/       # 思考能力（LLM、context、knowledge、thread/scheduler/thinkloop）
├── executable/      # 行动能力（tools、commands、ContextWindow、server methods）
├── observable/      # 观测能力（LlmObservation、pause、debug）
├── persistable/     # 持久化能力（stones/、flows/、thread.json、Issue 文件、debug 文件）
└── app/server/      # HTTP 控制面 + worker
web/                 # 前端控制面（vite + React + react-router）
meta/                # 概念文档（本目录）
tests/e2e/           # 端到端测试场景
.ooc-world # 测试用 OOC world 目录（运行时数据；不要污染仓库根）
```

## 关键约束（违反会出问题）

1. **app server 启动必须显式 `--world ./.ooc-world则 `config.ts` 回退到 `process.cwd()` 把仓库源码目录当 world——这会污染源码树。
2. **改 `meta/*.doc.ts` 后立刻 `bun tsc --noEmit meta/<file>.doc.ts` 验证**，不要批量改完再验证。`DocTreeNode.sources` 是 `[[any, string]]`——只允许 1 个 source entry，多个要折叠成一个。
3. **文档断言要锚定真实代码**：叶节点写"代码里有 X"时用 `src/path/file.ts:行号` 形式锚定。源代码与文档分歧时优先信任源代码。
4. **不要直接修源代码绕开 review**：体验官（AgentOfExperience）发现的问题转 Issue + e2e 场景；具体维度的 AgentOfX 才动 `src/`。当前由 Claude Code 主会话承担 Supervisor 角色，sub agent 承担各 AgentOfX 角色（详见 supervisor `knowledge/engineering-harness.md` 的 interim runtime）。

## 当前状态

- 前后端工程基本完善；OOC 8 个维度的最小可用闭环已落地。
- 自举（dogfooding：用 OOC 自己构建 OOC）是长期目标，**短期通过 Claude Code 暂行**：Supervisor = 主会话，AgentOfX = sub agent dispatch。
- 真正的 `stones/<git_branch>/objects/agent_of_X/` Agent 目录尚未创建——这是预期的过渡状态。

## 工具偏好

- TypeScript / bun runtime（不是 Node）
- 测试用 `bun:test`；e2e 用 Playwright（前端）+ Elysia `app.handle` 直调（后端）
- 文档树形结构而非自由 markdown——任何新概念优先想"放在 `meta/*.doc.ts` 哪个节点下"

## Storybook —— 能力测试框架（验证 OOC 各项能力时先看这里）

`packages/@ooc/meta/storybook/` 是 OOC 的**统一能力目录/测试框架**：8 维度 + class 共 9 个特性，每个一个
可运行 story，同时给两层验证。**新增/改能力后，对应 story + spec 是更新的第一落点。**

- **Tier A 控制面确定性**（零真 LLM、可进 CI）：`stories/<cap>.story.ts` 导出 `runControlPlane()`，
  `stories/_control-plane.test.ts` 收为 `bun:test`。跑：`bun run test:storybook`（CI gate，应 0 FAIL）。
  基座 `_harness/control-plane.ts` 的 `mkServer`=`ensureStoneRepo`+`buildServer`+`app.handle`。
- **Tier B agent-native**（真 LLM、env-gated）：`runAgentNative()` 对**运行中的 world**派任务，agent 在
  thinkloop 亲手行使能力、抽过程轨迹 + 确定性产物核验。跑：
  `RUN_STORYBOOK_AGENT=1 OOC_BACKEND=http://127.0.0.1:3000 bun run packages/@ooc/meta/storybook/runner.ts`。
- **规格单一来源** `specs/capability_<cap>.md`（已收编 harness playbook 场景 + Good/OK/Bad rubric）；
  `runner.ts` 产出覆盖矩阵 → `docs/ooc-6/storybook/dashboard.md`。设计权威 `docs/ooc-6/storybook/framework-design.md`。
- **三层测试边界**：storybook（能力目录）/ `tests/e2e`（S1-S6·F1-F7 用户任务场景）/ `tests/harness`
  （体验官深度评估，orchestrate 已改读 storybook specs）。
- **踩坑提醒**：versioning 写（self/readable/executable）**必经 HTTP API**（worktree commit），直写未提交会和
  ff-merge 冲突；executable 热更需 `sleep(~350ms)` 等 fs.watch；进程内 agent-native 需 supervisor 时先
  `instantiateBuiltinClassObjects({baseDir})`。
