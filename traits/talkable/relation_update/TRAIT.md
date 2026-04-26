---
namespace: kernel
name: talkable/relation_update
type: how_to_interact
when: never
description: 关系更新请求 — talk.continue.relation_update（Phase 6）
deps: ["kernel:talkable"]
activates_on:
  paths: ["talk.continue.relation_update"]
---

# 关系更新请求（relation_update）

本指令用于在**对方的 `relations/{我}.md`** 里提议记录某段关系说明（协作规矩、
历史要点、注意事项等）。engine 不会自动写入任何文件——接收方自主决定
接受 / 部分接受 / 拒绝。

## 发起方（你发送时）

使用方式（推荐走 talk 的渐进填表，借助 partial submit 观察各层 bias）：

```
open(type=command, command=talk, description="向 sophia 提议登记协作规矩")
submit(form_id="<...>", partial=true, target="sophia", context="continue")
# → engine 派生路径到 talk.continue；talk/continue 相关 bias 已 open
submit(form_id="<...>", partial=true, type="relation_update")
# → engine 派生到 talk.continue.relation_update；本 TRAIT.md 被 open
submit(form_id="<...>", partial=false, threadId="th_sophia_g3",
       msg="请在 relations/kernel.md 里登记：所有 G/E 编号变更必须先 talk 我确认")
```

或一次性填齐：

```
open(type=command, command=talk, description="请求登记协作规矩")
submit(form_id="<...>", target="sophia", context="continue",
       threadId="th_sophia_g3", type="relation_update",
       msg="请在你的 relations/kernel.md 里登记：\n- 所有 G/E 编号变更必须先 talk 我\n- PR 标题必须含 G 编号")
```

### 消息正文规范

- **主语明确**：说清"请在 relations/{我}.md 里登记..."（避免"记下这个"的模糊指代）
- **列点式**：每条规则 / 规矩 / 注意事项一行 bullet，便于对方精确取舍
- **可取舍**：接受方可能只采纳其中一部分，你要容忍
- **不包揽格式**：对方决定用哪种 frontmatter / 结构，你只给内容

### 反例

- ❌ `talk(target=sophia, msg="我们约定 X", context=fork)` —— fork 是新话题，不是关系更新
- ❌ `talk(target=sophia, msg="别忘了我那件事", type=relation_update)` —— 指代不明
- ❌ 大段长文（超过 200 字）—— 应该先 fork 讨论达成共识，再 relation_update 登记简要结论

## 接收方（你收到时）

你会在 `<inbox>` 里看到一条 `<relation_update_request>` 徽章消息：

```xml
<relation_update_request id="msg_xxx" from="kernel" ts="...">
请在 relations/kernel.md 里登记：所有 G/E 编号变更必须先 talk 我确认
</relation_update_request>
```

### 必须做一件事（不可忽略）

- **接受**：读 `relations/{对方}.md`（若不存在则创建），把请求内容以合适的结构
  （frontmatter summary + bullets）写入。用 `open(type=command, command=call_function,
  trait="kernel:computable/file_ops", function_name="writeFile")` 或 `editFile`。
- **部分接受**：只采纳其中一部分；在回信里说明哪几条被采纳、哪几条被拒绝
- **拒绝**：在回信里说明原因（例如"与现有约定冲突"、"暂不需要"）
- **推迟**：短暂不决定可以，但必须在本轮或下一轮给出明确态度，不要沉默

### 发起方如何知道你的决定

- 接受 / 部分接受后，**talk 回复发起方**（`talk(target=发起方, msg="已登记以下三条：..."）
- 拒绝 → 同样 talk 回复说明原因
- 你的回复通过原 talk 的 reply 通道自然到达发起方的 inbox

### 为什么 engine 不自动写

- 关系文件归属本对象私有（spec 明确的所有权模型）
- 任何对关系的刻写都应当是本对象的"明智决定"——让 LLM 的判断和负责主体对齐
- 避免"A 塞给 B 一段文字 B 就自动记了"的信任漏洞

## 与 fork 区别

| 操作 | 含义 | 后果 |
|------|------|------|
| `talk(target=X, context=fork)` | 新话题 | X 开一条新根线程处理你 |
| `talk(target=X, context=fork, threadId=Y)` | 在 X 的 Y 下派生子任务 | X 在 Y 下开子线程 |
| `talk(target=X, context=continue, threadId=Y)` | 向 X 的 Y 追加消息 | X 在 Y 上续写 |
| `talk(target=X, context=continue, threadId=Y, type=relation_update)` | **提议 X 登记关系** | X 收到徽章请求，自主决定 |
