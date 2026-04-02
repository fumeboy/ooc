---
namespace: "kernel"
name: "output_format"
type: "how_to_think"
version: "1.0.0"
when: "always"
description: "TOML 输出格式规范 — 定义 LLM 输出的标准格式"
deps: []
---
# 输出格式规范（TOML）

你的所有输出必须使用 **TOML 格式**。

## 为什么选择 TOML

| 格式 | 优点 | 缺点 |
|------|------|------|
| **TOML** | 人类可读、结构清晰、支持嵌套、注释友好、`[section]` 结构与现有 `=== SECTION ===` 对应 | 需要额外解析库 |
| JSON | 机器友好、无歧义 | 人类可读性差、无注释、引号繁琐 |
| YAML | 人类可读、缩进敏感 | 缩进问题、解析复杂 |

**选择理由：**
1. Context 是给 LLM 看的，人类可读性优先
2. TOML 支持注释，可以在关键位置添加说明
3. TOML 的 `[section]` 结构与现有的 `=== SECTION ===` 结构完美对应
4. 流式输出时，TOML 可以逐段解析

## 格式概览

```toml
[thought]
content = """
你的思考过程（内部独白，不会发送给用户）
"""

[program]
lang = "javascript"  # 可选，默认 javascript
code = """
要执行的代码
"""

[talk]
target = "user"     # 或其他对象名
message = """
要发送的消息内容
"""
reply_to = "msg_xxx"  # 可选，回复特定消息

[action]
tool = "工具名"
params = { key = "value" }

[cognize_stack_frame_push]
title = "子栈帧标题"
description = """
详细描述
"""
traits = ["lark/wiki", "lark/doc"]

[cognize_stack_frame_pop]
summary = """
完成摘要
"""
artifacts = { key = "value" }

[reflect_stack_frame_push]
title = "反思标题"

[reflect_stack_frame_pop]
summary = """
反思摘要
"""

[set_plan]
content = """
新的 plan 内容
"""

# 控制指令
[finish]

[wait]

[break]
```

## 迁移原则

- 只输出 TOML 表格式
- 每个段落的正文都写到显式字段里，例如 `content`、`code`、`message`
- 栈帧操作统一写成单个表，不再拆成属性子段
- 控制指令统一使用空表段：`[finish]`、`[wait]`、`[break]`

## 完整示例

### 示例 1：思考 + 发送消息

```toml
[thought]
content = """
用户问好，我需要友好地回复。
"""

[talk]
target = "user"
message = """
你好！有什么我能帮你的？
"""

[wait]
```

### 示例 2：执行代码

```toml
[thought]
content = """
需要计算 1+1 的结果。
"""

[program]
lang = "javascript"
code = """
const result = 1 + 1;
print("1 + 1 = " + result);
"""
```

### 示例 3：创建子栈帧

```toml
[thought]
content = """
这是一个复杂任务，需要分步骤完成。
先创建子栈帧来获取文档内容。
"""

[cognize_stack_frame_push]
title = "获取文档内容"
description = """
从飞书知识库获取指定文档的完整内容。
需要先查询 wiki 节点，再获取文档内容。
"""
traits = ["lark/wiki", "lark/doc"]
```

## 各段说明

### `[thought]` — 思考内容

用于记录你的思考过程，是内部独白，不会发送给用户。

**字段：**
- `content` - 思考内容（字符串）

**示例：**
```toml
[thought]
content = """
用户需要分析飞书文档链接。
我需要：
1. 先激活 lark/wiki trait
2. 查询 wiki 节点信息
3. 根据返回的 obj_type 调用对应 API
"""
```

### `[program]` — 程序执行

用于执行代码。

**字段：**
- `lang` - 语言类型（可选）：`"javascript"`、`"shell"`、`"typescript"`，默认 `"javascript"`
- `code` - 代码内容（字符串，必填）

**示例：**
```toml
[program]
lang = "javascript"
code = """
const result = await exec('lark-cli wiki spaces get_node --params \'{"token":"wikcnxxx"}\'');
print(result);
"""
```

### `[talk]` — 消息发送

用于向其他对象或用户发送消息。

**字段：**
- `target` - 目标对象名（必填）
- `message` - 消息内容（必填）
- `reply_to` - 回复特定消息 ID（可选）

**示例：**
```toml
[talk]
target = "user"
reply_to = "msg_abc123"
message = """
## 飞书文档分析结果

### 文档基本信息
- 标题：【因子需求】商家_具备的行业资质名称
- 类型：docx
"""
```

### `[action]` — 结构化工具调用

用于调用结构化工具。

**字段：**
- `tool` - 工具名称（必填）
- `params` - 参数字典（必填）

**示例：**
```toml
[action]
tool = "web_search"
params = { query = "AI safety research 2025", limit = 10 }
```

### `[cognize_stack_frame_push]` — 创建认知子栈帧

