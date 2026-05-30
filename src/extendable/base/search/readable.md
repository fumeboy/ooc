search_window：一次 glob / grep 搜索的结果窗口（由 root.glob / root.grep 直建）。每条 match 有稳定 index；open_match(index) 在该文件上 spawn file_window，set_results_window 调整渲染视口，close 释放窗口。
