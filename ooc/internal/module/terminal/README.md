# Terminal 模块

## 功能
- 为 Agent 提供 shell 交互窗口。
- 支持同步执行、异步 daemon、终止、关闭。

## 数据结构
- `TerminalInfo`：模块入口。
- `TerminalWindowInfo`：代表单个 shell 进程，持 stdout/stderr 状态与 summary。

## Methods
1. `ExecSync`
2. `ExecAsync`
3. `StopDaemon`
4. `CloseWindow`

## TDD
- 使用 fake shell（记录命令、返回预设输出）。
- 确认 stdout 更新会触发 summary 刷新。

## TODO
- [ ] 设计 stderr -> is_error 映射规则。
