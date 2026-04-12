---
name: kernel/computable/file_search
type: how_to_use_tool
version: 1.0.0
when: never
description: 文件名模式匹配和内容搜索能力
deps: []
---
# 文件搜索能力

你可以通过以下 API 在文件系统中搜索文件名和文件内容。

## 可用 API

### glob(pattern, options?)

按文件名模式匹配搜索文件，返回匹配的相对路径列表。

- `pattern` — glob 模式（如 `**/*.ts`、`src/**/*.json`）
- `options.basePath` — 搜索根目录（默认为 rootDir）
- `options.limit` — 最大返回数量（默认 50）
- `options.ignore` — 忽略的目录列表（默认 `["node_modules", ".git", ".存档"]`）

```javascript
// 查找所有 TypeScript 文件
const files = await glob("**/*.ts");
// files.data = ["src/index.ts", "src/utils.ts", ...]

// 限定目录和数量
const configs = await glob("*.json", { basePath: "config/", limit: 10 });
```

### grep(pattern, options?)

在文件内容中搜索匹配的文本行，返回匹配结果列表。

- `pattern` — 搜索文本或正则表达式模式
- `options.path` — 搜索目录（默认为 rootDir）
- `options.glob` — 文件名过滤（如 `*.ts`）
- `options.context` — 显示匹配行前后的上下文行数
- `options.maxResults` — 最大返回结果数（默认 30）
- `options.ignoreCase` — 是否忽略大小写（默认 false）

```javascript
// 搜索包含 "TODO" 的行
const todos = await grep("TODO");
// todos.data = [{ file: "src/index.ts", line: 42, content: "// TODO: fix this" }, ...]

// 在 TypeScript 文件中搜索，忽略大小写
const results = await grep("export function", { glob: "*.ts", ignoreCase: true });

// 带上下文搜索
const matches = await grep("error", { context: 2, maxResults: 10 });
```

## 注意事项

1. 所有路径返回相对于 rootDir 的相对路径，保持输出紧凑
2. glob 默认忽略 node_modules、.git、.存档 目录
3. grep 底层使用系统 grep 命令，支持正则表达式
4. 两个方法都有结果数量限制，避免输出过大
