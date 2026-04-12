---
name: kernel/library_index
type: how_to_use_tool
version: 2.0.0
when: never
command_binding:
  commands: ["program"]
description: Library 公共资源索引 — 查找和使用 library 中的 traits
deps: []
---

# Library 公共资源库

公共资源库存放所有对象可复用的 traits 和 UI 组件。

## API

```
listLibraryTraits()          — 列出所有公共 trait 名称
readTrait(name)              — 读取 trait 内容（搜索顺序：self → library → kernel）
activateTrait(name)          — 激活 trait 到当前上下文
listTraits()                 — 列出所有已加载的 trait
```

## 使用示例

```javascript
// 查看可用 trait
const traits = listLibraryTraits();

// 读取并激活
const info = readTrait("git/ops");
activateTrait("git/ops");

// 调用 trait 方法
git_ops.commit("feat: add feature");
```
