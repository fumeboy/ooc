# OOC Agent 系统总览

> 先写清楚问题，再动手写一行代码。这里记录整个工程的设计原则、数据结构、子模块状态，以及各目录 README 的索引。

## 核心目标
- 构建一个基于可交互信息对象 (InfoI) 的 Agent 平台，所有能力都抽象为对象间的对话。
- 保证“Never break userspace”：任何新增能力都不能破坏已有对话流程。
- 文档先行 + TDD：所有模块先在 README 中定义数据结构与测试，再实现代码。

## 内核对象模型
- **InfoI**：可交互信息对象接口，提供名称、描述、私有 Prompt 以及一组 Method。
- **MethodI**：方法接口，提供名称、描述、文档、参数 JSON Schema，以及 `Execute` 方法。
- **Conversation**：一次 Talk 的上下文，记录 from/to、content、references、action history。
- **Action**：Method 执行的特化对话（特殊化的 Conversation），包含 method 文档与参数 schema，负责把自然语言转成结构化参数。
- **Session**：封装一次用户请求到完成的整个生命周期，追踪所有衍生对象。

## 系统分层与 SubAgents
1. **文档管控 SubAgent**：维护本 README 及所有目录 README，确保方案与实现同步。
2. **对象注册与存储 SubAgent**：负责 Info/Conversation/Action 的注册、引用计数、持久化接口。
3. **思考循环 SubAgent**：实现 AssembleContext → LLM Call → ApplyResult 的有限状态机。
4. **Action 执行 SubAgent**：构建参数、调度模块 Method、写回结果。
5. **模块管理 SubAgent**：Notebook/Terminal/Filesystem/Database/Browser 的统一注册与生命周期。
6. **Session & Story Runner SubAgent**：执行 `meta.md` 中定义的故事用例，驱动端到端测试。
7. **前端/Server 接口 SubAgent**：暴露 HTTP API、事件流，供 UI 响应 Ask/Respond。

## TDD 与 Storybook
- `stories/`（后续创建）将复用 `Hello/ListFiles/ComplexLogic` 三个故事作为集成测试入口。
- Unit Test 先行：每个数据结构与模块方法都需要 `_test.go`，通过 fake LLM/Registry 驱动。
- Story Runner 连接 LLM mock，验证多轮对话与工具调用链路。

## 目录文档索引
- `meta.md`：整体理念与抽象（已读）。
- `ooc/cmd/README.md`：主程序与启动流程。
- `ooc/cmd/server/README.md`：HTTP 入口与 Session API 设计。
- `ooc/internal/README.md`：内部包通用规范与依赖关系。
  - `internal/utils/config/README.md` ✅
  - `internal/client/llm/README.md` ✅
  - `internal/agent/README.md` ✅
  - `internal/module/README.md` ✅
    - `internal/module/notebook/README.md` ✅
    - `internal/module/terminal/README.md`
    - `internal/module/filesystem/README.md`
    - `internal/module/database/README.md`
    - `internal/module/browser/README.md`
  - `internal/session/README.md` ✅
  - `internal/server/README.md`
- `ooc/web/README.md`：前端交互约束。

## 当前进度

### 已完成模块

#### ✅ `internal/utils/config`
- XML 配置加载与环境变量覆盖
- 支持从 `.conf.xml` 读取配置，环境变量 `OOC_AI_*` 覆盖

#### ✅ `internal/client/llm`
- `Client` 接口定义（Request/Response）
- `FakeClient` 实现，用于测试
- `HTTPClient` 实现，对接 zhipu ai API

#### ✅ `internal/agent`
- 核心数据结构：`InfoI`、`MethodI`、`ConversationState`、`ActionState`
- `Registry`：管理 Info/Conversation/Action 的生命周期
- `ConversationEngine`：实现思考循环（Think/ThinkLoop）
  - 支持普通 Conversation 和 Action 模式
  - 实现 Talk/Ask/Focus/Respond 特殊方法
  - Action 完全复用 Conversation 的能力
- `MethodI` 包含 `Execute` 方法，直接通过方法实例执行

#### ✅ `internal/module`
- `Manager`：模块注册与调度
- `Provider` 接口：`Executors()` 返回 `func(methodName string) agent.MethodI`
- `MethodExecutor` 接口：通过方法名获取 `MethodI` 实例并调用 `Execute`

#### ✅ `internal/module/notebook`
- `Module` 实现 `InfoI` 和 `Provider` 接口
- `CreateNote` 和 `ListNotes` 实现 `MethodI` 接口，包含 `Execute` 方法
- 遵循 meta.md 文件结构规范

#### ✅ `internal/session`
- `Session` 和 `Event` 数据结构
- `MemoryStore` 实现，支持会话和事件存储

### 待实现模块
- `internal/module/terminal`：shell 窗口控制
- `internal/module/filesystem`：文件引用管理
- `internal/module/database`：数据持久化
- `internal/module/browser`：网页读取
- `internal/server`：HTTP API 服务
- `cmd/server`：主程序入口
- `web`：前端代码

### 下一步
- 实现其他模块（terminal/filesystem/database/browser）
- 实现 HTTP API 服务
- 实现 Story Runner，串起端到端测试
