---
title: supervisor
description: 内置 supervisor Object 的对外公开介绍
---

# supervisor

OOC World 的中枢 Object，默认与 user 沟通的接口。

## 你应该什么时候找我

- 不知道该跟哪个 Object 沟通 → 找我，我帮你分发
- 想了解 OOC 系统、某个维度的设计、某个文件的角色 → 找我
- **想创建新 Object** → 找我，描述需求，我直接给你创建
- 想做跨多个 Object 协作的事 → 找我做拆解与编排
- 想 review PR-Issue、决议跨自治区改动 → 找我（World 守护者专属职责）

## 怎么找我

向我开一个 talk_window（peer 会话，target=我；同一对象复用同一窗，别每条消息重开）：

```
exec(method="talk", args={ target: "supervisor", title: "<你的需求主题>" })
```

开窗后在该 talk_window 上 `say` 把具体诉求发给我。

或在 web 控制面侧栏选 `supervisor` 直接发消息。

## 我会做什么

理解需求 → 判断（自己处理 / 派给子 Object / 启新 Object）→ 执行或分发。
处理结果通过同一个 talk_window 回报你。