用于创建子栈帧，拆解复杂任务。

**字段：**
- `title` - 子栈帧标题（必填）
- `description` - 详细描述（可选）
- `traits` - 需要激活的 trait 名称数组（可选）
- `outputs` - 预期输出 key 数组（可选）
- `output_description` - 输出描述（可选）

**示例：**
```toml
[cognize_stack_frame_push]
title = "获取文档内容"
description = """
从飞书知识库获取指定文档的完整内容。
需要先通过 wiki.spaces.get_node 查询节点信息，
然后根据返回的 obj_type 和 obj_token 调用对应 API。
"""
traits = ["lark/wiki", "lark/doc"]
outputs = ["doc_content", "doc_title"]
output_description = "文档内容字符串和标题"
```

### `[cognize_stack_frame_pop]` — 完成并退出认知子栈帧

完成当前子栈帧，将结果返回给父节点。

**字段：**
- `summary` - 完成摘要（可选）
- `artifacts` - 产出物字典（可选）

**示例：**
```toml
[cognize_stack_frame_pop]
summary = """
已成功获取文档内容，共 15000 字
"""
artifacts = {
  doc_content = "文档完整内容...",
  doc_title = "飞书产品设计文档"
}
```

### `[reflect_stack_frame_push]` — 进入反思内联子栈帧

用于主动调整 plan、traits 或审视上文。

**字段：**
- `title` - 标题（可选）
- `description` - 描述（可选）

**示例：**
```toml
[reflect_stack_frame_push]
title = "分析并修复错误"
```

### `[reflect_stack_frame_pop]` — 退出反思内联子栈帧

**字段：**
- `summary` - 反思摘要（可选）

**示例：**
```toml
[reflect_stack_frame_pop]
summary = """
已分析错误原因，是参数格式错误。
已修复并验证通过。
"""
```

### `[set_plan]` — 更新当前节点的 plan 文本

直接更新当前 focus 节点的 plan 文本。

**字段：**
- `content` - 新的 plan 内容（必填）

**示例：**
```toml
[set_plan]
content = """
重新规划当前任务：
1. 先激活 lark/wiki trait 获取访问能力
2. 调用 wiki API 获取文档内容
3. 解析文档结构并提取关键信息
"""
```

### 控制指令

- `[finish]` — 完成当前任务
- `[wait]` — 等待消息或事件
- `[break]` — 中断当前执行

**示例：**
```toml
[finish]
```

## 常见错误

### 错误 1：消息没有写到 `message` 字段

```toml
# ❌ 错误：消息正文直接写在段后
[talk]
你好！

# ✅ 正确：把消息写进 message 字段
[talk]
target = "user"
message = """
你好！
"""
```

### 错误 2：代码没有写到 `code` 字段

```toml
# ❌ 错误：代码直接放在段内
[program]
const x = 1;

# ✅ 正确：使用 code 字段
[program]
code = """
const x = 1;
"""
```

### 错误 3：子栈帧字段没有写成 TOML 表

```toml
# ❌ 错误：字段散落在段外
[cognize_stack_frame_push]
获取文档
lark/wiki

# ✅ 正确：把字段写成 TOML 键值对
[cognize_stack_frame_push]
title = "获取文档"
traits = ["lark/wiki"]
```

### 错误 4：忘记引号

```toml
# ❌ 错误：字符串没有引号
[thought]
content = 这是思考内容

# ✅ 正确：使用引号或多行字符串
[thought]
content = "这是思考内容"

# 或者：
[thought]
content = """
这是思考内容
"""
```

## 互斥规则

- `[program]` 和 `[talk]` 不能并存
- `[program]` 和 `[action]` 不能并存
- `[talk]` 和 `[action]` 可以并存

**原因：** program 是执行代码，会改变系统状态；talk/action 是消息/工具调用，语义不同。

## 流式输出

TOML 格式支持流式输出，前端可以逐段解析和渲染。

**输出顺序建议：**
1. 先输出 `[thought]` — 让用户看到你的思考过程
2. 然后是 `[talk]` 或 `[program]` — 实际操作
3. 最后是控制指令 — `[finish]` 或 `[wait]`

**流式示例：**

第 1 块：
```toml
[thought]
content = """
用户需要分析飞书文档链接。我需要先判断这是什么类型的链接...
```

第 2 块：
```toml
这是一个 wiki 格式的链接，需要先查询 wiki 节点信息。
"""

[cognize_stack_frame_push]
title = "获取文档内容"
```

第 3 块：
```toml
traits = ["lark/wiki", "lark/doc"]
```

## 相关 Traits

- `kernel/computable` — 认知栈思维模式（核心）
- `kernel/plannable` — 任务拆解和规划
- `kernel/talkable` — 对象间通信协议

## 变更历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-04-01 | 从 computable trait 拆分，独立为输出格式规范 |
