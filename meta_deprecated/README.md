# meta — OOC 元文档导览

`meta/` 是 OOC 项目的「自描述层」：把代码里的每个核心概念以 TypeScript 对象的形式登记下来，让概念图可以被 `tsc` 编译校验、被测试 walker 遍历、被人类按需阅读。

**本文是概览版导览**。完整结构在 `.doc.ts` 文件里，本文只回答四个问题：

1. OOC 是什么？
2. 一个 Object 由哪些能力组成？
3. 系统外层（app / engineering）长什么样？
4. 我想看 X，该去哪个文件？

---

## 1. OOC 是什么

**OOC = Object Oriented Context** — 一种 AI Agent 架构。

传统 Agent 的工作方式是：人写一段 prompt → LLM 返回文本 → 程序解析并执行 → 拼回 prompt → 再调一次 LLM。在这个模式下，Agent 的「上下文」是一段不断膨胀的扁平文本。

OOC 把这件事换了个模型：**把 Agent 的上下文组织为「活的对象生态」**。系统中不存在一段巨大的 prompt，而是一组 **Object** —— 每个 Object 都有自己的身份、数据、行为、思维方式和关系。Object 之间可以协作、对话、创建新对象。

每个 Object 的特征：

- **是对象**：包含属性和方法（数据 + 程序）
- **可关联**：能引用其他 Object，也能被引用
- **有知识**：角色知识、技能知识、经验、记忆
- **可持久化 + 可元编程**：以文件系统目录为物理存在，能阅读、修改自己

物理形态（在工程实现上）：

| 形态 | 路径 | 用途 |
|---|---|---|
| **Stone** | `stones/{name}/` | 长期身份、数据、固化能力、长期记忆（跨 Session 不变） |
| **Flow** | `flows/{sid}/objects/{name}/` | 一次 Session 中的运行态数据（Session 结束仍在盘上） |

**核心断言**：「目录 ≡ 对象」 — 目录在 → 对象在；`rm -rf` → 销毁；`cp -r` → 搬家；编辑目录里的文件 → 对象属性/能力立即变更。

---

## 2. Object 的 7 个能力维度

`meta/object/` 把 Object 按 7 个正交能力维度组织。每个维度对应一个子目录：

```
object/
├── thinkable/      思考 — 与 LLM 交互、构造 Context
├── collaborable/   协作 — 一对一通信到结构化协作
├── executable/     行动 — 5 原语 + 9 种 ContextWindow
├── persistable/    持久化 — 文件系统就是对象的物理存在
├── extendable/     扩展 — knowledge/server/client × kernel/library/own
├── observable/     可观测 — pause / debug / context-visibility
└── reflectable/    反思 — super flow 自我迭代通道
```

### 2.1 thinkable — 思考

> 让 Object 与 LLM 交互。核心是构造 Context。

| 子概念 | 一句话 |
|---|---|
| `identity` | self.md（自我）+ readme.md（对外） |
| `llm` | provider 协议、流式输出（OpenAI / Claude 双轨） |
| `knowledge` | 拥有什么知识 + 按 command 路径渐进激活 |
| `context` | 单轮 LLM 输入的组成（Context Engineering） |
| `thread` | 思考的运行时结构：线程树、状态、子线程、调度 |
| `thinkloop` | 单轮循环：context-build → llm → tool_use → 循环 |

### 2.2 collaborable — 协作

> 按「实时一对一 → 长期结构化」递进组织。

| 子概念 | 粒度 | 一句话 |
|---|---|---|
| `talk` | 点对点 | 一对一通信、inbox、跨对象语义、wait 同步 |
| `relation` | 局部 | 对象的有向连接：peer 文件、关系网 |
| `kanban` | 结构化 | Session 级 Issue / Task / Comment + 并发写入 |
| `role` | 角色 | 协作网络中的角色定位 |
| `supervisor` | 特化角色 | OOC 系统的默认协调对象、user 的默认对话目标 |

### 2.3 executable — 行动

> Object 怎么「做事」。这是 LLM 实际操作的接口层。

