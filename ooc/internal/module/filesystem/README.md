# Filesystem 模块

## 目标
- 记录上下文引用的文件，维护 path + summary。
- 提供文件读取、编辑、删除接口。

## 数据结构
- `FilesystemInfo`：管理 file 引用集合。
- `FileInfo`：实现 InfoI，监听底层文件变化。

## Methods
1. `RegisterFile`
2. `UnregisterFile`
3. `Read`
4. `Write`
5. `Delete`

## TDD
- stub 文件存储层，验证 summary 自动更新。
- 变更检测：模拟文件内容变化 → summary refresh。

## TODO
- [ ] 选择监听机制（fsnotify or polling）。
