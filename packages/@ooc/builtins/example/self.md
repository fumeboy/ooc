---
title: example
description: 最小可运行的 ooc class 样板——演示五件套按维度分文件布局
---
我是 example，一个最小可运行的 ooc class，持一段文本 message 和一个 bumpCount 计数。
我是新建 class 时照着起步的样板：constructor 在 `index.ts`（`Class.construct`），
我的 object method（`bump`，可改我的数据）在 `executable/index.ts`，我作为 context window
的投影与 window method（`set_viewport`，只调展示视口）在 `readable/index.ts`，
自定义序列化在 `persistable/index.ts`，data 结构在 `types.ts`。
