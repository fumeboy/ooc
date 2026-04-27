---
namespace: kernel
name: computable/code_index
type: how_to_use_tool
version: 0.2.0
description: 代码语义索引能力（符号查找 / 引用查找 / 调用链 / 向量语义搜索 / 增量索引）
deps: []
---
# 代码索引能力（v2）

当你需要在代码里"跳转到定义"、"查找引用"、"看调用关系"、"按自然语言找函数"时，使用本 trait 而不是 grep 盲扫。

底层：
- **tree-sitter AST**（TS / TSX / JS / JSX / Python / Go / Rust）解析符号
- **正则 fallback**（AST 失败时自动降级，仅 TS/JS 家族）
- **hash n-gram TF 向量**（dim=256，复用 `src/storable/memory/embedding.ts`）做 semantic_search
- **AST 作用域分析**提取 callees（v1 仅支持 callers，v2 双向）
- **增量索引**：`index_refresh({ paths })` 只重扫传入的文件，不全量重建

## 可用 API

在 `program` 沙箱内使用 `callMethod("computable/code_index", method, args)` 调用。单个方法也可以通过 `open({ type: "command", command: "program", title, trait: "computable/code_index", method })` 发起。

### symbol_lookup({ query, kind?, lang? })

按名称精确查找符号定义。返回 `{ file, line, endLine?, kind, name, lang, signature?, docstring? }[]`。

- `query` — 符号名（精确匹配）
- `kind` — 可选，`"function" | "class" | "interface" | "type" | "const"`
- `lang` — 可选，`"ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rs"`

```javascript
const r = await callMethod("computable/code_index", "symbol_lookup", { query: "handleOnTalkToUser" });
```

### find_references({ symbol, lang?, maxResults? })

按单词边界在所有索引文件中查找引用。返回 `{ file, line, content }[]`。

### list_symbols({ path, kinds? })

列出某文件或目录内所有符号（支持绝对或相对路径）。

### call_hierarchy({ symbol, direction })

- `direction: "callers"` — 返回谁调用了它（基于 find_references 减去定义行）
- `direction: "callees"` — 返回它调用了谁（基于 AST 函数体扫描，v2 新增）

callees 的返回结构：
- `file` + `line` 指向调用方（即 symbol 自身的定义位置）
- `content` 是被调用的名称

### semantic_search({ query, topK? })

向量语义搜索。对 query 生成 embedding，与每个 symbol 的 `name + signature + docstring` 向量做余弦相似度排序，返回 topK。

- 同义词 / 上下文无感（hash n-gram TF 不是真语义 embedding；后续可升级）
- 在正则 fallback 路径下 signature/docstring 为空，仅基于 name，效果退化为 token 相似度

### index_refresh({ paths? })

- 不传 paths → 全量重建
- 传 paths → 增量：只重扫这些文件；文件被删除也会清出索引

返回 `{ fileCount, symbolCount, builtAt, incremental, touched }`。

## 注意事项

1. 索引存在内存 + 盘存 `.ooc/code-index/vectors.json`（仅向量；符号索引每次启动由首次调用触发重建）
2. tree-sitter grammar 以 npm 包形式安装（`tree-sitter-typescript` / `tree-sitter-python` / `tree-sitter-go` / `tree-sitter-rust`），wasm 从 `node_modules/tree-sitter-*/*.wasm` 按需加载
3. tree-sitter 加载失败时自动回退到正则（只对 TS/JS 家族有效；其他语言返回空）
4. 默认忽略 `node_modules` / `.git` / `.存档` / `dist` / `build` / `.next` / `.turbo` / `coverage` / `.ooc`
5. 增量触发：如果用 `OOC_CODE_INDEX_HOOK=1` 打开了 code_index 的 build hook，`file_ops.writeFile` / `file_ops.editFile` 会自动触发对应路径的 `index_refresh({ paths })`（默认关闭，按需开启）
