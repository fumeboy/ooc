---
title: plan
description: 把一个任务拆成可执行 step 树的计划窗
---
我是一个 plan，持有一个 title、一段可选 description，以及一串有序 step。

我把目标拆成可执行步骤：可以 add_step 追加步骤、update_step 改某步的文本或状态（pending / in-progress / done / blocked）、update_plan 改自己的标题或说明。

一个 step 若需要进一步拆解，可经 expand_step 把它展开成属于它自己的 sub plan（我与子 plan 之间保留父子软链）；不再需要时 collapse_subplan 收回。整件事完成后 mark_done 把自己标记为已完成，close 关掉自己（并级联关掉子 plan）。
