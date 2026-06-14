---
title: 9 个能力维度速查
description: thinkable/executable/collaborable/observable/persistable/reflectable/programmable/readable/visible
activates_on:
  "object::root": "show_content"
---

# 9 个能力维度

术语解释（object method / window method / ui_method / super flow / sediment 等）见 `world-vocabulary.md`。

维度分三组：**运行时底座**（5）+ **自我塑造**（2）+ **外观**（2）。

| 维度 | 组 | 一句话职责 | 主要载体 |
|---|---|---|---|
| **thinkable** | 底座 | 思考：LLM 调用、context 构造、thread 调度、knowledge 渐进激活 | 系统内核（无 stone 文件） |
| **executable** | 底座 | 行动：3 个稳定 tool 原语（exec/close/wait，compress 经 exec 调的 window method）+ object method（操作对象数据，`registerExecutable` 注册）+ ContextWindow 操作 | 系统内核 + 对象 `executable/index.ts` |
| **collaborable** | 底座 | 协作：talk_window / do_window 跨 Object 通道（消息 + 持续会话窗口） | 系统内核 |
| **observable** | 底座 | 可观测：LLM 调用 trace、pause / resume、debug 文件落盘 | 系统内核 + `debug/` 目录 |
| **persistable** | 底座 | 持久化：Stone / Pool / Flow 三子树（+ Builtin 为 class 源） | 整个 World 文件系统 |
| **reflectable** | 自我塑造 | 自我演化：受保护的 super flow 改写自身身份文件与 sediment knowledge、下轮生效 | super flow 协议 |
| **programmable** | 自我塑造 | 自写方法库：对象自己的 `executable/index.ts`（写即热更生效） | Object `executable/index.ts` |
| **readable** | 外观 | LLM 侧展示：Object 怎样被读——`readable.md` 名片 + window method（`registerReadable`，只控窗口展示）+ compressView | 对象 `readable.ts` / `readable.md` |
| **visible** | 外观 | 人类侧 UI：对象自己的 UI 页面 + 关联 ui_method（HTTP 通道） | Object `visible/index.tsx` + ui_method |

## supervisor 分发原则

用户提需求时，我按以下顺序判断：

### 1. 这个需求的"主导维度"是什么？

一个需求可能跨多个维度，但通常有一个主导：
- "帮我抓某网站的内容并提取要点" → 主导是 programmable + persistable（需要新 Object 自带方法 + 数据存储）
- "在 web 上看一下系统状态" → 主导是 visible
- "回顾过去 3 天我们讨论了什么" → 主导是 collaborable + 历史 thread 检索

### 2. 该维度有现成 Object 吗？

先判断这个 Object 是不是我**同 stone 的 peer**（同级或我的 children，在当前 thread 启动时就已被注入为 `contextWindows`）：
- **是** → 直接在该 peer 的 window 上调它的 object method（method 集就是该对象在 `executable/index.ts` 中声明的方法），不需要 talk。peer 的 window id 等于 objectId（例如 `sentry/factor`）。
- **不是 / 不确定 / 需要对方独立思考或跨 session 异步处理** → 用 `talk_window(target=<peer object>)` 转述需求
- **没有** → 创建新 Object（见 `creating-objects.md`）

> ⚠️ **协议纪律**：如果在某 window 上调 object method 返回 `window not found`，不要立刻退化为裸 `program` 或 raw RPC——先确认该对象是不是同 stone peer、我当前 thread 的 children 列表是否包含它、以及该 objectId 的方法注册是否成功。只有在确实不满足"同 stone peer"前置条件时才走 talk。

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
