---
title: root
extends: null
description: |
  OOC-3 根原型（builtin prototype root of all OOC Objects）。
  任何 Object 默认 extends: root（除非 self.md 显式覆盖）。
  提供 8 个 builtin prototype（program/search/file/knowledge/command_exec/skill_index/custom/talk-like wrappers）的 fallback 方法库。
---

# root prototype

我是 OOC-3 系统中所有 OOC Object 的根原型。

## 我提供什么

我的 server/index.ts 暴露了一组 public method，作为所有 OOC Object 的"出厂方法库"：

- **协作类**: `talk` （peer 之间消息直投，flow 层 append + 唤起 target LLM）
- **派生类**: `do` / `do_close` （skeleton：在 flow 层写 thread.json 记录意图，但不自动派发 worker 执行——P6+ sub-thread worker loop 落地前，sub-thread 需调用方手动调度）
- **任务类**: `todo_add` / `todo_check` / `todo_uncheck` / `todo_remove` / `todo_list` （flow 层 todos.json mutate）
- **引导类**: `plan_set` / `plan_clear` （flow 层 plan.md 当前 thread 引导）
- **搜索类**: `grep` / `glob` （创建 ephemeral search Object 到 flows/<session>/objects/）
- **打开类**: `open_file` / `open_knowledge` （创建 ephemeral file/knowledge Object）
- **记忆类**: `memory_record` （写入 pool/knowledge/memory/<slug>.md 跨 session 沉淀知识）
- **元编程**: `metaprog` / `write_file` （读/改自己的 stone；metaprog 返回文件内容+路径供 write_file 修改）
- **结束**: `end` （主 thread 主动 close；务必在 talk() 回复用户后调用，否则 thinkloop 不会停止）

子原型 Object 通过 `extends: root` 继承这些方法；任意一个可被 override。

## 我的 defaultContext

每轮 LLM 调用前由 root 原型的 `defaultContext()` 实时拼装：

1. active plan（如 plan.md 非空，顶置注入）
2. unfinished todos（todos.json 中 checked=false 项）
3. active threads（flows/<session>/objects/<self>/threads/ 中未 close 的子线程）
4. recent talks（每 peer 最近 N 条消息摘要）
5. relations（同级 + children/ Object 列表）
6. pool_memory（pools/objects/<self>/knowledge/memory/*.md 跨 session 沉淀知识；总量 ≤8000 字符）

子原型可在自己 server/ 内 override `defaultContext()` 增/减切片。

## 设计参考

详见 spec V2 §2.4 + §3 + §5.2 + meta/object.doc.ts:patches.b_class_collapse。
