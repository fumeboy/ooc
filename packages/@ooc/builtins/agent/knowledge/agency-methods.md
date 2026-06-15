---
title: 方法菜单
description: 你（agent）能 exec 的方法索引 —— 自己的 agency + 成员工具对象的方法
activates_on:
  "object::root": "show_content"
---

你能调的方法分两处。每条的一句描述、必填参数都在 `<window_classes>` 的对应 `<class>` 里声明——
本篇不复述 brief，只给**索引 + 何时用哪条**（class 声明层不承载的元信息）。

`exec(method="<name>", title="…", args={…})` 调用；缺省 window_id = 你自己（self 窗）。
调成员工具对象的方法时，window_id 指向对应成员窗。args 由本次调用直传，给齐即立即执行。

**你自己（self 窗）的 agency**（继承自 `_builtin/agent`）：

- 要**和别的对象（含 user、其它 flow object）持续对话** → `talk`；同一对象复用同一 talk_window，不要重复 open。
- 要**派活给子线程**（自己继续别的事 / 之后再 wait 回写）→ `talk(target=自己的 objectId)` fork 一条子线程。
- 要**把任务拆成可见步骤** → `plan`；只记一条待办 → `todo`；本轮**收尾** → `end`。

这四条 agency 是你身为 agent 的固有能力，跑在你的 self 窗（缺省 window_id）。

**成员工具对象（你 context 里的 tool-object 成员窗）的方法：**

- `filesystem` 成员：把文件引入 context → `open_file`；**搜文件** → `glob`（按名）/ `grep`（按内容）；
  改已存在对象的文件 → `write_file`。
- `terminal` 成员：跑 bash → `run`。`interpreter` 成员：跑 ts/js → `run`。
- `knowledge_base` 成员：把一篇 knowledge 引入 context → `open_knowledge`。
- `runtime` 成员：建**全新对象**骨架 → `create_object`（仅业务 session）。
- 接入**飞书** → `feishu_app` 成员的 `open_chat` / `open_doc`。

每个 method 进入 exec 后，对应知识会自动激活；本篇只是入口索引，具体参数看 `<window_classes>` 里该 method 的 schema。
