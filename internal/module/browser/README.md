# Browser 模块

## 功能
- 打开/关闭网页，供 Agent 获取外部信息。

## 数据结构
- `BrowserInfo`：模块入口。
- `WebpageInfo`：url/title/summary，可追踪最近抓取时间。

## Methods
1. `Open`
2. `Refresh`
3. `Close`

## TDD
- Stub HTTP client，返回固定 HTML。
- 验证 summary 生成逻辑可注入 LLM mock。

## TODO
- [ ] 设计抓取超时与缓存策略。
