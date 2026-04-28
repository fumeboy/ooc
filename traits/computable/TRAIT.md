---
namespace: kernel
name: computable
type: how_to_think
version: 2.2.0
activates_on:
  show_content_when: ["program"]
description: 代码执行能力 — 代码沙箱与 trait 方法调用
deps: []
---

# 代码执行能力

`program` 有两种执行形态：

1. 直接方法调用：`open({"title":"调用方法","type":"command","command":"program","trait":"kernel:xxx","method":"yyy","description":"..."})`，再用 `refine({"form_id":"...","args":{...}})` 填方法参数，最后 `submit({"form_id":"..."})` 执行。
2. 代码沙箱：提交 `code` 执行 JavaScript / shell。代码在沙箱中运行，内部通过 `callMethod(traitId, methodName, args)` 调用 trait 方法。

两种形态里，方法参数永远是对象。

## 核心 API

```
print(...args)                              — 输出结果（必须用 print）
getData(key) / setData(key, value)          — 任务工作记忆
persistData(key, value)                     — 写入 stone 长期记忆
local.x / local.x = value                   — 当前线程局部变量（跨轮次）
await callMethod(traitId, method, args)     — 在代码沙箱内调用 trait 方法
listTraits() / listActiveTraits()           — 列出 trait
readTrait(name) / activateTrait(name)       — 读/激活 trait
methods(trait?)                             — 列出可调用方法
```

## 首选：直接调用 trait 方法

```json
open({"title":"读取 meta 文档","type":"command","command":"program","trait":"kernel:computable/file_ops","method":"readFile","description":"读取 docs/meta.md"})
refine({"form_id":"f_xxx","args":{"path":"docs/meta.md"}})
submit({"form_id":"f_xxx"})
```

也可以先打开 program trait/method，不立刻指定方法参数；等读取上下文或确认路径后，再 refine：

```json
open({"title":"准备写入结果","type":"command","command":"program","trait":"kernel:computable/file_ops","method":"writeFile","description":"写入整理结果"})
refine({"form_id":"f_xxx","args":{"path":"docs/result.md","content":"# 整理结果\n\n..."}})
submit({"form_id":"f_xxx"})
```

只有需要组合多步脚本、循环或复杂计算时，才打开 `program` 并在 `code` 中使用 `callMethod(...)`。

## 代码沙箱中的 callMethod 示例

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
