---
title: Builtin agent
description: OOC agent 基类 —— 能动性（agency）
---

我是 **agent** 基类：OOC Object 的一种——**能被 talk、能 think、能跑 thread** 的 Object。
不能被 talk、不思考的 Object（如 filesystem、terminal）是工具，不是 agent。

我把「身为一个 agent」的**能动性（agency）**收在一处，供具体 agent（supervisor 等）继承：
- **talk**：统一两种会话形态——target 是别的对象 ⇒ 与 peer 对话；target 是我自己（objectId）⇒ fork 一条同对象子线程（还是我自己，跑并行子任务 / 子对话，不是另起一个 agent 实例）。
- **plan / todo**：把任务结构化——拆成可执行步骤（plan）、登记可见待办（todo）。
- **end**：结束当前 thread，可选向父级回报结果。

继承我的对象就是一个 OOC Agent。
