# OOC Agent 系统总览

> 先写清楚问题，再动手写一行代码。这里记录整个工程的设计原则、数据结构、子模块状态，以及各目录 README 的索引。

## 核心目标
- 构建一个基于可交互信息对象 (InfoI) 的 Agent 平台，所有能力都抽象为对象间的对话。
- 保证“Never break userspace”：任何新增能力都不能破坏已有对话流程。
- 文档先行 + TDD：所有模块先在 README 中定义数据结构与测试，再实现代码。

## 内核对象模型
- **InfoI**：可交互信息对象接口，提供名称、描述、私有 Prompt、完整 ID（`ID()` 返回含 class 前缀），以及一组 Method。
- **MethodI**：方法接口，提供名称、描述、文档、参数 JSON Schema，以及 `Execute` 方法。
- **Conversation**：一次 Talk 的上下文，记录 from/to、content、references、activity history。
- **Activity**：对话过程中的一次行动记录（talk/act/ask 等），包含方法执行或子对话信息。
- **Session**：封装一次用户请求到完成的整个生命周期，追踪所有衍生对象。
- **附身机制**：允许用户介入 LLM 决策过程，查看和修改 LLM 的输出结果后再继续执行。

## 任务拆分
1. **文档管控**：维护本 README 及所有目录 README，确保方案与实现同步。
2. **对象注册与存储**：负责 Info/Conversation/Activity 的注册、引用计数、持久化接口。
3. **思考循环**：实现 AssembleContext → LLM Call → ApplyResult 的有限状态机。
4. **Activity 执行**：构建参数、调度模块 Method、写回结果。
5. **模块管理**：Notebook/Terminal/Filesystem/Database/Browser 的统一注册与生命周期。
6. **Session & Story Runner**：执行 `meta.md` 中定义的故事用例，驱动端到端测试。
7. **前端/Server 接口**：暴露 HTTP API、事件流，供 UI 响应 Ask/Respond。

## TDD 与 Storybook
- `stories/`（后续创建）将复用 `Hello/ListFiles/ComplexLogic` 三个故事作为集成测试入口。
- Unit Test 先行：每个数据结构与模块方法都需要 `_test.go`，通过 fake LLM/Registry 驱动。
- Story Runner 连接 LLM mock，验证多轮对话与工具调用链路。

## 目录文档索引
- `meta.md`：整体理念与抽象（已读）。
- `cmd/README.md`：主程序与启动流程。
- `cmd/server/README.md`：HTTP 入口与 Session API 设计。
- `internal/README.md`：内部包通用规范与依赖关系。
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
- `web/README.md`：前端交互约束。

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
- 核心数据结构：`InfoI`、`MethodI`、`ConversationState`、`Activity`
- `Registry`：管理 Info/Conversation/Activity 的生命周期
- `ConversationEngine`：实现思考循环（Think/ThinkLoop）
  - 支持普通 Conversation 和 Action 模式
  - 实现 Talk/Ask/Focus/Respond 特殊方法
  - Action 完全复用 Conversation 的能力
- Conversation 支持 `Parent` 字段，将追问场景的子对话串联到父对话并在 Prompt 中连续展示行动历史
- `MethodI` 包含 `Execute` 方法，直接通过方法实例执行
- `conversationSystemPrompt`：提供系统级提示，说明 Conversation 机制与可用方法（Respond/Talk/Ask/Focus），在 Think 中作为 system message 发送
- `Conversation.Prompt()`：仅组装当前对话上下文（参与对象、引用、请求内容、历史 Activities 等），作为 user message
- `ModuleManager`：模块注册与调度
- `ModuleProvider` 接口：`Executor(methodName string) MethodI`
- **对话模式管理**：支持三种对话执行模式
  - `manual`：完全手动模式，每次思考都需要用户确认
  - `hosted`：完全托管模式，自动执行思考循环
  - `semi_hosted`：半托管模式，在附身状态下需要用户确认
- **附身功能**：允许用户介入 LLM 的决策过程
  - 通过 `SetPossess` API 开启/关闭附身模式
  - 附身模式下，每次思考时先调用 LLM 获取输出（方法名和参数）
  - 将 LLM 输出转发给用户，允许用户查看、修改或确认
  - 用户确认后，使用修改后的结果继续执行
  - 附身时 ThinkLoop 会退出并更新 Conversation 状态为 `waiting_manual_think`
  - 用户回复后通过 `ResumeManualThink` 恢复思考循环

#### ✅ `internal/module/notebook`
- `Module` 实现 `InfoI` 和 `Provider` 接口
- `CreateNote` 和 `ListNotes` 实现 `MethodI` 接口，包含 `Execute` 方法
- 遵循 meta.md 文件结构规范

#### ✅ `internal/session`
- `Session` 和 `Event` 数据结构
- `MemoryStore` 实现，支持会话和事件存储
- Session 状态管理：
  - `running`：会话正在进行
  - `completed`：会话完成
  - `waiting_answer`：等待用户回答 Ask 问题
  - `waiting_manual_think`：等待用户确认/修改 LLM 输出（附身模式）
  - `error`：会话失败
- Session 状态聚合：从所有 Conversation 的状态中聚合，按优先级取最高状态
  - 优先级（从高到低）：`waiting_manual_think` > `waiting_answer` > `running` > `error` > `completed`
- 附身功能支持：通过 `Engine.Possessed` 字段控制附身状态，Conversation 保存手动思考请求（`WaitingManualThinkRequest`），包含 LLM 的输出结果

#### ✅ `cmd/storybook`
- Story Runner 实现，支持运行单个或所有测试用例
- `RunStoryByName`：运行指定的 story，支持超时控制和状态轮询
- `RunAllStories`：批量运行所有 stories，汇总成功和失败结果
- 集成 Session 管理，记录执行过程和结果

#### ✅ `internal/server`
- HTTP API 服务（使用 Echo 框架）
- Session 管理 API：创建、查询、列表
- Conversation 管理 API：创建（Talk）、查询、列表
- Info 查询 API：单个查询、列表查询
- Ask 回答 API：处理 LLM 提出的问题
- **附身功能 API**：
  - `POST /api/sessions/:id/possess`：设置附身状态（SetPossess），开启/关闭附身模式
  - `GET /api/sessions/:id/waiting_manual_conversations`：获取等待手动思考的 Conversation 列表
  - `POST /api/sessions/:id/manual_think`：回复手动思考请求（RespondManualThink），用户确认/修改后的结果

### 待实现模块
- `internal/module/terminal`：shell 窗口控制
- `internal/module/filesystem`：文件引用管理
- `internal/module/database`：数据持久化
- `internal/module/browser`：网页读取
- `cmd/server`：主程序入口

### 进行中
- `web`：前端代码（布局/状态/测试规划已写入 `web/README.md`）；路由已切到 `react-router-dom@6`，URL 成为 tab/Session 选择的唯一来源，并补充路由解析单元测试。

### 下一步
- 实现其他模块（terminal/filesystem/database/browser）
- 实现 HTTP API 服务
- 完善 Story Runner 的错误处理和日志输出
