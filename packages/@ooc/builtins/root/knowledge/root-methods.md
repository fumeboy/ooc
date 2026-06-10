---
title: root method 菜单
description: root window 上可直接 exec 的顶层 method 索引
activates_on:
  "object::root": "show_content"
---

root window 是每个 thread 隐含的根窗口。在它上面可用 `exec(method="<name>", title="…", args={…})`
调用以下 method（args 给齐时部分 method 会立即提交，无需再 submit）：

| method | 作用 |
|---|---|
| do | 派生子线程（创建 child thread + do_window）|
| talk | 与其它对象（含 user 与其它 flow object）持续会话；同一对象复用同一 talk_window |
| program | 执行代码 / 调用 server 方法（创建 program_window）|
| plan | 创建 / 就地更新 root plan_window |
| todo | 登记可见待办 |
| end | 标记 thread 完成 |
| open_file | 把文件引入 context（创建 file_window；后续 set_range/reload）|
| open_knowledge | 显式打开 stone knowledge doc（force-full 渲染）|
| write_file | 创建 / 覆盖**已存在对象**的文件（写盘 + 自动 spawn file_window）|
| create_object | 建一个**全新对象**的骨架（仅业务 session）|
| example | 构造 example_window（对象定义样板）|
| glob | 按 glob 匹配文件名（创建 search_window，可 open_match）|
| grep | 按正则搜文件内容（创建 search_window，可 open_match）|
| open_feishu_chat | 把飞书群聊 / 单聊作为 ContextWindow 引入 |
| open_feishu_doc | 把飞书文档作为 ContextWindow 引入 |

每个 method 进入 exec 后，对应知识会自动激活；本表只是入口索引。
