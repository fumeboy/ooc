# cmd/server 入口

## 功能概述
- 暴露 HTTP API：Session 管理、Conversation 操作、事件流。
- 负责进程生命周期（启动/健康检查/优雅退出）。

## 关键组件
- `bootstrap()`：加载配置 → 构造 `internal/server`。
- `run()`：监听端口，注入日志 & metrics。
- `gracefulStop()`：处理 OS signal，确保未完成对话持久化。

## 数据结构与依赖
- 依赖 `internal/utils/config` 读取 `ooc.conf`。
- 依赖 `internal/server` 暴露路由。
- 注册 `internal/session` 以便跨请求共享状态。

## TDD
- `server_main_test.go` 模拟 CLI：
  - 成功路径：配置加载 + HTTP 启动回调。
  - 失败路径：缺失配置、端口占用。

## TODO
- [ ] 定义 CLI 参数列表。
- [ ] 设计健康检查端点。
