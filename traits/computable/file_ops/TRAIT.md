---
name: kernel/computable/file_ops
type: how_to_use_tool
version: 1.0.0
when: never
description: 文件读写、编辑、目录操作能力
deps: []
---
# 文件操作能力

你可以通过以下 API 对文件系统进行读写操作。

## 可用 API

### readFile(path, options?)

读取文件内容，返回带行号的文本。默认最多读取 200 行。

- `path` — 文件路径（相对于 rootDir 或绝对路径）
- `options.offset` — 起始行号（从 0 开始，默认 0）
- `options.limit` — 最大读取行数（默认 200）

```javascript
const result = await readFile("src/index.ts");
// result.data = { content: "  1 | ...\n  2 | ...", totalLines: 50, truncated: false }

const partial = await readFile("src/index.ts", { offset: 10, limit: 5 });
// 从第 11 行开始读取 5 行
```

### editFile(path, oldStr, newStr, options?)

在文件中搜索并替换文本。支持精确匹配和空白容错匹配。

- `path` — 文件路径
- `oldStr` — 要查找的原始文本
- `newStr` — 替换后的文本
- `options.replaceAll` — 是否替换所有匹配（默认 false）

```javascript
const result = await editFile("src/index.ts", "old code", "new code");
// result.data = { matchCount: 1 }

// 替换所有匹配
await editFile("src/index.ts", "foo", "bar", { replaceAll: true });
```

### writeFile(path, content)

创建或覆盖文件，自动创建父目录。

- `path` — 文件路径
- `content` — 文件内容

```javascript
const result = await writeFile("output/result.txt", "Hello World");
// result.data = { bytesWritten: 11 }
```

### listDir(path, options?)

列出目录内容。

- `path` — 目录路径
- `options.recursive` — 是否递归列出子目录（默认 false）
- `options.includeHidden` — 是否包含隐藏文件（默认 false）
- `options.limit` — 最大返回条目数（默认 100）

```javascript
const result = await listDir("src/");
// result.data = { entries: [{ name: "index.ts", type: "file", size: 1024 }, ...] }
```

### fileExists(path)

检查文件或目录是否存在。直接返回布尔值（不是 ToolResult）。

```javascript
if (await fileExists("config.json")) {
  const cfg = await readFile("config.json");
}
```

### deleteFile(path, options?)

删除文件或目录。

- `path` — 文件/目录路径
- `options.recursive` — 是否递归删除目录（默认 false）

```javascript
await deleteFile("temp/output.txt");
await deleteFile("temp/", { recursive: true });
```

## 注意事项

1. 所有路径可以是相对路径（相对于对象的 rootDir）或绝对路径
2. readFile 返回带行号的格式化文本，方便定位代码
3. editFile 找不到匹配时会返回上下文片段，帮助你修正搜索文本
4. writeFile 会自动创建不存在的父目录
