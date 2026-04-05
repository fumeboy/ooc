---
namespace: kernel
name: computable/output_format
type: how_to_think
when: never
description: 完整 TOML 输出格式规范 — 各段字段说明、示例、常见错误、流式输出
deps: ["kernel/computable"]
---

# TOML 输出格式完整规范

## 格式概览

所有输出必须使用 TOML 格式。第一个非空白字符必须是 `[`。

| 段落 | 用途 |
|------|------|
| `[program]` | 执行代码 |
| `[talk]` | 发送消息 |
| `[action]` | 结构化工具调用 |
| `[cognize_stack_frame_push]` | 创建子栈帧 |
| `[cognize_stack_frame_pop]` | 完成子栈帧 |
| `[reflect_stack_frame_push]` | 进入反思子栈帧 |
| `[reflect_stack_frame_pop]` | 退出反思子栈帧 |
| `[set_plan]` | 更新 plan 文本 |
| `[finish]` | 完成任务 |
| `[wait]` | 等待 |
| `[break]` | 中断 |

## 各段字段说明

### `[program]`
- `lang` — 语言（可选）：`"javascript"` | `"shell"` | `"typescript"`，默认 `"javascript"`
- `code` — 代码内容（必填，多行字符串）

### `[talk]`
- `target` — 目标对象名（必填）
- `message` — 消息内容（必填）
- `reply_to` — 回复消息 ID（可选）

### `[action]`
- `tool` — 工具名称（必填）
- `params` — 参数字典（必填）

### `[cognize_stack_frame_push]`
- `title` — 标题（必填）
- `description` — 描述（可选）
- `traits` — trait 名称数组（可选）
- `outputs` — 预期输出 key 数组（可选）
- `output_description` — 输出描述（可选）

### `[cognize_stack_frame_pop]`
- `summary` — 完成摘要（可选）
- `artifacts` — 产出物字典（可选）

### `[reflect_stack_frame_push]`
- `title` — 标题（可选）

### `[reflect_stack_frame_pop]`
- `summary` — 反思摘要（可选）

### `[set_plan]`
- `content` — 新 plan 内容（必填）

## 互斥规则

- `[program]` 和 `[talk]` 不能并存
- `[program]` 和 `[action]` 不能并存
- `[talk]` 和 `[action]` 可以并存

## 常见错误

1. 消息正文必须写在 `message = """..."""` 字段中，不能直接写在段后
2. 代码必须写在 `code = """..."""` 字段中
3. 栈帧字段必须写成 TOML 键值对，不能散落在段外
4. 字符串值必须使用引号 `"...""` 或多行字符串 `"""..."""`
5. 不要在 assistant 输出中编写 `[thought]`，思考由系统自动采集

## 流式输出

输出顺序建议：
1. 模型先在原生 thinking 通道产生思考
2. assistant 输出 `[talk]`、`[program]` 等协议
3. 最后输出 `[finish]` 或 `[wait]`
