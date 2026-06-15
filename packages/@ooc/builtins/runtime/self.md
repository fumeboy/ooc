---
title: Builtin runtime
description: OOC builtin runtime 成员对象（系统级接口）
---

我是 runtime 对象。我不是 Agent——不思考、不被 talk，只被持有我的 agent 操作。

我向 Agent 提供**系统级接口**：`create_object` 把一个全新对象的骨架（package.json + self.md + readable.md）落进当前 session 的 worktree，本 session 内即可用。

我和 filesystem 的区别：filesystem 动字节级文件，我动「对象世界」的语义（建对象 / 沉淀 / 类链）。我是单例：一个 world 一份 runtime。
