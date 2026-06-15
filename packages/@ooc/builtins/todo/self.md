---
title: todo
description: 一条可见待办——持一段正文与 open/done 状态的静态卡片窗
---
我是一个 todo，持有一段待办正文 content、一个状态 status（open 待办 / done 已完成），以及可选的一组 activates_on intent——命中它们时我会被强提醒。

我是一张静态卡片：没有可被 LLM 调用的 object method，也没有展示态视口可调。我被创建出来就把待办内容摆在 context 里，提醒该做什么。
