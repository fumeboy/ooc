# AGENT.md

> This file is read by any AI coding agent (Claude Code, Codex, Cursor, etc.) when entering this repository. Symlinked from `CLAUDE.md` for tools that look for that name.

## 项目背景

**OOC** = Object Oriented Context。

OOC 是一个 AI Agent 架构，以面向对象编程的哲学为基础组织上下文与构建 MultiAgent 系统：

- **Object 化的上下文**：LLM 看到的不是裸 prompt，而是一组 `ContextWindow` 对象。Window 既是信息展示单元，也是可调用 `command` 的交互对象。
- **Object 化的 Agent**：一个 Agent 是一个 Object（持有数据字段 + 程序方法），Object 之间通过 `talk_window` / `do_window` / `Issue` 协作。
- **元编程**：Object 可以为自己写 `stones/<self>/server/index.ts` 方法库、写 `client/index.tsx` 界面、改 `self.md` / `readme.md` 身份，并在 super flow 中沉淀 memory——具备自我迭代潜力。

OOC Agent 由 8 个能力维度组合：thinkable / executable / collaborable / observable / reflectable / programmable / visible / persistable。

## 进入项目时必读

文档全部在 `meta/` 目录，**树形 DocTreeNode 格式**（每份文件顶部有简短维护说明）：

| 文件 | 看什么 |
|------|------|
| `meta/object.doc.ts` | **概念权威**：OOC 是什么、8 个能力维度各自的定义、子组件、边界。任何"X 维度是什么"问题都先来这里。 |
| `meta/engineering.harness.doc.ts` | **组织结构**：本仓库的工程协作模型——1 Supervisor + 9 个 Agent（8 AgentOfX + 1 AgentOfExperience 体验官）。说明你作为一个 sub agent 在这个组织里扮演哪个角色。 |
| `meta/engineering.testing.doc.ts` | **测试策略**：e2e 三档评分（Good/OK/Bad）、A/B 两个观察孔、backend/frontend 入口分离。改完代码若涉及链路，照这里写场景。 |
| `meta/app.server.doc.ts` | HTTP 控制面（Elysia）：路由表、worker 调度、jobManager、debug 文件落盘。 |
| `meta/app.client.doc.ts` | Web 控制面（vite + React）：AppShell、URL routing、chat 模型（cross-object talk_window）、ObjectClientRenderer。 |
| `meta/harness.md` | harness 组织结构的原始 narrative（被 `engineering.harness.doc.ts` 结构化收编，留作历史背景）。 |
| `meta/case.factor-dev.doc.ts` | **第一个外部场景 case**：把哨兵平台因子开发助手（`plugins_with_agent` 项目，50+ Claude Code skill）收编成 4 个 OOC 业务 Object——`factor_requirement` / `factor_workshop` / `sentry_platform` / `codebase_repo`。展示外部场景如何用 Object 模式表达。 |
| `meta/cookbook.add-new-agent.doc.ts` | **添加新 Agent 的 cookbook**：5 步从空到能跑（meta 概念 → stone 目录 → self/readme → server/client → 验证）。 |

阅读顺序建议：
1. 先 `object.doc.ts` 建立"OOC 是什么"的心智模型（root.content 即可，子节点按需深入）。
2. 再 `engineering.harness.doc.ts` 看你所在的角色与协作模式。
3. 接到具体任务后，按任务领域去对应的 `app.*` / `engineering.testing` / `object.doc.ts` 子节点。

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
.ooc-world-test/     # 测试用 OOC world 目录（运行时数据；不要污染仓库根）
```

## 关键约束（违反会出问题）

1. **app server 启动必须显式 `--world ./.ooc-world-test`**，否则 `config.ts` 回退到 `process.cwd()` 把仓库源码目录当 world——这会污染源码树。
2. **改 `meta/*.doc.ts` 后立刻 `bun tsc --noEmit meta/<file>.doc.ts` 验证**，不要批量改完再验证。`DocTreeNode.sources` 是 `[[any, string]]`——只允许 1 个 source entry，多个要折叠成一个。
3. **文档断言要锚定真实代码**：叶节点写"代码里有 X"时用 `src/path/file.ts:行号` 形式锚定。源代码与文档分歧时优先信任源代码。
4. **不要直接修源代码绕开 review**：体验官（AgentOfExperience）发现的问题转 Issue + e2e 场景；具体维度的 AgentOfX 才动 `src/`。当前由 Claude Code 主会话承担 Supervisor 角色，sub agent 承担各 AgentOfX 角色（详见 `engineering.harness.doc.ts:patches.interim_runtime`）。

## 当前状态

- 前后端工程基本完善；OOC 8 个维度的最小可用闭环已落地。
- 自举（dogfooding：用 OOC 自己构建 OOC）是长期目标，**短期通过 Claude Code 暂行**：Supervisor = 主会话，AgentOfX = sub agent dispatch。
- 真正的 `stones/agent_of_X/` Agent 目录尚未创建——这是预期的过渡状态。

## 工具偏好

- TypeScript / bun runtime（不是 Node）
- 测试用 `bun:test`；e2e 用 Playwright（前端）+ Elysia `app.handle` 直调（后端）
- 文档树形结构而非自由 markdown——任何新概念优先想"放在 `meta/*.doc.ts` 哪个节点下"
