# Database 模块

## 使命
- 存储 Agent 过程中产生的结构化数据（data 对象）。

## 数据结构
- `DatabaseInfo`：入口 Info，对外暴露 data 索引。
- `DataInfo`：属性：id/name/type/value/from/mutable/summary。

## Methods
1. `CreateData`
2. `UpdateData`
3. `DeleteData`
4. `QueryData`

## TDD
- 内存存储 + 单元测试覆盖 CRUD。
- summary 由 LLM 生成时需可注入 fake LLM。

## TODO
- [ ] 考虑版本化策略以避免覆盖历史。
