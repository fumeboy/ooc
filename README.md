# OOC — Object Oriented Context

An AI Agent architecture that organizes context and builds multi-agent systems with the philosophy of object-oriented programming.

OOC = **每个 Object 是 (上下文 + 方法 + 身份 + 协作通道) 的统一体**：
- LLM 看到的不是裸 prompt，而是一组可调用的 `ContextWindow` 对象
- 每个 Agent 是一个 Object（数据字段 + 程序方法），Object 之间通过 talk / do / PR-Issue 协作
- Object 可以为自己写 server method 库、写 UI 客户端、改 self.md / readable.md 身份，**具备自我迭代能力**

## Quick start

```bash
bun install          # bun runtime，不是 Node

# 起开发栈：backend(:3000) + vite 前端(:5173) + hot-reload，挂本仓自带测试 world
bun packages/@ooc/cli/src/index.ts dev --world ./.ooc-world
```

打开 http://localhost:5173/welcome 创建第一个 session。

CLI 一条等价于手动起两个进程：

```bash
# backend（HTTP 控制面 + worker，端口 3000）
bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world
# 前端（vite，端口 5173，proxy /api/* → backend）
cd packages/@ooc/web && bun run dev
```

> **`--world` 必须显式给**：backend 无 `--world` 时回退 `$OOC_WORLD_DIR` → `$PWD`，会把仓库源码目录当 world 数据写入、污染源码树。根 `package.json` 的 `dev` script 没带 `--world`，别直接 `bun run dev` 起 world。
> 真 LLM（跑 agent / e2e）需在 world 根放 `.env`：`OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL`。

### CLI 命令

| 命令 | 作用 |
|---|---|
| `ooc init [path]` | 脚手架一个全新 world（生成 `.world.json` / `stones/{supervisor,user}/` 等） |
| `ooc dev --world <dir>` | 开发栈：backend + vite + hot-reload |
| `ooc start --world <dir>` | 生产：仅 backend，无 hot-reload |
| `ooc build` | 预编译 stones → `.ooc-dist/` |

> `ooc` bin 指向 `packages/@ooc/cli/src/index.ts`。interim 期未发布 npm，故上表写全 `bun packages/@ooc/cli/src/index.ts <cmd>`；link bin 后可直接 `ooc <cmd>`。

## 项目结构

```
packages/@ooc/
├── core/                # 运行时核心
│   ├── thinkable/       # 思考（LLM、context、knowledge、thread/thinkloop）
│   ├── executable/      # 行动（tools、windows、object methods）
│   ├── observable/      # 观测（LlmObservation、pause、debug）
│   ├── persistable/     # 持久化（stones/、flows/、pools/、PR-Issue、git versioning）
│   ├── extendable/      # 外接集成层（飞书等；非维度）
│   ├── runtime/         # ObjectRegistry + 热更 loader
│   └── app/server/      # HTTP 控制面 + worker
├── builtins/            # builtin 对象（root/file/… 五件套形态）
├── web/                 # 前端控制面（vite + React + react-router）
├── cli/                 # CLI 入口（init/dev/start/build）
└── storybook/           # 能力测试框架（9 特性 story + CI gate）
tests/e2e/               # 端到端测试场景
.ooc-world/              # 本仓自带测试 world（运行时数据，gitignore）
.ooc-world-meta/         # OOC 自举 world：用 OOC 对象树管理 OOC 自身的定义/文档/测试
                         #   （= github.com/fumeboy/ooc-0 的独立 clone，父仓 gitignore，非 submodule）
```

## 文档地图

**OOC 的定义、9 维度设计、工程协作模型、测试规格已全部活在 `.ooc-world-meta` 对象树**——
由 supervisor + 各维度 OOC Object 自管（OOC 用自己描述自己）。建议阅读顺序：

| 想知道 | 看这里 |
|---|---|
| OOC 是什么、9 个能力维度边界、核心哲学 | `.ooc-world-meta/.../supervisor/self.md` + `knowledge/{ooc-philosophy,ooc-glossary}.md` |
| 工程协作模型 (Supervisor + AgentOfX harness) | supervisor `knowledge/engineering-harness.md` |
| 测试策略 + 各能力测试规格 | supervisor `knowledge/testing-strategy.md` + 各 `children/<dim>/knowledge/tests.md` |
| 某维度怎么设计的 | `children/<dim>/self.md`（核心设计先行）+ `knowledge/` |
| 想加一个新对象 / 外部场景 case | supervisor `knowledge/{authoring-objects,example-cases}.md` |

> 新工作环境拉下父仓不含对象树，需手动补：
> `git clone https://github.com/fumeboy/ooc-0.git .ooc-world-meta/stones/main`
> 并写 `.ooc-world-meta/.world.json` = `{ "allowEscapeWorldFilePathLimit": true }`。

每个维度对象的断言锚定真实代码 `packages/@ooc/.../*.ts:行号`；与代码冲突时一律信代码
（`bun run check:anchor-drift` / `check:doc-drift` 守这条线）。能力测试框架在 `packages/@ooc/storybook/`。

## 测试

```bash
bun test                                            # 单元测试
bun run verify                                       # 全套 CI gate（tsc + core 测试 + 各 check）
RUN_BACKEND_E2E=1 bun test packages/@ooc/tests/e2e/backend     # backend e2e（真 LLM）
RUN_FRONTEND_E2E=1 bun run test:e2e:frontend                   # frontend e2e（Playwright + 真 LLM）
```

e2e 需要 `.env` 配 `OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL`。

## 协作模型

OOC 自身就是用 OOC 架构协作开发的（**dogfooding**）。当前 interim 阶段通过 Claude Code 暂行：
- Supervisor (Claude Code 主会话) 维护哲学层 design
- AgentOfX (sub agent) 各自负责一个维度的工程实现
- AgentOfExperience 以真用户视角校准，把发现转 Issue

详见 supervisor `knowledge/engineering-harness.md`（`.ooc-world-meta`）。

## 工具栈

TypeScript + bun runtime（不是 Node）+ Elysia + React + Vite + Playwright。