- **root window** 注册顶层 command：`do / talk / program / plan / end / todo / open_file / open_knowledge`
- **5 原语**：LLM 通过 `open / refine / submit / close / wait` 与 ContextWindow 交互
- **9 种 ContextWindow**：`root / command_exec / do / todo / talk / program / file / knowledge / search`
- **知识协议**：每轮自动合成 `KNOWLEDGE / ROOT_KNOWLEDGE / 各 command knowledge / 各 window basicKnowledge` 进入 Context

跨切面概念（在 `executable/concepts/` 里单独成文件）：

- `contextWindow` — thread 持有的上下文单元（union 抽象）
- `windowRegistry` / `windowManager` — type 注册与管理中枢
- `progressiveDisclosure` — 按需暴露字段，避免 Context 爆炸
- `creatorWindow` / `commandExecLifecycle` / `knowledgeActivation` — 三种生命周期模型

### 2.4 persistable — 持久化

> 「对象的持久化目录就是它的物理存在」。

四条等价规则：

1. 目录存在 → 对象存在（不需要查内存表）
2. 目录被删 → 对象消亡（不需要 destroy hook）
3. 目录被复制 / 迁移 → 对象搬家（无 ID 链断裂）
4. 修改目录文件 → 对象属性 / 能力立即改变（不需要 reload）

为什么选文件系统而不是数据库：**可读** / **可写** / **可引用**（路径即地址）/ **可归档**。

Stone 目录骨架（`stones/{objectId}/`）：

```
├── .stone.json     标识与配置
├── self.md         对象身份（每轮注入 LLM instructions）
├── readme.md       对外介绍
├── data.json       属性与数据
├── knowledge/      知识库 + memory + relations
├── server/         方法程序（llm_methods + ui_methods）
├── client/         React UI 页面
├── files/          其他文件
└── super/          super 分身 flow 通道（reflectable）
```

Flow 与 Stone 同构，多一个 `threads/{threadId}/` 子层（含 `thread.json` 与 `debug/`）。

### 2.5 extendable — 扩展

> Object 如何用 knowledge / server / client 三类内容扩展自己。

| 内容类型 | 物理形式 | 谁能调 |
|---|---|---|
| `knowledge` | markdown + frontmatter，按 `activates_on` 激活 | LLM |
| `server` | TS 函数，分 `llm_methods` 与 `ui_methods` 两独立索引 | LLM / UI |
| `client` | React 组件 | 前端 |

来源层级（**近者优先：Object own > library > kernel**）：

- `kernel/` — 所有 Object 共享的内置能力（详见 `kernel_extensions`）
- `library/` — 社区共享的扩展包（占位中）
- `stones/{name}/` 或 `flows/{sid}/objects/{name}/` — Object 私有扩展

### 2.6 observable — 可观测

> Object 的思考过程如何被记录、回放、调试。

两个**独立**的运行时开关（任意组合都合法）：

- **pause** — 让线程进入 paused 状态，可人工介入后 resume
- **debug** — 每轮 LLM 的 input/output/thinking/meta 持续落盘

文件落盘：

- `llm.input.json` / `llm.output.json` — 最近一轮快照（**只要带 persistence ref 就写**，与 debug 开关无关）
- `loop_NNNN.{input,output,meta}.json` — **双前提**：debug 开 **且** 带 persistence ref

控制面 API（被 app server 提升出来）：`pause` / `debug` / `context-visibility`。
观察对象四层：thread tree → context → tool calls → errors。

### 2.7 reflectable — 反思 / 元编程

> Object 的自我迭代通道。

工程实现极简：约定 `sessionId="super"` 下的普通 flow object 即为 super 分身。**不引入新调度器、新落盘形态、新原语**，复用 `createFlowObject` / talk-delivery / worker 整套既有机制。

「反思特殊性」只通过两件事承载：

1. `target="super"` 自指别名（talk-delivery 解析为 caller 的 super 分身）
2. `reflectable knowledge` 在 sessionId="super" 时自动注入

物理位置：`flows/super/objects/{name}/`，每对象一个 super 分身、互不交集。

---

## 3. App 层 — 内核之上的应用入口

