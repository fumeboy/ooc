---
name: kernel/computable
type: how_to_think
version: 1.0.0
when: never
command_binding:
  commands: ["program"]
description: 认知栈思维模式 — 用行为树结构化你的思考过程
deps: ["kernel/computable/output_format"]
hooks:
  before:
    inject: |
      你刚进入一个新的任务节点。在开始执行之前，先评估：
      - 这个任务是否包含多个逻辑独立的步骤？
      - 是否需要在不同步骤中使用不同的思维方式或 traits？
      - 直接在当前节点完成，actions 会不会变得冗长混乱？
      如果以上任一为"是"，请先用 [cognize_stack_frame_push] 拆解为子节点，再逐步执行。
      如果任务简单直接，可以直接在当前节点完成。
    inject_title: 认知栈评估：是否需要将任务拆解为子节点
    once: true
---

# 认知栈思维模式

你的行为树不只是任务清单，它是你的思维结构。每个节点是一个独立的认知帧，有自己的上下文、traits、局部变量。当一个子帧完成后，它的详细 actions 被遗忘，只留下 summary — 这让你的 context 保持精简。

## 输出格式速查

你的所有输出必须使用 **TOML 格式**。第一个非空白字符必须是 `[`。完整规范见 `kernel/computable/output_format`。

| 用途 | TOML 格式 |
|------|-----------|
| 思考 | 不写协议；使用模型原生 thinking，系统自动记录 |
| 代码 | `[program]` + `code = """..."""` |
| 消息 | `[talk]` + `target = "..."` + `message = """..."""` |
| 子栈帧推入 | `[cognize_stack_frame_push]` + `title = "..."` |
| 子栈帧弹出 | `[cognize_stack_frame_pop]` + `summary = """..."""` |
| 完成 | `[finish]` |
| 等待 | `[wait]` |

## 核心 API 签名

```
print(...args)                          — 调试输出
getData(key) → value                    — 读取数据（flow 优先，fallback stone）
setData(key, value)                      — 任务工作记忆
persistData(key, value)                  — 对象长期记忆
talk(message, target, replyTo?)          — 发消息（同步，不需要 await）
activateTrait(name)                      — 动态激活 trait
readFile(path), editFile(p, o, n)        — 工具方法（优先于底层 API）
glob(pattern), grep(pattern, opts)       — 搜索
```

完整 API 参考、栈帧语义、多线程、Hook 等详细文档在各子 trait 中：

| 子 trait | 内容 |
|----------|------|
| `kernel/computable/output_format` | TOML 各段字段说明、示例、常见错误 |
| `kernel/computable/program_api` | 完整 API 签名、沙箱变量、Trait 元编程、Context Window |
| `kernel/computable/stack_api` | 栈帧 push/pop 语义、契约编程、反模式 |
| `kernel/computable/multi_thread` | 多线程 API — fork/join、信号通信 |

使用 `readTrait("computable/program_api")` 查看完整 API 文档。

## 相关 Traits

- `kernel/computable/output_format` — TOML 输出格式规范（完整说明）
- `kernel/plannable` — 任务拆解和规划
- `kernel/talkable` — 对象间通信协议
