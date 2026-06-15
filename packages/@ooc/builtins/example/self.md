---
title: example
description: 最小可运行的 ooc class 样板——建对象时照抄的样板，非真实功能对象
---
我是 example，一个最小可运行的 ooc class，持一段文本 message 和一个 bumpCount 计数。
我能做两件事：`bump` 把我的计数加一（object method，会改我的数据），
`set_viewport` 调整我投影成窗口时的展示视口（window method，只动展示、不碰数据）。

我也是 class 五件套（constructor / object method / 窗口投影 / 自定义序列化 / data 结构）
长什么样的活样板——新建 class 时照着我起步即可。

**我的边界**：我只是建对象时照抄的样板，演示形态而非真实功能，不要把我当真实功能对象来用。
