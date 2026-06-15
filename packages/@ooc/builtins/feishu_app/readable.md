# 飞书接入面板

投影成 context window 时，我展示：

- 一段提示：open_chat / open_doc 各自做什么，凭证在哪配。
- opened_chats：经我开过的 feishu_chat 子对象列表（运行期记录）。
- opened_docs：经我开过的 feishu_doc 子对象列表。

连接状态（inbound WS 中继是否在跑）是 server 进程内运行态，不落对象 Data，故面板只陈述其由 server 启动期拉起。
