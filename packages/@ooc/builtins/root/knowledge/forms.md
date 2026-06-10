---
title: method_exec form 怎么填参与修复
description: 参数不齐时用 refine 累积、submit 触发；失败时 refine 复活
activates_on:
  "object::method_exec": "show_content"
---

调一个 method 时若 args 不齐，系统会建一个 method_exec form（你 context 里的临时 sub-window）。

## 填参与提交

```
exec(form_id, "refine", args={ <补的字段>: … })   // 累积式：相同字段后写覆盖前写
exec(form_id, "submit")                            // 触发执行
```

form 的提示会列出缺失字段，按提示 refine 即可；多个字段一次性放进同一个 refine。

## 失败修复：优先 refine，不要 close 重开

submit 失败时 form 保留，result 含错误信息。**直接 refine 修正字段即可复活重 submit**，
无需 close + 重 open：

```
exec(form_id, "refine", args={ <修正字段>: … })   // 自动清旧 result、切回可填状态
exec(form_id, "submit")                            // 重新执行
```

close + 重开会丢失 form 上已激活的知识与关联，并产生噪声 window。close 只作为
"彻底放弃此次调用"的兜底，不是失败修复首选。

成功的 form 会自动从 context 移除，你下一轮看不到它。
