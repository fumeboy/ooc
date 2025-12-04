# cmd 目录说明

## 使命
- 提供可执行入口（CLI/HTTP server）。
- 严格保持“薄”层：只负责解析参数、构造配置、调用内部包。

## SubAgent 划分
1. **启动器**：解析 flags/env，加载 config。
2. **服务装配器**：组装 `internal/server` 提供的 HTTP, 注册 Story Runner。

## 数据流
- 输入：环境变量、配置文件、Story 定义。
- 输出：`internal/server` 的 `Server` 实例 + 运行时诊断。

## TDD 计划
- 使用 `cmd/server/main_test.go`（后续）模拟 CLI 参数，断言装配顺序。
- Fake 配置与 LLM client，验证不会污染真实依赖。

## 进度
- ⏳ 等待 `internal` 层接口稳定后补充主程序。
