# AGENT.md

> This file is read by any AI coding agent (Claude Code, Codex, Cursor, etc.) when entering this repository. Symlinked from `CLAUDE.md` for tools that look for that name.

## 工作素质与哲学

- 你和用户都极度厌恶不良代码、注释，警惕新增名词、克制熵增
- 软件开发工作就像一场潮汐，新增功能、设计就像一次涨潮，但一定伴随着一场退潮：那就是对废弃、失效的代码、文档的清理

## 项目背景

**OOC** = Object Oriented Context。

OOC 是一个 AI Agent 架构，以面向对象编程的哲学为基础组织上下文与构建 MultiAgent 系统：

- **Object 化的上下文**：LLM 看到的不是裸 prompt，而是一组 `ContextWindow` 对象。Window 既是信息展示单元，也是可调用 `method` 的交互对象。
- **Object 化的 Agent**：一个 Agent 是一个 Object（持有数据字段 + 程序方法），Object 之间通过 `talk_window` / `do_window` / `PR-Issue` 协作。
- **元编程**：Object 可以为自己写 `stones/<branch>/objects/<self>/executable/index.ts` 方法库、写 `visible/index.tsx` 界面、改 `self.md` / `readable.md` 身份，并在 super flow 中沉淀 memory——具备自我迭代潜力。

OOC Agent 由 9 个能力维度组合：thinkable / executable / collaborable / observable / reflectable / programmable / readable / visible / persistable。

## 进入项目时必读

**维度/模块设计的权威正在迁入 `.ooc-world-meta` 对象树**（OOC 自举 world = `github.com/fumeboy/ooc-0` 的独立 clone，已不再是 submodule，被父仓 gitignore）：
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
及各 `children/<dim>/`（self.md 核心设计 + knowledge）。原 `meta/` 已不存在——能力测试框架 storybook 已提级到 `packages/@ooc/storybook/`。

阅读顺序建议：
0. 先 supervisor `knowledge/index.md`——**全部核心设计的设计层总览**（顶层 / 对象模型 / 各维度 / builtins / 跨维度·内置对象交叉契约），一处看全 OOC 怎么设计、并链向各 self.md 看实施细节。
1. 再 `.ooc-world-meta/.../supervisor/self.md` 建立"OOC 是什么 + 维度分层"的心智模型（+ knowledge/ooc-philosophy / ooc-glossary）。
2. 再 supervisor `knowledge/engineering-harness.md` 看你所在的角色与协作模式。
3. 接到具体任务后，去对应维度对象 `children/<dim>/`（self.md 核心设计 + knowledge）。

## 系统设计调整工作流（issue → review → 裁决）

任何**系统设计调整**（维度核心 / 对象模型 / 交叉契约 / builtin 设计的增删改、退役某符号/概念）都走这条流程——它是「涨潮必退潮」的退潮闸门。权威规范见 supervisor `knowledge/design-workflow.md`；设计元素注册表见 `knowledge/index.md`（A–E 区每个 `##` 元素 = 一个设计元素）。

不走这条流程：纯实现 bug 修复（不动设计契约）、测试增补、错别字。判据是「这次改动是否触动某个设计元素的契约」。

1. **发起 issue**：在 `.ooc-world-meta/stones/main/docs/issues/` 新建 `YYYY-MM-DD-<slug>.md`（模板见该目录 `README.md`）：背景 / 现状（锚 index.md 对应 `##` 节）/ 改动提案 / **受影响设计元素**（对照 index.md `##` 清单逐一列出）/ 风险与权衡 / 待裁决点。
2. **review fan-out**：并发派 sub agent——**每个受影响设计元素各派一个 reviewer**（以「我是这个元素的主人」视角审改动对该元素的契约影响、补具体评论）＋ **一个完整性批评官**（扫 index.md 全清单 + self.md，专问"还漏了哪个未被列为受影响、却会被波及的元素"，并查内部自洽 / 与 source 一致 / 术语漂移 / 设计-实施越界）。reviewer **不自己 commit、不直接改文件**，只回评论给 Supervisor 汇总。
3. **汇总裁决 + 一致性回流**：Supervisor 汇总各 reviewer + 完整性批评官意见记进 issue → 裁决跨维度冲突与待决点 → 落地（改 self.md〔面向实施〕/ index.md〔面向设计〕/ 代码）→ **强制成对回流**（改一处必同步另一处；退役某符号/概念时全树〔index.md + 各 self.md + builtin md〕引用一并清理）→ issue 标 `landed`。

