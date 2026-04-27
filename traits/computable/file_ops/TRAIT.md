---
namespace: kernel
name: computable/file_ops
type: how_to_use_tool
version: 1.0.0
description: 文件读写、编辑、目录操作能力
deps: []
---
# 文件操作能力

你可以通过 `program` 沙箱里的 `callMethod("computable/file_ops", method, args)` 对文件系统进行读写操作。单个方法也可以通过 `open({ type: "command", command: "program", title, trait: "computable/file_ops", method })` 发起。args 永远是对象。

## 可用 API

### readFile({ path, offset?, limit? })

读取文件内容，返回带行号的文本。默认最多读取 200 行。

- `path` — 文件路径（相对于 rootDir 或绝对路径）
- `offset` — 起始行号（从 0 开始，默认 0）
- `limit` — 最大读取行数（默认 200）

```javascript
const result = await callMethod("computable/file_ops", "readFile", { path: "src/index.ts" });
// result.data = { content: "  1 | ...\n  2 | ...", totalLines: 50, truncated: false }

const partial = await callMethod("computable/file_ops", "readFile", {
  path: "src/index.ts",
  offset: 10,
  limit: 5
});
// 从第 11 行开始读取 5 行
```

### editFile({ path, oldStr, newStr, replaceAll? })

在文件中搜索并替换文本。支持精确匹配和空白容错匹配。

- `path` — 文件路径
- `oldStr` — 要查找的原始文本，不能为空
- `newStr` — 替换后的文本
- `replaceAll` — 是否替换所有匹配（默认 false）

```javascript
const result = await callMethod("computable/file_ops", "editFile", {
  path: "src/index.ts",
  oldStr: "old code",
  newStr: "new code"
});
// result.data = { matchCount: 1 }

// 替换所有匹配
await callMethod("computable/file_ops", "editFile", {
  path: "src/index.ts",
  oldStr: "foo",
  newStr: "bar",
  replaceAll: true
});
```

### writeFile({ path, content })

创建或覆盖文件，自动创建父目录。

- `path` — 文件路径
- `content` — 文件内容

```javascript
const result = await callMethod("computable/file_ops", "writeFile", {
  path: "output/result.txt",
  content: "Hello World"
});
// result.data = { bytesWritten: 11 }
```

### listDir({ path, recursive?, includeHidden?, limit? })

列出目录内容。

- `path` — 目录路径
- `recursive` — 是否递归列出子目录（默认 false）
- `includeHidden` — 是否包含隐藏文件（默认 false）
- `limit` — 最大返回条目数（默认 100）

```javascript
const result = await callMethod("computable/file_ops", "listDir", { path: "src/" });
// result.data = { entries: [{ name: "index.ts", type: "file", size: 1024 }, ...] }
```

### fileExists({ path })

检查文件或目录是否存在。直接返回布尔值（不是 ToolResult）。

```javascript
if (await callMethod("computable/file_ops", "fileExists", { path: "config.json" })) {
  const cfg = await callMethod("computable/file_ops", "readFile", { path: "config.json" });
}
```

### deleteFile({ path, recursive? })

删除文件或目录。

- `path` — 文件/目录路径
- `recursive` — 是否递归删除目录（默认 false）

```javascript
await callMethod("computable/file_ops", "deleteFile", { path: "temp/output.txt" });
await callMethod("computable/file_ops", "deleteFile", { path: "temp/", recursive: true });
```

## 多文件事务（Edit Plan）

跨多个文件做原子性重构时，使用 plan → preview → apply 三段式 API，避免半改动态。

### plan_edits({ changes })

创建编辑计划（不真写），返回 `{ planId, changesCount, preview }`。

`changes` 是数组，每项两种形态：

```javascript
// 局部替换
{ kind: "edit", path: "src/a.ts", oldText: "old", newText: "new", replaceAll: false }

// 整文件覆盖（新建或替换）
{ kind: "write", path: "src/new.ts", newContent: "export const N = 9;\n" }
```

`oldText` 不能为空。

### preview_edit_plan({ planId })

返回 `{ plan, preview }`，`preview` 是 unified-diff 风格的字符串。

### apply_edits({ planId })

原子应用：

- 先读所有文件的 snapshot
- 预计算所有 change 的新内容；任一预计算失败（如匹配不到 oldText）→ 整个 apply 失败，不写任何文件
- 预计算通过后逐文件写盘；任一写盘失败 → 按 snapshot 回滚已写部分

### cancel_edits({ planId })

取消 pending 状态的 plan。

## 注意事项

1. 所有路径可以是相对路径（相对于对象的 rootDir）或绝对路径
2. readFile 返回带行号的格式化文本，方便定位代码
3. editFile 找不到匹配时会返回上下文片段，帮助你修正搜索文本
4. writeFile 会自动创建不存在的父目录
5. plan 持久化在 `flows/{sessionId}/edit-plans/{planId}.json`；无 sessionId 时降级到 `/tmp/ooc-edit-plans/`
