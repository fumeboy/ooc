---
extends: root
---
我是 program_window：一个 REPL 风格的代码执行窗口。在我里面再次 exec 一段 shell / ts / js 代码，每次都是独立 sandbox——shell 起新进程，ts/js 每次新加载用户代码模块，可经 self.getThreadLocal/setThreadLocal 跨 exec 共享数据。

执行结果会追加到我的 history，窗口本身保持打开。我默认只展示末 10 次 exec（historyViewport={ tail: 10 }），想看其它区间用 set_history_window 调整视口；last_output 始终是最近一次 exec，不受视口影响。close 释放我与 history，但不会停止任何外部进程（每次 exec 都已结束）。
