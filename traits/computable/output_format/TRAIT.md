---
name: kernel/computable/output_format
type: how_to_think
when: never
description: 线程树 TOML 输出格式规范 — 可用指令、字段说明、互斥规则、示例
deps: ["kernel/computable"]
---

# TOML 输出格式规范

## 格式概览

所有输出必须使用 TOML 格式。第一个非空白字符必须是 `[`。

| 段落 | 用途 |
|------|------|
| `[thought]` | 记录思考过程 |
| `[program]` | 执行代码 |
| `[talk]` | 向其他对象发送消息 |
| `[return]` | 完成当前线程，返回结果 |
| `[create_sub_thread]` | 创建子线程处理子任务 |
| `[set_plan]` | 更新当前计划 |
| `[await]` | 等待某个子线程完成 |
| `[await_all]` | 等待多个子线程完成 |

## 各段字段说明

### `[thought]`
- `content` — 思考内容（必填，多行字符串）

### `[program]`
- `code` — 代码内容（必填，多行字符串）
- `lang` — 语言（可选）：`"javascript"` | `"shell"`，默认 `"javascript"`

### `[talk]`
- `target` — 目标对象名（必填）
- `message` — 消息内容（必填）

### `[return]`
- `summary` — 完成摘要（必填）
- `artifacts` — 产出物字典（可选）

### `[create_sub_thread]`
- `title` — 子线程标题（必填）
- `description` — 子线程描述（可选）
- `traits` — trait 名称数组（可选）

### `[set_plan]`
- `text` — 新计划内容（必填）

### `[await]`
- `thread_id` — 等待的子线程 ID（必填）

### `[await_all]`
- `thread_ids` — 等待的子线程 ID 数组（必填）

## 互斥规则

1. 每轮输出只能包含一个主指令（`[return]`、`[create_sub_thread]`、`[program]`、`[talk]` 选其一）
2. `[thought]` 可以和任何主指令并存
3. `[set_plan]` 可以和任何主指令并存
4. 任务完成后必须用 `[return]` 结束，不要无限循环
5. 简单问答直接用 `[thought]` + `[return]`，不需要 `[talk]`

## 常见错误

1. 消息正文必须写在 `message = """..."""` 字段中，不能直接写在段后
2. 代码必须写在 `code = """..."""` 字段中
3. 字符串值必须使用引号 `"..."` 或多行字符串 `"""..."""`
4. 不要输出 `[finish]`、`[wait]`、`[break]` 等旧指令

## 示例

### 简单回答
```toml
[thought]
content = """
用户问了一个简单的问题，我可以直接回答。
"""

[return]
summary = "这里是对用户问题的回答内容"
```

### 执行代码
```toml
[thought]
content = "需要读取文件来获取信息"

[program]
code = """
const data = readFile("docs/gene.md");
return data;
"""
```

### 向其他对象发消息
```toml
[talk]
target = "kernel"
message = "请帮我检查一下 ThinkLoop 的实现"
```

### 创建子线程
```toml
[thought]
content = "这个任务需要分解为子任务"

[create_sub_thread]
title = "调研 G1 基因的历史演变"
description = "查阅 gene.md 和 discussions 目录，整理 G1 基因的演变过程"
```

## 流式输出

输出顺序建议：
1. 模型先在原生 thinking 通道产生思考
2. assistant 输出 `[thought]`（可选）+ 主指令
3. 任务完成时输出 `[return]`
