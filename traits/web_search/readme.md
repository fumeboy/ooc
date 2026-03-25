---
when: always
description: "互联网搜索和网页抓取能力"
---

# 互联网访问能力

你可以通过以下 API 访问互联网，获取实时信息。

## 可用 API

### search(query, maxResults?)

搜索互联网（通过 DuckDuckGo），返回搜索结果摘要文本。

- `query` — 搜索关键词（字符串）
- `maxResults` — 最大返回结果数（默认 8，最大 20）

```javascript
const results = await search("TypeScript 5.0 新特性");
print(results);
```

### fetchPage(url)

抓取网页内容，自动将 HTML 转为可读纯文本。返回字符串（最多 15000 字符）。

- `url` — 网页 URL

```javascript
const content = await fetchPage("https://example.com/article");
print(content);
```

## 注意事项

1. 两个方法都是异步的，必须使用 `await`
2. 网络错误不会抛异常，而是返回 `[错误] ...` 格式的字符串
3. fetchPage 会自动截断超长内容（15000 字符），适合阅读文章和文档
4. search 返回的每条结果包含标题、URL、摘要，可以用 fetchPage 进一步阅读
