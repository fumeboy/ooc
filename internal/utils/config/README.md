# 配置模块 (internal/utils/config)

## 目标
- 提供统一的配置加载、校验、热更新接口。
- 默认读取 `ooc.conf.xml`，可通过 env 覆盖。

## 数据结构
- `Config`：LLM、Server、Story、Module 等子配置。
- `Loader`：负责解析文件 + 合并环境变量。
- `Validator`：输出详细错误，避免启动期崩溃。

## TDD 计划
1. `config_loader_test.go`：
   - 成功加载样例 xml。
   - Env 覆盖优先级。
2. `config_validator_test.go`：
   - 必填字段缺失。

## TODO
- [x] 实现 XML 配置加载与环境变量覆盖。
- [ ] 决定热更新策略。
