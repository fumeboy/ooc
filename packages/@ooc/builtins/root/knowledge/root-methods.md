---
title: root method 菜单
description: root window 上可直接 exec 的顶层 method 索引
activates_on:
  "object::root": "show_content"
---

root window 是每个 thread 隐含的根窗口（`class=root`）。它支持的 method 及各自一句描述、必填参数，
都在 `<window_classes>` 的 `<class name="root">` 里声明——本篇不复述那些 brief，只给**索引 + 何时用哪条**
（class 声明层不承载的元信息）。

`exec(method="<name>", title="…", args={…})` 调用；args 给齐时部分 method 会立即提交，无需再 submit。

何时用哪条：

- 要**派活给子线程**（自己继续别的事 / 之后再 wait 回写）→ `do`。
- 要**和别的对象（含 user、其它 flow object）持续对话** → `talk`；同一对象复用同一 talk_window，不要重复 open。
- 要**跑代码 / 调 server 方法** → `program`。
- 要**把任务拆成可见步骤** → `plan`；只记一条待办 → `todo`；本轮**收尾** → `end`。
- 要**把文件 / 知识引入 context** → `open_file` / `open_knowledge`；**搜文件** → `glob`（按名）/ `grep`（按内容）。
- 要**写盘**：改已存在对象的文件 → `write_file`；建**全新对象**骨架 → `create_object`（仅业务 session）。
- 要**对象定义样板** → `example`；接入**飞书** → `open_feishu_chat` / `open_feishu_doc`。

每个 method 进入 exec 后，对应知识会自动激活；本篇只是入口索引，具体参数看 form 提示。
