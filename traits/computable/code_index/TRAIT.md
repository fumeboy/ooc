---
namespace: kernel
name: computable/code_index
type: how_to_use_tool
version: 0.1.0
when: never
description: 代码语义索引能力（符号查找 / 引用查找 / 调用链 / 语义搜索）
deps: []
---
# 代码索引能力

当你需要在代码里"跳转到定义"、"查找引用"、"枚举符号"时，使用本 trait 而不是 grep 盲扫。
底层是基于正则的轻量 TS/JS 索引（MVP），覆盖 function/class/interface/type/const 五类符号。

## 可用 API

### symbol_lookup({ query, kind?, lang? })

按名称精确查找符号定义。返回 `{ file, line, kind, name }[]`。

- `query` — 符号名（字符串精确匹配）
- `kind` — 可选，过滤 "function" | "class" | "interface" | "type" | "const"
- `lang` — 可选，过滤 "ts" | "tsx" | "js" | "jsx"

```javascript
const r = await callMethod("computable/code_index", "symbol_lookup", { query: "handleOnTalkToUser" });
// r.data = [{ file: "kernel/src/x.ts", line: 42, kind: "function", name: "handleOnTalkToUser" }]
```

### find_references({ symbol, lang? })

在索引范围内查找符号的引用位置。返回 `{ file, line, content }[]`。

```javascript
const r = await callMethod("computable/code_index", "find_references", { symbol: "buildContext" });
```

### list_symbols({ path, kinds? })

列出某个文件或目录内所有符号。

```javascript
const r = await callMethod("computable/code_index", "list_symbols", { path: "src/thread/engine.ts" });
// r.data = [{ file, line, kind, name }, ...]
```

### call_hierarchy({ symbol, direction })

调用链分析。`direction: "callers"` 返回谁调用了它；`"callees"` 返回它调用了谁（MVP 只做 callers）。

### semantic_search({ query, topK? })

语义搜索（MVP 阶段退化为 grep + 排序，预留接口）。

### index_refresh({ paths? })

触发索引重建。若不传 paths 则重建整个 rootDir（受 scanDirs 白名单限制）。

## 注意事项

1. 索引只在内存中；服务重启后会自动重建（首次调用触发）
2. MVP 版本基于正则，精度不如 tree-sitter，但对常规命名足够用
3. 默认忽略 `node_modules` / `.git` / `.存档` / `dist` / `build`
