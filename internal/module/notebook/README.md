# Notebook 模块

## 功能
- 记录 Agent 的计划、思考与文档。
- 提供 `note` 对象（id/title/content），当前实现 Create/List。

## 文件拆分（遵循 meta.md 80-87）
- `meta.go`：描述模块设计范围、拆分约定。
- `module.go`：定义 Module/Note 结构（均实现 `agent.InfoI`）、模块常量、注册入口、Executors 映射。
- `module.create_note.go`：`CreateNote` 类型实现 `agent.MethodI`，包含参数字段（Title/Content）和 `Execute()` 方法。
- `module.list_notes.go`：`ListNotes` 类型实现 `agent.MethodI`，包含 Module 引用和 `Execute()` 方法。

## 接口实现
- `Module` 实现 `agent.InfoI` 接口（同时满足 `module.Provider`）。
- `Note` 实现 `agent.InfoI` 接口。
- `CreateNote` 类型实现 `agent.MethodI` 接口，包含 `Title`、`Content` 参数字段和 `Execute(action *ActionState) (string, []InfoID, error)` 方法。
- `ListNotes` 类型实现 `agent.MethodI` 接口，包含 `Module` 引用和 `Execute(action *ActionState) (string, []InfoID, error)` 方法。

## Methods
1. `CreateNote`：创建新笔记（需要 title，可选 content）。从 `action.ParameterJSON` 解析参数。
2. `ListNotes`：列出所有笔记（返回 JSON 数组）。

## 文件结构
- `module.go`：Module 定义，实现 InfoI 和 Provider 接口，`Executors()` 返回方法获取函数。
- `module.create_note.go`：CreateNote 实现，包含 Execute 方法。
- `module.list_notes.go`：ListNotes 实现，包含 Execute 方法。
- `object.note.go`：Note 对象定义。

## TDD
- `module_test.go`：通过 Manager 验证 Create/List 行为。
- fake 存储（内存 map），测试 CRUD。

## TODO
- [x] 模块骨架 + Create/List 单元测试。
- [x] 实现 MethodI.Execute 方法。
- [x] 更新 Executors 为函数形式。
- [ ] 定义 summary 自动生成策略。
- [ ] 实现 Note 的编辑和删除功能。