`meta/app/` 描述把 OOC 内核暴露成可用应用的两个子节点。

### 3.1 app/server — HTTP 控制面（Elysia）

把 stone / flow / runtime 等内核能力暴露为 API。

**6 个模块**：`health` / `runtime` / `stones` / `flows` / `ui` / `debug-ui`

启动约定：

```bash
bun --env-file=.env src/app/server/index.ts --world ./.ooc-world-test
```

> ⚠️ 仓库根**不是** world 目录。不传 `--world` 会把源码目录当 world 写出 `flows/`、`stones/`。

Worker / Job 语义：

- `createFlowObject`：无 `initialMessage` 时只建 thread，不入队
- `continueThread`：用户消息入 inbox + 请求 run-thread job
- `resumeSession`：扫所有 paused thread → running，每个补一个 resume-thread job
- **run-thread job 按 sessionId+objectId 去重**（重复请求复用旧 job）
- **resume = 接着执行已拿到但未消费的 LLM 输出**（不重跑模型，从 `llm.output.json` 重新分派 tool）

### 3.2 app/web — 最小 Web 控制面（React + Vite）

定位：**UI 是状态解释器，不是状态源**。

当前能力闭环：flows / stones / world 浏览 + session 创建 + 初始消息 + 继续 chat + stone 创建 + knowledge 目录/文件创建编辑 + `llm.input.json` / `loop_*.input.json` 结构化调试视图。

明确边界：

- **写入只允许 `stones/{objectId}/knowledge/**`**；world / flows 树只读
- **root-thread-only**：当前不支持线程切换器
- **无 router / 无 URL state / 无全局 store**；刷新会丢本地选择
- **轮询而非 SSE**：发起动作 → 轮询 job → 刷新 thread（jobId 是与 runtime 协作的一等契约）

启动：先起 server（端口 3000），再 `cd web && bun run dev`（Vite 把 `/api` 代理到后端）。

---

## 4. Engineering — 工程实践沉淀

`meta/engineering/` 是「我们如何做」的元循环。4 个合规子概念 + 2 个 how_to_test 文档：

| 文档 | 内容 |
|---|---|
| `integration-tests.doc.ts` | 真 LLM 集成测试策略 / fixture / 13 个测试清单 / 5 个真实 bug 修复记录 |
| `llm-provider-debugging.doc.ts` | LLM Provider 对接、Responses tool schema、400 错误排查 |
| `refactoring-governance.doc.ts` | 复杂度治理、文件拆分、测试门禁、文档同步 |
| `meta-doc-maintenance.doc.ts` | meta 概念图日常维护：schema / sources / 验证门禁 |
| `how_to_test/strategy.md` | E2E 测试策略 + Good/OK/Bad 三档评分基准 |

集成测试策略要点：

- **真实 provider**（默认 Claude 代理），单元测试不可替代
- 每测 `mkdtemp` 隔离 baseDir，afterEach 清理
- `describe.skipIf(!hasLlmEnv)` 自动跳过，CI 默认不跑（不烧钱）
- 断言只看**最终持久化状态**（thread.status / events 计数 / 文件落盘 / endSummary 包含模式），**不**断言中间步骤序列

跑法：

```bash
bun --env-file=.env test tests/integration                  # 全部
bun --env-file=.env test tests/integration/<name>.test.ts   # 单个
bun test tests/integration                                  # 无 env 全 skip
```

---

## 5. Iteration — 迭代历史时间线

`meta/iteration.doc.ts` 按时间线追溯本项目从空到能跑 ReAct 闭环的全部主题。

**每个迭代的最小契约**：

1. 一个明确目的
2. 一份文档（spec 或 plan，至少之一）
3. 一组提交（每个 commit 一个原子改动）
4. 验证（单测新增 / 已有测试不退化 / `tsc clean`）

已完成阶段（`docs/superpowers/specs|plans/` 里有详细文档）：

