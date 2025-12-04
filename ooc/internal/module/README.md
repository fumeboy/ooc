# 模块系统 (internal/module)

## 使命
- 提供可插拔的工具能力，统一注册到 Agent。
- 每个模块 = `meta.go` + `module.go` + method/对象文件，遵循“单职责”拆分。

## 通用流程
1. 模块初始化时向 `module.Manager` 注册。
2. Manager 为模块生成 Info 对象索引，并注入 Agent。
3. Method 执行时，通过 `MethodExecutor.ExecuteMethod` 获取 `MethodI` 实例，然后调用其 `Execute` 方法。

## 核心实现
- `Provider` 接口：`Executors()` 返回 `func(methodName string) agent.MethodI`，根据方法名返回方法实例。
- `Manager`：管理所有 Provider，提供 `ExecuteMethod` 方法实现 `agent.MethodExecutor` 接口。
- `MethodI.Execute`：所有方法都实现 `Execute(action *ActionState) (string, []InfoID, error)` 方法。

## TDD 策略
- 为每个模块提供 fake backend，避免真实副作用。
- `manager_test.go`：注册/去注册流程、重复注册的错误处理、方法执行测试。

## 子目录计划
- `notebook/`：文档 CRUD（✅ 已完成）。
- `terminal/`：shell 窗口控制。
- `filesystem/`：文件引用管理。
- `database/`：数据持久化。
- `browser/`：网页读取。

## 文件结构规范（对应 meta.md 80-87）
- `module.go`：模块基础类型、注册逻辑。
- `module.<Method>.go`：单个方法实现（实现 `agent.MethodI` 接口，包含 `Execute` 方法）。
- `object.<Info>.go`：Info 对象定义及其方法声明。
- Notebook 模块已按此拆分，可作为模板。

## TODO
- [x] Manager + Notebook 示例模块与测试。
- [x] Provider.Executors 变更为 `func(methodName string) agent.MethodI`。
- [x] MethodI 增加 Execute 方法。
- [ ] 实现其他模块（terminal/filesystem/database/browser）。
