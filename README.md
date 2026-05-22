# OOC — Object Oriented Context

An AI Agent architecture that organizes context and builds multi-agent systems with the philosophy of object-oriented programming.

OOC = **每个 Object 是 (上下文 + 方法 + 身份 + 协作通道) 的统一体**：
- LLM 看到的不是裸 prompt，而是一组可调用的 `ContextWindow` 对象
- 每个 Agent 是一个 Object（数据字段 + 程序方法），Object 之间通过 talk / Issue / do 协作
- Object 可以为自己写 server method 库、写 UI 客户端、改 self.md / readme.md 身份，**具备自我迭代能力**

## Quick start

```bash
bun install

# 启动 backend (HTTP 控制面, 端口 3000)
bun --env-file=.env src/app/server/index.ts --world ./.ooc-world

# 启动 web 控制面 (端口 5173)
cd web && bun run dev
```

打开 http://localhost:5173/welcome 创建第一个 session。

**关键约束**：启动 backend 必须显式 `--world ./.ooc-world` —— 否则会把仓库源码目录当 OOC world 数据写入。

## 项目结构

```
src/
├── thinkable/       # 思考能力 (LLM、context、knowledge、thread)
├── executable/      # 行动能力 (tools、commands、ContextWindow)
├── observable/      # 观测能力 (LlmObservation、pause、debug)
├── persistable/     # 持久化 (stones/、flows/、Issue 文件)
└── app/server/      # HTTP 控制面 + worker
web/                 # 前端控制面 (vite + React)
meta/                # 概念文档 (树形 DocTreeNode 源)
tests/e2e/           # 端到端测试场景
```

## 文档地图

OOC 文档**树形组织**在 `meta/`，每份文件顶部有维护说明。建议阅读顺序：

| 想知道 | 看这里 |
|---|---|
| OOC 是什么、8 个能力维度边界 | `meta/object.doc.ts` |
| 工程协作模型 (Supervisor + AgentOfX harness) | `meta/engineering.harness.doc.ts` |
| 测试策略 (Good/OK/Bad 三档 / e2e 场景集) | `meta/engineering.testing.doc.ts` |
| HTTP API 路由表 + 错误模型 | `meta/app.server.doc.ts` |
| Web 控制面架构 | `meta/app.client.doc.ts` |
| **想加一个新 AgentOfX？** | `meta/cookbook.add-new-agent.doc.ts` |

每个维度的工程实现细节在 `meta/object.doc.ts` 的对应 children 节点；与源代码文件路径用 `src/...:行号` 锚定。

## 测试

```bash
bun test                              # 单元测试
RUN_BACKEND_E2E=1 bun test tests/e2e/backend       # backend e2e (真 LLM)
RUN_FRONTEND_E2E=1 bun run test:e2e:frontend       # frontend e2e (Playwright + 真 LLM)
```

e2e 需要 `.env` 配 `OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL`。

## 协作模型

OOC 自身就是用 OOC 架构协作开发的（**dogfooding**）。当前 interim 阶段通过 Claude Code 暂行：
- Supervisor (Claude Code 主会话) 维护哲学层 design
- AgentOfX (sub agent) 各自负责一个维度的工程实现
- AgentOfExperience 以真用户视角校准, 把发现转 Issue

详见 `meta/engineering.harness.doc.ts`。

## 工具栈

TypeScript + bun runtime（不是 Node）+ Elysia + React + Vite + Playwright。