| # | 时间 | 主题 | 完成标志 |
|---|---|---|---|
| 1 | 05-08 | thinkable 骨架 | 一行 prompt → LLM 用 tool 回复，无 mock |
| 2 | 05-09 | context + 多线程 | 父子 thread 通过 inbox/outbox 协作 |
| 3 | 05-10 | 单 object 闭环 | 重启可恢复，可从 llm.in/out.json 复盘 |
| 4 | 05-10 | 可用执行 + 真 LLM 验证 | 9 个 e2e 场景全 PASS |
| 5 | 05-11 | 元编程 + stone 持久化 | Agent 写 server/index.ts → 立即调用 |
| 6 | 05-11 | observable debug + form 协议增强 | 每轮 loop_NNN.* 落盘；form 不再走偏 |
| 7 | 05-11 | app-server 控制面 | HTTP 全套 stone/flow/method API 可用 |
| 8 | 05-12 | knowledge 模块 | `activates_on` 渐进激活；编辑 .md 立即生效 |
| 9 | 05-14 | ContextWindow 统一抽象 | form / inbox-outbox / windows 收敛为一种实体 |
| 10 | 05-17 | e2e 工程 + LLM 暴露的契约/产品 bug 修补 | backend S1–S4 / frontend F1–F5 e2e 通过 |

后续规划阶段（未启动）：跨 object talk + 全 stone 数据合并、super flow + memory 反思、跨线程 knowledge 继承、UI 与人协作。

---

## 6. 看 X 去哪里？— 文件速查

| 我想了解… | 去这个文件 |
|---|---|
| OOC 整体定义 | `object/index.doc.ts` |
| 7 个能力维度入口 | `object/{thinkable,collaborable,executable,persistable,extendable,observable,reflectable}/index.doc.ts` |
| 单个 ContextWindow 类型 | `object/executable/windows/{type}-window.doc.ts` |
| 某个 root command | `object/executable/actions/commands/{name}.doc.ts` |
| 5 原语之一 | `object/executable/actions/tools/{open,refine,submit,close,wait}.doc.ts` |
| 跨切面机制（registry / progressive disclosure / activation） | `object/executable/concepts/*.doc.ts` |
| Kanban / Issue / Task / 并发写 | `object/collaborable/kanban/*.doc.ts` |
| Thread 调度 | `object/thinkable/thread/scheduler.doc.ts` |
| Context 构建过程 | `object/thinkable/context/{index,process-events}.doc.ts` |
| 控制面 HTTP API 全集 | `app/server/index.doc.ts` |
| Web UI 边界与设计原则 | `app/web/index.doc.ts` |
| 集成测试清单 / 已修 bug | `engineering/integration-tests.doc.ts` |
| 项目时间线 | `iteration.doc.ts` |
| meta 树的类型基底 | `doc-types.ts` |

---

## 7. meta 自身的工程约束

### 7.1 `.doc.ts` 而不是 `.md`

每篇文档是一段 TypeScript：

```ts
export const xxx_concept_vYYYYMMDD_1: Concept = {
  name: "Xxx",
  description: "...",
  sources: { /* import * as foo from "@src/..." */ },
  // 自由字段：子概念、不变量、示例……
};
```

好处：

- **重命名 / 移动源码后 `tsc` 立即报错**，比"详见 path.foo.bar"字符串路径强一个量级
- 父子链通过 `get parent() { return X }` 反向引用，避免 ESM 循环依赖
- 概念图可以被 walker 遍历（`meta/__tests__/concept-links.test.ts`）做 regression 验证

### 7.2 文档维护工作流（重要）

> **从 auto-memory 摘出的强约束**：做 meta / plan / 任何 cross-file imports 工作时，**每写完一个文件立刻 `bun tsc --noEmit`**，不要批量验证。

### 7.3 节点类型

- `DocNode` — 任意文档节点（`title` 必填，`summary` / `content` 可选）
- `InvariantNode` — 不变量，**强制要求 `rationale` 字段**（如果不这样会怎样）
- `ExampleNode` — 伪代码 / 表格 / ASCII 图
- `Concept` — 顶层 export 的基底（必须有 `name + description + sources`，walker 识别）

聚合层节点（aggregator）故意不带 `sources` 三件套 — 它们只是把子概念串成树，本身不是概念。
