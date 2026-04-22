---
namespace: kernel
name: computable/testable
type: how_to_think
version: 1.0.0
when: never
description: RED-GREEN-REFACTOR 循环，测试先于代码，失败先于通过
deps:
  - verifiable
hooks:
  before:
    inject: 提醒：如果你要写代码，先写测试。先看到测试失败。
    inject_title: 测试驱动：写代码前先写测试
---
# 测试驱动能力

写代码之前先写测试。看到测试失败之后再写实现。

## 铁律

**没有失败的测试，不写任何实现代码。**

测试通过后才能重构。重构不改变行为。

## RED-GREEN-REFACTOR

### RED: 写失败测试

1. 测试描述期望行为，不是实现细节
2. 运行测试，确认失败
3. 失败信息必须指向正确的原因（不是语法错误，而是"功能不存在"）

### GREEN: 最小实现

1. 只写让测试通过的代码，不多写
2. 不要"顺便"加功能
3. 运行测试，确认通过

### REFACTOR: 清理

1. 测试通过后才重构
2. 重构不改变行为（测试仍然通过）
3. 每次重构后运行测试

## Red Flags

- "先写代码再补测试" → 停下来，先写测试
- "这个太简单不需要测试" → 简单函数组合出复杂 bug
- "测试立刻通过了" → 检查测试是否真的在测你想测的
- "重构一下顺便加个功能" → 重构不加功能，加功能先写测试

## 常见的合理化借口

| 借口 | 现实 |
|------|------|
| "先写代码再补测试" | 补的测试只验证你写了什么，不验证该写什么 |
| "这个函数太简单不需要测试" | 简单函数组合出复杂 bug |
| "测试会拖慢速度" | 没测试的代码拖慢的是调试速度 |
| "测试立刻通过了" | 从未失败的测试证明不了任何事 |

## 可用方法

### run_tests({ filter?, coverage?, timeoutMs? })

一次性运行 `bun test`，返回：

```
{ pass, fail, skip, failures: [{ name, file?, line?, message?, raw }], exitCode, raw, durationMs, coveragePct? }
```

### watch_tests({ filter? })

启动 `bun test --watch` 进程。返回 `{ watchId, startedAt }`。
失败时会通过内部 subscribeFailures 广播（LLM 看得到失败是通过后续的 context 注入而非 return 值）。

### stop_watch({ watchId })

停止 watch。

### list_watches({})

列出活跃 watch id。

### test_coverage({ filter? })

跑一次 `--coverage`，返回 `{ pass, fail, coveragePct, summary }`，其中 summary 是覆盖率表格的前 20 行文本。