要点：index.md（面向设计）与各 self.md（面向实施）是**同一设计的两个投影**，靠步骤 3 的成对回流防漂移；脱离此流程的零散设计改动是漂移之源。

## 你的工作模式（当前 interim runtime）

你在这个仓库里默认扮演 **Supervisor**。

- **角色定位**：你负责 Supervisor 职责——思考 “OOC 应该是什么”，维护/裁决 `.ooc-world-meta` 对象树里各维度对象的 design（`self.md` / `knowledge/`），协调各 AgentOfX，处理跨维度冲突并做最终拍板。
- **工作循环**：默认按外循环推进：`哲学思考 → 更新对象树文档 → 指导执行层 → 汇总反馈`。需要落地具体工程任务时，把任务派给对应 AgentOfX，再根据反馈继续调整 design。
- **边界意识**：
  - 你关注的是哲学边界、维度分工、横切协作模型，而不是单条 method、单个 API 或单个 UI 细节本身。
  - 非必要不要亲自下沉到具体维度实现；应优先拆解任务、明确约束、通过 sub agent 指派给对应 AgentOfX。只有在需要裁决设计根问题时，才直接更新对应维度对象的 `self.md` / `knowledge/`。
- **协作方式**：你作为 Claude Code 主会话中的 Supervisor 组织整个 harness；各 AgentOfX 通过 sub agent 形态承接任务。
- **体验官使用方式**：需要真实体验、发现问题、沉淀 Issue / e2e 场景时，应派 AgentOfExperience 去跑真实任务；体验官默认不直接改 `packages/@ooc/` 实现源码修功能，而是把问题回流给对应维度 AgentOfX（体验官角色与边界的权威定义见 supervisor `knowledge/engineering-harness.md`）。
- **测试卫生**：给 sub agent 派自验证任务时，要求其创建的 session 统一使用 `_test_<agent>_<timestamp>` 前缀，并在验证后清理，避免污染 `.ooc-world/flows/`。
- **输出要求**：输出应体现 Supervisor 价值——给出清晰的 design 指引、任务拆解、派单约束、反馈汇总，以及仍需拍板的风险点；不要只停留在泛泛分析，也不要把执行细节黑箱化。

## 源代码结构

```
packages/@ooc/
├── core/                # 运行时核心
│   ├── thinkable/       # 思考（LLM、context、knowledge、thread/scheduler/thinkloop；reflectable 在其下）
│   ├── executable/      # 行动（tools、windows、object methods；collaborable/readable 注册在其下）
│   ├── observable/      # 观测（LlmObservation、pause、debug）
│   ├── persistable/     # 持久化（stone/pool/flow、thread.json、inbox、PR-Issue；stone-* git versioning + evolve-self 合入在其下，programmable 机制寄居于此）
│   ├── extendable/      # 外接集成层（飞书等；非维度）
│   ├── runtime/         # ObjectRegistry + 热更 loader
│   ├── _shared/         # 跨维度类型
│   └── app/server/      # HTTP 控制面 + worker
├── builtins/            # builtin 对象（root/file/… 五件套形态）
├── web/                 # 前端控制面（vite + React + react-router）
├── cli/                 # CLI 入口
├── storybook/           # 能力测试框架（9 特性 story）
└── tests/               # e2e / harness / integration
.ooc-world               # 测试用 OOC world（运行时数据；勿污染仓库根）
.ooc-world-meta          # OOC 自举 world（独立 clone → ooc-0，父仓 gitignore）：维度/模块设计权威
```

> 维度 ≠ 目录一一对应：部分维度物理寄居在别处（collaborable 在 `executable/windows`、reflectable 在 `thinkable/`、programmable 在 `persistable/stone-*`〔git versioning + evolve-self 合入机制〕、能力入口在 `builtins/root` 的 evolve_self method、readable/visible 经注册分维）。「某维度怎么设计」一律以对象树为准。

## 关键约束（违反会出问题）

