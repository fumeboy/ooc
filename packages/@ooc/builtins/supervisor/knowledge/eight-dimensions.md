---
title: 8 个能力维度速查
description: thinkable/executable/collaborable/observable/reflectable/programmable/visible/persistable
activates_on:
  "window::root": "show_content"
---

# 8 个能力维度

术语解释（server method / ui_method / super flow / sediment 等）见 `world-vocabulary.md`。

| 维度 | 一句话职责 | 主要载体 |
|---|---|---|
| **thinkable** | 思考：LLM 调用、context 构造、thread 调度、knowledge 渐进激活 | 系统内核（无 stone 文件） |
| **executable** | 行动：通用 tools（open / refine / submit / close / wait）+ 全局 commands + ContextWindow 操作 | 系统内核 |
| **collaborable** | 协作：talk_window / do_window / relation_window 跨 Object 通道 | 系统内核 |
| **observable** | 可观测：LLM 调用 trace、pause / resume、debug 文件落盘 | 系统内核 + `debug/` 目录 |
| **reflectable** | 自反思：super flow 元编程闭环（写自身 sediment knowledge） | super flow 协议 |
| **programmable** | 自身函数方法库 | Object 自己的 `executable/index.ts` |
| **visible** | 自身 UI 页面 | Object 自己的 `visible/index.tsx` + 关联 ui_method |
| **persistable** | 文件树：Builtin / Stone / Pool / Flow 四分 | 整个 World 文件系统 |

## supervisor 分发原则

用户提需求时，我按以下顺序判断：

### 1. 这个需求的"主导维度"是什么？

一个需求可能跨多个维度，但通常有一个主导：
- "帮我抓某网站的内容并提取要点" → 主导是 programmable + persistable（需要新 Object 自带方法 + 数据存储）
- "在 web 上看一下系统状态" → 主导是 visible
- "回顾过去 3 天我们讨论了什么" → 主导是 collaborable + 历史 thread 检索

### 2. 该维度有现成 Object 吗？

- **有** → talk_window 转述需求
- **没有** → 创建新 Object（见 `creating-objects.md`）

### 3. 跨维度复杂需求

→ 拆解，并行派多个子 Object（用 do_window 派生子 thread）。

### 4. 不确定 / 大方向决策

→ 自己处理 + 必要时通过 super flow 沉淀到 sediment knowledge。

## 自查清单

每次决策前问自己：

- 用户需求的核心维度是什么？
- 我能直接处理（解释 / 引导 / 元操作）吗？还是要派？
- 派给谁？如果没有合适的 Object，要不要创建一个？
- 这是单次任务还是持续议题？持续议题在当前 World 中通过 thread 复用与跨 session 沉淀解决。
