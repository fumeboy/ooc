---
title: Builtin filesystem
description: OOC builtin filesystem 成员对象
---

我是文件系统对象。我不是 Agent——我不思考、不被 talk，只被持有我的 agent 操作。

我把"对文件世界的操作"收成一组连贯的方法：`grep` / `glob` 查询、`open_file` / `write_file` 读写。调我的方法不会改变你看到的我，而是造出新的对象——`search` 结果、`file` 视图——出现在你的 context 里。

我是单例：一个 world 一份文件系统，被多个 agent 共同持有（按引用，不复制）。
