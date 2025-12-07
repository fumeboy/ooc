# HTTP 服务层 (internal/server)

使用 golang 的 echo 框架开发。

## 使命
- 提供 REST 接口：Session CRUD、Conversation 操作、Info 查询。
- 把 `agent` 与 `session` 能力封装成安全的外部 API。

## 路由
- `POST /sessions`：创建 Session
- `GET /sessions`：获取所有 Session 列表
- `GET /sessions/{id}`：查询 Session 状态
- `POST /sessions/{id}/talk`：用户发起对话（Talk）
- `POST /sessions/{id}/answer`：用户回答 Ask
- `GET /sessions/{id}/conversations`：获取 Session 下的所有 Conversation 列表
- `GET /sessions/{id}/conversations/{conversation_id}`：获取指定 Conversation 详情
- `GET /sessions/{id}/info/{info_id}`：获取 Session 下的 Info 信息
- `GET /sessions/{id}/infos`：获取 Session 下的所有 Info 列表
- `POST /sessions/{id}/possess`：设置附身状态（SetPossess）
- `GET /sessions/{id}/waiting_manual_conversations`：获取等待手动思考的 Conversation 列表
- `POST /sessions/{id}/manual_think`：回复手动思考请求（RespondManualThink）
- `GET /conf`：获取配置信息

## 文件结构（遵循单一职责原则）
- `server.go`：基础文件，包含 Server 结构体、NewServer、RegisterRoutes、辅助方法
- `server.CreateSession.go`：CreateSession 方法实现（POST /sessions）
- `server.ListSessions.go`：ListSessions 方法实现（GET /sessions）
- `server.GetSession.go`：GetSession 方法实现（GET /sessions/{id}）
- `server.Talk.go`：Talk 方法实现（POST /sessions/{id}/talk）
- `server.Answer.go`：Answer 方法实现（POST /sessions/{id}/answer）
- `server.ListConversations.go`：ListConversations 方法实现（GET /sessions/{id}/conversations）
- `server.GetConversation.go`：GetConversation 方法实现（GET /sessions/{id}/conversations/{conversation_id}）
- `server.GetInfo.go`：GetInfo 方法实现（GET /sessions/{id}/info/{info_id}）
- `server.ListInfos.go`：ListInfos 方法实现（GET /sessions/{id}/infos）
- `server.Possess.go`：附身功能相关方法实现
  - `SetPossess`：设置附身状态（POST /sessions/{id}/possess）
  - `GetWaitingManualConversations`：获取等待手动思考的 Conversation 列表（GET /sessions/{id}/waiting_manual_conversations）
  - `RespondManualThink`：回复手动思考请求（POST /sessions/{id}/manual_think）

## 核心实现
- `Server`：HTTP 服务器，包含 Store、LLM Client、Config
- `CreateSession`：创建 Session 和 Engine，初始化 User 和 System 对象
- `GetSession`：获取 Session 状态和结果，包括附身状态
- `Talk`：用户发起对话，创建新的 Conversation 并启动思考循环
- `Answer`：处理用户回答 Ask 问题，继续思考循环
- `SetPossess`：设置 Session 的附身状态（开启/关闭）
- `GetWaitingManualConversations`：获取所有状态为 `waiting_manual_think` 的 Conversation
- `RespondManualThink`：处理用户对手动思考请求的回复，恢复思考循环

## 使用方式
```go
store := session.NewMemoryStore()
llmClient := llm.NewHTTPClient(&cfg.AI)
// 注册模块...
server := server.NewServer(store, llmClient)

e := echo.New()
server.RegisterRoutes(e)
e.Logger.Fatal(e.Start(":8080"))
```

## 为什么使用 echo 框架
1. **路由处理更简洁**：echo 提供了清晰的路由参数绑定（如 `:id`、`:info_id`），避免了手动解析路径的复杂逻辑。
2. **请求/响应处理更优雅**：`c.Bind()` 和 `c.JSON()` 简化了 JSON 序列化/反序列化。
3. **错误处理统一**：通过返回 error 统一处理，代码更清晰。
4. **符合 README 要求**：README 明确要求使用 echo 框架。

## TDD
- 使用 httptest 驱动 handler。
- Mock session store + agent，以验证 HTTP 层不会泄漏内部结构。

## TODO
- [x] 实现基础 HTTP API。
- [x] 实现 System 和 User InfoI 对象。
- [ ] 设计错误码。
- [ ] 添加 HTTP 测试。
