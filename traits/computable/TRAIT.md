---
namespace: kernel
name: computable
type: how_to_think
version: 2.2.0
when: never
activates_on:
  paths: ["program"]
description: 代码执行能力 — 文件操作、搜索、Shell 命令、数据管理（通过 callMethod 调用）
deps: []
---

# 代码执行能力

通过 `program_submit` 工具执行 JavaScript 代码。代码在沙箱中运行，**所有 trait 方法统一通过 `callMethod(traitId, methodName, args)` 调用**，args 永远是对象。

## 核心 API

```
print(...args)                              — 输出结果（必须用 print）
getData(key) / setData(key, value)          — 任务工作记忆
persistData(key, value)                     — 写入 stone 长期记忆
local.x / local.x = value                   — 当前线程局部变量（跨轮次）
await callMethod(traitId, method, args)     — 调用 trait 方法（唯一方式）
await talk(target, message)                 — 跨对象通信
listTraits() / listActiveTraits()           — 列出 trait
readTrait(name) / activateTrait(name)       — 读/激活 trait
methods(trait?)                             — 列出可调用方法
```

## callMethod 示例

```javascript
// 读文件
const r = await callMethod("computable/file_ops", "readFile", { path: "docs/meta.md" });
print(r.data.content);

// 前 10 行
const r2 = await callMethod("computable/file_ops", "readFile", { path: "docs/meta.md", limit: 10 });
print(r2.data.content);

// 文件名搜索
const files = await callMethod("computable/file_search", "glob", { pattern: "**/*.ts" });
print(files.data);

// Shell
const out = await callMethod("computable/shell_exec", "exec", { command: "ls -la" });
print(out);
```

## 命名空间解析

`callMethod` 的第一个参数可以：
- 完整 traitId：`"kernel:computable/file_ops"`
- 省略 namespace：`"computable/file_ops"` —— 按 self → kernel → library 解析

## 详细文档（按需查看）

使用 `readTrait("kernel:computable/xxx")` 查看：

| 子 trait | 内容 |
|----------|------|
| `program_api` | 完整方法清单 + 参数签名 |
| `file_ops` | readFile/editFile/writeFile/listDir/fileExists/deleteFile |
| `file_search` | glob / grep |
| `shell_exec` | exec / sh |
| `web_search` | search / fetchPage |
