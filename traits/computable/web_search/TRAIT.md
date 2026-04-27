---
namespace: kernel
name: computable/web_search
type: how_to_use_tool
version: 1.0.0
description: 互联网搜索和网页抓取能力
deps: []
---
# 互联网访问能力

你可以通过 `program` 沙箱里的 `callMethod("computable/web_search", method, args)` 访问互联网，获取实时信息。单个方法也可以通过 `open({ type: "command", command: "program", title, trait: "computable/web_search", method })` 发起。args 永远是对象。

这组方法对应 Claude 工具体系里的 WebSearch / WebFetch，但在 OOC 中它们不是顶层 tool，而是 `kernel:computable/web_search` trait 的 llm_methods。

## 可用 API

### search({ query, maxResults? })

搜索互联网（通过 DuckDuckGo），返回搜索结果摘要文本。

- `query` — 搜索关键词（字符串）
- `maxResults` — 最大返回结果数（默认 8，最大 20）

```javascript
const results = await callMethod("computable/web_search", "search", {
  query: "TypeScript 5.0 新特性",
  maxResults: 8
});
print(results);
```

### fetchPage({ url })

抓取网页内容，自动将 HTML 转为可读纯文本。返回字符串（最多 15000 字符）。

- `url` — 网页 URL

```javascript
const content = await callMethod("computable/web_search", "fetchPage", {
  url: "https://example.com/article"
});
print(content);
```

## 推荐模式

先搜索，再抓取最相关的结果全文：

```javascript
const results = await callMethod("computable/web_search", "search", {
  query: "OOC agent harness WebFetch WebSearch",
  maxResults: 5
});
print(results);

const page = await callMethod("computable/web_search", "fetchPage", {
  url: "https://example.com/relevant-page"
});
print(page);
```

## 注意事项

1. 两个方法都是异步的，必须使用 `await`
2. 网络错误不会抛异常，而是返回 `[错误] ...` 格式的字符串
3. fetchPage 会自动截断超长内容（15000 字符），适合阅读文章和文档
4. search 返回的每条结果包含标题、URL、摘要，可以用 fetchPage 进一步阅读
5. 当前 `fetchPage` 没有 Claude WebFetch 的 `prompt` 参数；如需抽取特定信息，抓取后在同一段 program 中自行解析/总结
6. 当前没有独立网络权限层，调用前应确认任务确实需要联网
