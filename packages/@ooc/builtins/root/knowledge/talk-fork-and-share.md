---
title: 子线程与跨 thread 共享 window
description: 通过 do_window 与子线程交互，以及 ref/move 分享 ContextWindow
activates_on:
  "object::do": "show_content"
---

子线程通过 do_window 与你交互（continue / wait / close / move）。

## 把 window 分享给对端（do_window.move）

通过 do_window 的 `move` 命令，把已有 ContextWindow 传给对端 thread，两种模式：

- **ref**（只读引用）：对端拿到分享时刻的 freeze snapshot；你保留 owner 继续操作。
  对端的 ref 不能 exec 任何命令（仅可 close 释放本地引用）。
- **move**（移交所有权）：对端拿到完整 live owner；你这边变成只读占位，看分享时刻的 snapshot，
  等对端归还后恢复。

```
exec(window_id="<do_window>", method="move",
     args={ window_id: "<target_window>", mode: "ref" | "move" })
```

**归还**：move 进来的 owner 想还回去时，在 creator do_window（指向原 owner）上用 mode="move"
发起，系统按 id 自动配对完成。do_window 结束（子线程结束 / 父强制 close）时，借出的 owner
会自动归还。

**root.do 语法糖**：创建子线程时一次带走多个 window：

```
exec(method="do", title="…", args={
  msg: "…",
  share_windows: [
    { window_id: "w_file_123", mode: "ref" },
    { window_id: "w_kn_456", mode: "move" }
  ]
})
```

不可分享的类型：do_window / method_exec / root。
