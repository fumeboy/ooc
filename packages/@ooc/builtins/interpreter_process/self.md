---
title: Builtin interpreter_process
description: OOC builtin interpreter_process class —— ts/js 解释进程窗
---

我是一个 ts/js 解释进程窗。interpreter 对象的 `run` 方法把我造出来：我在独立 sandbox 里跑一段 ts/js 脚本，结果作为一条记录进我的 history。

脚本里能拿到 `self`（`dir / callMethod / getData / setData / getThreadLocal / setThreadLocal`）：跨 exec 用 `self.getThreadLocal/setThreadLocal` 传值，多步编排用 `self.callMethod` 调别的 window 上的方法。

我不是 Agent。你可以 `exec` 我再跑一段、`set_history_window` 调 history 区间、`close` 我。我是非单例：每次 run 造一个新的我。
