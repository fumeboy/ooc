import { engineering_v20260506_1 } from "@meta/engineering/index.doc";

/**
 * 集成测试沉淀：策略 + 清单 + 真 LLM 触发过的 bug。
 *
 * 单元测试覆盖内部算法、错误路径、组件契约；集成测试在此之上做"真 LLM 端到端能否跑通"的硬验证。
 * 二者目的互补：单测保算法正确性，集成测保系统作为整体在真实 LLM 行为下不崩。
 */
export const integration_tests_v20260511_1 = {
  get parent() { return engineering_v20260506_1; },
  index: `
集成测试沉淀

## 1. 测试策略

| 维度 | 选择 | 理由 |
|---|---|---|
| LLM 来源 | 真实 provider（默认 Claude 代理） | 发现真实模型行为偏差（幻觉、工具误用、prompt 理解差异），Mock 模型测不到 |
| 隔离 | 每测一个 \`mkdtemp\` baseDir，afterEach 清理 | 测试之间无状态污染；可重复运行 |
| 门控 | \`describe.skipIf(!hasLlmEnv)\` | 无 OOC_API_KEY 等 env 时自动跳过；CI 默认不跑（不烧钱），开发者本地按需跑 |
| maxTicks | 每测显式设置（单 thread 8-14；含子线程 16-20；多任务 ≥25） | 防止 LLM 走偏后无限循环；超过即标 fail，倒逼调优 prompt |
| 超时 | 每测函数级 \`{ timeout: 60_000 ~ 240_000 }\` | bun:test 默认 5s 不够；按场景规模设上限 |
| 断言 | 仅断言"最终持久化状态"（thread.status / events 计数 / activeForms 残留 / 文件落盘 / endSummary 包含模式）；**不**断言中间步骤序列 | LLM 输出有随机性，固定步骤必然 flaky；最终状态稳定 |
| 数字断言 | 用区间 / 包含 而非确定值 | LLM 偶尔把数字写错一位的容错 |

## 2. 通用 fixture（tests/integration/_fixture.ts）

\`\`\`ts
hasLlmEnv: boolean              // 三个 OOC_* env 都设置时为 true
llm(): LlmClient                // 懒构造，避免 skip 路径上读坏 env 抛错
setupTempFlow(): { tempRoot, cleanup }
makeRootThread(tempRoot, prompt): ThreadContext   // 含初始 inject 事件 + persistence ref
countEventsWithPrefix(thread, prefix): number     // 数 inject 文案前缀
\`\`\`

每个测试都用这套 fixture，避免每个文件重写 setup/teardown 的 boilerplate。

## 3. 当前测试清单

10 + 1 个集成测试，每个一个文件，按"覆盖什么能力"分类。

### 3.1 单 thread 基础

| # | 文件 | 覆盖能力 |
|---|---|---|
| 1 | shell-exec-basic | program.shell 单次调用 / open→refine→submit→executed→end 全生命周期 / endSummary 含数字 |
| 2 | plan-then-execute | plan command 执行 / 多 form 串行（plan 后接 program）/ thread.plan 持久化 |
| 3 | multi-shell-chain | 多 tick 多 program executed 累积 / 上一次 form 的 result 回喂下一轮 context |
| 6 | wait-state-transition | wait tool / status=waiting + waitingType=explicit_wait（不验证唤醒，inbox 唤醒未实现） |

### 3.2 form 生命周期

| # | 文件 | 覆盖能力 |
|---|---|---|
| 4 | abandon-via-close | close tool 真实触发 / 已 open 未 executed 的 form 被移除而无 executed 事件 |
| 7 | executed-form-cleanup | executed form 显式 close 释放 / 最终 activeForms 不残留该 form |

### 3.3 多任务编排

| # | 文件 | 覆盖能力 |
|---|---|---|
| 8 | todo-driven-multistep | todo 全生命周期 × 2 件事 / 多 form 共存渲染 / 每完成一件 close 对应 todo |
| 11 | multi-round-multitask | ≥15 轮 long-horizon 任务 / 5 件事顺序处理 / data.json 跨轮持久化 / shell + ts + function 三模式混用 |

### 3.4 多线程

| # | 文件 | 覆盖能力 |
|---|---|---|
| 5 | do-fork-and-collect | do.fork(wait=true) / await_children 唤醒 / 子线程独立 thread.json / 父线程恢复 |
| 9 | do-continue-after-done | supervisor 用 do.continue+wait 给已完成子线程追加任务 / 子线程 done→running |

### 3.5 元编程

| # | 文件 | 覆盖能力 |
|---|---|---|
| 10 | meta-programming | Agent 写 server/index.ts → 注册方法 → 立即 program.function 调用 → 看到 returnValue |

## 4. 由这些集成测试触发并修复的真实 bug

集成测试不是装饰品，它们抓出过用单元测试根本不可能发现的真实问题。下面记录的是在 2026-05-10 / 2026-05-11 期间真 LLM 跑出来的具体 bug 与修复，写在文档里以便未来人不再踩同样的坑。

### Bug 1：Claude 代理只返回 SSE，generateWithClaude 抛 "Failed to parse JSON"
- **症状**：单元测试全绿，集成测试 wait-state-transition 跑出 thread.status="failed"，事件里写着 "Failed to parse JSON"
- **根因**：claudeide 类代理无视请求体里的 \`stream:false\`，永远返回 \`text/event-stream\`，但 \`generateWithClaude\` 用 \`response.json()\` 直接解析，对 SSE body 自然失败
- **修复**：generate 路径检测 \`Content-Type: text/event-stream\`，自动 fallback 到共享 \`parseClaudeSSE\` 聚合器（commit \`e1e06bf\`）
- **顺带修复**：streamWithClaude 原本只在 \`content_block_start\` 时取 \`input\`，对 Anthropic 标准的 \`input_json_delta\` 增量协议无效，tool 参数一直为空。补上按 \`index\` 缓冲 \`partial_json\` + \`content_block_stop\` 时 JSON.parse

### Bug 2：tool_use 文本回放导致 LLM 输出"假 tool call"
- **症状**：plan-then-execute 第二轮起，LLM 不再调真 tool，而是输出 "[tool_use:submit]\\n{...}" 这种纯文本
- **根因**：context.ts 把过往 tool_use 事件渲染成 \`assistant: "[tool_use:NAME]\\n{...}"\` 文本喂回给 LLM，LLM 看到自己上一轮"是这么说话的"于是模仿，而 active_forms 已经在 system context 里完整暴露了当前形态，根本不需要在 transcript 里复述
- **修复**：tool_use 事件不进 transcript（commit \`021a66f\`）。原则：对 LLM 不重要的事件不要塞进 conversation history，用 system context 表达当前状态

### Bug 3：父线程 await_children 醒来后看不到子结果，重新 wait 卡死
- **症状**：do-fork-and-collect 测试中，父 fork(wait=true) 后子线程跑完，父醒来 (status: waiting → running)，但下一轮父 LLM 看到自己的 do form 是 status=executed 但 result=undefined，于是推测"还没拿到结果"再次 wait → 死循环
- **根因**：scheduler 把父翻回 running 时只改状态没注入任何关于子线程的信息；父线程在 buildContext 里也看不到 childThreads（render 只渲当前 thread）
- **修复**：scheduler 在唤醒父线程时主动 inject \`[await_children] 等待中的子线程已完成: ...\` 事件（commit \`cccd3fb\`），父醒来就知道哪个子线程完成、它的 endSummary 是什么

### Bug 4：fork 创建的子线程出生时 transcript 全空，Anthropic 拒绝
- **症状**：子线程第一次 think 直接 status=failed，事件里只有 "Claude 响应不是合法 JSON 对象: null"
- **根因**：do.fork 创建 child 时 \`events: []\`，导致 buildContext 只产出 system message，无 user 消息。Anthropic API 要求 messages 必须包含至少一个非 system 角色，代理对此返回 200+空 body
- **修复**：do.fork 创建 child 时同步把初始消息以 \`[初始消息] xxx\` inject 形式入 child events（commit \`10b94eb\`）

### Bug 5：plan command 对 LLM 自然 args 形态过于严格
- **症状**：plan-then-execute 测试 thread.plan 字段为空字符串
- **根因**：plan command 只认 \`{plan: "..."}\` 字符串，但 LLM 自然用 \`{goal, steps: [...]}\` 这种结构化形式
- **修复**：plan.ts 兼容多种形态——\`args.plan\` 是字符串就用，否则 JSON.stringify 整个 args（commit \`8990725\`）

## 5. 写新集成测试的指南

每个新测试都应回答以下问题：

1. **覆盖什么能力？** —— 写在 describe 描述里。如果说不清，可能是太散了，应该拆。
2. **prompt 够不够明确？** —— 真 LLM 测试，prompt 必须明确指名 command / 提示 result 已在 active_forms 不需 wait / 给出对象目录绝对路径等。模糊的 prompt 一定 flake。
3. **断言够不够稳？** —— 不要断言 LLM 中间步骤；只断言最终持久化状态、文件存在性、关键事件出现次数。数字用包含模式（\`endSummary.contains("15")\`）而非全等。
4. **maxTicks 够不够？** —— 单 thread 8-14；多 thread 16-20；多任务 long-horizon 25+。超出说明 prompt 让 LLM 走偏，优先改 prompt 而不是抬高 maxTicks。
5. **超时够不够？** —— 每个 LLM 调用 5-15s，按预期 tick 数 × 12s 大致估算。

## 6. 跑法

\`\`\`bash
# 跑单个集成测试
bun --env-file=.env test tests/integration/<name>.integration.test.ts

# 跑全部
bun --env-file=.env test tests/integration

# 不带 env：全部 skip（CI 默认行为）
bun test tests/integration
\`\`\`
`,
};
