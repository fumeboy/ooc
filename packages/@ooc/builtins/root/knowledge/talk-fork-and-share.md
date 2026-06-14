---
title: 子线程与跨 thread 共享 window
description: 通过 talk(target=自己) fork 子线程交互，以及 readonly-ref/move 分享 ContextWindow
activates_on:
  "object::talk": "show_content"
---

`talk(target=自己的 objectId)` fork 一条同对象子线程，产出一个 **fork 子窗**（isForkWindow）。
你通过这个窗与子线程交互（say 追加消息 / wait / close / share）。
（`talk(target=别的对象)` 是 peer 跨对象会话，不 fork——见 cross-object talk。）

## 把 window 分享给对端（talk_window.share，仅 fork 子窗）

通过 fork 子窗的 `share` 命令，把已有 ContextWindow 传给对端 thread，两种引用模式：

- **readonly-ref**（只读引用）：对端拿到分享时刻的 freeze snapshot；你保留 mutable-ref（owner）继续操作。
  对端的 readonly-ref 不能 exec 改 object 的命令（仅可 close 释放本地引用）。
- **move**（移交所有权）：对端升为 mutable-ref（拿到完整 live owner）；你这边降为只读 shadow，看分享时刻的 snapshot，
  等对端归还后恢复。

```
exec(window_id="<fork_window>", method="share",
     args={ window_id: "<target_window>", mode: "readonly-ref" | "move" })
```

**归还**：move 进来的 owner 想还回去时，在 creator fork 窗（指向原 owner）上用 mode="move"
发起，系统按 id 自动配对完成。fork 子窗结束（子线程结束 / 父强制 close）时，借出的 owner
会自动归还。

**talk fork 语法糖**：fork 子线程时一次带走多个 window：

```
exec(method="talk", title="…", args={
  target: "<你自己的 objectId>",
  msg: "…",
  share_windows: [
    { window_id: "w_file_123", mode: "readonly-ref" },
    { window_id: "w_kn_456", mode: "move" }
  ]
})
```

不可分享的类型：fork 子窗 / talk / method_exec / root。
