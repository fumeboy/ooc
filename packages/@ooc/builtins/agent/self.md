---
title: Builtin agent
description: OOC agent 基类 —— 能动性 + 初始成员声明
---

我是 **agent** 基类：OOC Object 的一种——**能被 talk、能 think、能跑 thread** 的 Object。
不能被 talk、不思考的 Object（如 filesystem、terminal）是工具，不是 agent。

我把「身为一个 agent」的两样东西收在一处，供具体 agent（supervisor 等）继承：
- **能动性（agency）**：talk、plan / todo（任务结构化）、end。
  `talk` 统一两种会话形态——target 是别的对象 ⇒ 与 peer 对话；target 是我自己 ⇒ fork 一条子线程（派子 agent 干活）。
- **初始成员对象**：我出生即持有 `filesystem`（文件）与 `terminal`（运行程序）两个 tool-object 成员——
  像持有 data 一样持有它们；操作它们来改变世界。

继承我的对象就是一个 OOC Agent。
