---
namespace: kernel
name: talkable/cross_object
type: how_to_interact
when: never
description: 跨对象 talk fork 模式 — 跨对象函数调用 + 新会话派生
deps: ["kernel:talkable"]
activates_on:
  paths: ["talk.fork", "talk.wait.fork"]
---

# 跨对象函数调用（通过对话实现）

当你需要调用另一个对象的 public function 时，通过 talk 对话协议完成。

## 协议流程

```
A → B: "请调用你的 search 函数，参数：query='AI safety', limit=10"
B → A: "执行结果：[搜索结果内容]"
```

## 调用方

通过 `open(command=talk)` → `submit(target, message, wait=true)` 发送同步请求，等待对方回复。
`wait=true` 让当前线程进入 waiting 状态，直到收到对方回复。

如果对方需要补充参数，会通过 talk 回复你，你的线程会收到 inbox 消息。

## 被调用方

收到函数调用请求时：
1. 识别请求中提到的 public function
2. 参数完整则直接执行，缺少则 talk 回去要求补充
3. 执行完成后 talk 回结果

## 简化场景

调用方在第一条消息中提供完整参数时，被调用方可以直接执行并返回，无需多轮对话。

## 注意事项

- talk(wait=true) 会让当前线程进入 waiting 状态，直到收到回复
- 如果函数不存在或参数错误，被调用方应明确告知
- 结果较大时，可以写入 files 文件并告知 `ooc://` 链接路径
