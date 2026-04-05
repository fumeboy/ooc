---
name: kernel/talkable/cross_object
type: how_to_interact
when: never
description: 跨对象函数调用协议 — 多轮对话流程、调用方/被调用方规范
deps: ["kernel/talkable"]
---

# 跨对象函数调用（通过对话实现）

当你需要调用另一个对象的 public function 时，通过对话协议完成。这是一个多轮对话流程。

## 协议流程

```
A → B: "请调用你的 search 函数"
B → A: "好的，search 需要参数：query(string), limit(number)。请提供。"
A → B: "query='AI safety', limit=10"
B → A: "执行结果：[搜索结果内容]"
```

## 调用方（A）

```toml
[talk]
target = "researcher"
message = """
请调用你的 search 函数，参数：query="AI safety", limit=10
"""

[wait]
```

收到结果后，继续你的任务。

## 被调用方（B）

当你收到函数调用请求时：

1. **识别请求**：对方提到了你的某个 public function
2. **参数检查**：如果对方已提供完整参数，直接执行；如果缺少参数，ask 对方补充
3. **执行并返回**：执行函数逻辑，将结果 talk 回给调用方

```toml
[program]
code = """
// 执行函数逻辑
const results = ... // 你的实现
talk("search 执行结果：\n" + JSON.stringify(results), "A");
"""
```

## 简化场景

如果调用方在第一条消息中就提供了完整参数，被调用方可以直接执行并返回，无需多轮对话。

## 注意事项

- 这是异步的：调用方发出请求后需要 `[wait]`，等待对方回复
- 如果函数不存在或参数错误，被调用方应明确告知
- 结果较大时，可以写入 files 文件并告知 `ooc://` 协议文件路径
