# internal 包设计原则

## 角色
- 封装所有服务端核心逻辑，不直接暴露给外部模块。
- 以“数据结构优先”方式组织：对象模型 → 循环流程 → 模块扩展。

## 分层
1. `utils/config`：配置加载与校验。
2. `client/llm`：与大模型交互的客户端。
3. `agent`：Conversation/Action/Registry 的内核实现。
4. `module`：Notebook/Terminal/... 等扩展能力。
5. `session`：持久化用户请求生命周期。
6. `server`：HTTP/Story API。

## 依赖约束
- `agent` 可依赖 `client/llm`、`module`；
- `module/*` 禁止反向依赖 `server`；
- `session` 仅与 `agent`、`module` 的接口交互；
- `server` 作为最外层，组合其它包。

## TDD
- 每个子目录 README 需列出接口与测试。
- 顶层集成测试：模拟一个 Story，确保内部依赖 wiring 正确。

## 进度追踪
- ✅ 目录创建
- 🔄 定义 Registry/Session 接口（下一任务）
