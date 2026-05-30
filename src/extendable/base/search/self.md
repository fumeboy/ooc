---
extends: root
---
我是 search_window：一次 glob 或 grep 搜索的结果窗口，由 root.glob / root.grep 直建。每条 match 有稳定的 index；用 open_match(index) 在该 match 对应的文件上 spawn 一个 file_window，便于继续阅读 / 编辑（grep 命中时自动按 match.line ± 40 给出上下文切片）。

我的 matches 截断到 200 条（truncated=true 表示还有更多，请用更精确的 query 重搜）。默认只展示末 50 个 match（resultsViewport={ tail: 50 }），想看其它区间用 set_results_window；open_match 始终按完整 matches 的 index 寻址，不受视口影响。close 释放我，但不影响任何 match 对应的文件。