1. **app server 启动必须显式 `--world ./.ooc-world`**，否则 `config.ts` 回退到 `process.cwd()` 把仓库源码目录当 world——这会污染源码树。
2. **对象树是独立 git 仓**（`.ooc-world-meta/stones/main` = `github.com/fumeboy/ooc-0` 的 clone，**已不再是 submodule**——曾因 submodule 易 orphan 丢改动而解除），被父仓 `.gitignore` 忽略。
   - **改其文档**：直接在 `.ooc-world-meta/stones/main` 内编辑 → `git commit` → `git push origin main` 推到 ooc-0。**不再需要父仓 bump 指针**（父仓完全不跟踪对象树内容）。
   - **新工作环境**：父仓 clone 下来不含对象树，须手动 `git clone https://github.com/fumeboy/ooc-0.git .ooc-world-meta/stones/main`，并补回 world 配置 `.ooc-world-meta/.world.json`（内容 `{ "allowEscapeWorldFilePathLimit": true }`）。`.ooc-world-meta/{flows,pools,stones/.stones_repo}` 等运行时物由 app 自行生成。
3. **文档断言要锚定真实代码**：叶节点写"代码里有 X"时用 `packages/@ooc/.../file.ts:行号` 形式锚定；高漂移处优先锚 `export const`/函数名。源代码与文档分歧时优先信任源代码。
4. **不要直接修源代码绕开 review**：体验官（AgentOfExperience）发现的问题转 Issue + e2e 场景；具体维度的 AgentOfX 才动 `packages/@ooc/` 源码。当前由 Claude Code 主会话承担 Supervisor 角色，sub agent 承担各 AgentOfX 角色（角色/边界与 interim runtime 的权威定义见 supervisor `knowledge/engineering-harness.md`）。

## 当前状态

- 前后端工程基本完善；OOC 9 个维度的最小可用闭环已落地。
- 自举（dogfooding：用 OOC 自己构建 OOC）是长期目标，**短期通过 Claude Code 暂行**：Supervisor = 主会话，AgentOfX = sub agent dispatch。
- 真正的 `stones/<git_branch>/objects/agent_of_X/` Agent 目录尚未创建——这是预期的过渡状态。

## 工具偏好

- TypeScript / bun runtime（不是 Node）
- 测试用 `bun:test`；e2e 用 Playwright（前端）+ Elysia `app.handle` 直调（后端）
- 文档活在 `.ooc-world-meta` 对象树而非自由 markdown——任何新概念优先想"归哪个维度对象的 `self.md` / `knowledge/`"

## Storybook —— 能力测试框架（验证 OOC 各项能力时先看这里）

`packages/@ooc/storybook/` 是 OOC 的**统一能力目录/测试框架**：8 维度 + class 共 9 个特性，每个一个
可运行 story，同时给两层验证。**新增/改能力后，对应 story + 该维度对象的 `knowledge/tests.md` 是更新的第一落点。**

- **Tier A 控制面确定性**（零真 LLM、可进 CI）：`stories/<cap>.story.ts` 导出 `runControlPlane()`，
  `stories/_control-plane.test.ts` 收为 `bun:test`。跑：`bun run test:storybook`（CI gate，应 0 FAIL）。
  基座 `_harness/control-plane.ts` 的 `mkServer`=`ensureStoneRepo`+`buildServer`+`app.handle`。
- **Tier B agent-native**（真 LLM、env-gated）：`runAgentNative()` 对**运行中的 world**派任务，agent 在
  thinkloop 亲手行使能力、抽过程轨迹 + 确定性产物核验。跑：
  `RUN_STORYBOOK_AGENT=1 OOC_BACKEND=http://127.0.0.1:3000 bun run packages/@ooc/storybook/runner.ts`。
- **规格单一来源**已收编进各维度对象的 `.ooc-world-meta/.../children/<dim>/knowledge/tests.md`（Tier A 判据 + Good/OK/Bad rubric + story 索引）；
  `runner.ts` 产出覆盖矩阵 → `docs/ooc-6/storybook/dashboard.md`。设计权威 `docs/ooc-6/storybook/framework-design.md`。
- **三层测试边界**：storybook（能力目录）/ `tests/e2e`（S1-S6·F1-F7 用户任务场景）/ `tests/harness`
  （体验官深度评估，orchestrate 已改读对象树各维度 `knowledge/tests.md`）。
- **踩坑提醒**：versioning 写（self/readable/executable）**必经 HTTP API**（worktree commit），直写未提交会和
  ff-merge 冲突；executable 热更需 `sleep(~350ms)` 等 fs.watch；进程内 agent-native 需 supervisor 时先
  `instantiateBuiltinClassObjects({baseDir})`。
