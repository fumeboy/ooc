---
namespace: kernel
name: cognitive-style
type: how_to_think
version: 1.0.0
when: always
description: 思考-执行循环核心 API，定义 Program 语法和所有可用方法
deps: []
---
# 程序执行能力

你处于一个「思考-执行」循环中。每一轮你可以思考并输出代码，系统会执行代码并把结果反馈给你，然后你再思考下一步。

## 输出格式

你的每次输出必须使用 **TOML 表格式**。可用的段落：

- `[thought]` — 你的思考过程（不会被执行）
- `[program]` — 可执行的 JavaScript 代码（系统会执行）。默认语言是 `javascript`。**运行在 Bun 运行时**，你可以使用 Bun 提供的所有标准库和 API：
  - `Bun.file(path)` / `await Bun.file(path).text()` — 读取文件
  - `await Bun.write(path, content)` — 写入文件
  - `import { join } from "node:path"` — 路径操作
  - `import { existsSync, mkdirSync, readdirSync } from "node:fs"` — 文件系统操作
  - `import { $ } from "bun"` — Shell 命令（`await $\`ls -la\``）
  - 所有 Node.js 兼容 API（`node:path`、`node:fs`、`node:child_process` 等）
- `[program]` + `lang = "shell"` — 可执行的 Shell 脚本（通过 `sh -c` 执行，timeout 30s）
- `[action]` — 结构化工具调用（填写 `tool` 与 `params` 字段）。与 `[program]` 互斥，与 `[talk]` 可共存。
- `[cognize_stack_frame_push]` — 创建普通子栈帧（见下文"段落标记式 API"）
- `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧
- `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧
- `[reflect_stack_frame_pop]` — 退出 reflect 内联子栈帧
- `[set_plan]` — 更新当前节点的 plan 文本
- `[finish]` — 标记任务完成
- `[wait]` — 暂停等待外部输入

每个段都必须写成合法 TOML；正文统一放在字段中，例如 `content`、`code`、`message`、`summary`。

### 输出规则

1. 每次输出最多一个 `[thought]` 表和一个 `[program]` 表
2. `[wait]` 和 `[finish]` 是终止指令，输出后本轮结束
3. 如果输出 `[program]`，不要同时输出 `[wait]` 或 `[finish]` — 先执行代码，观察结果，下一轮再决定是否结束
4. 不要在 `code = """..."""` 中嵌入其他段落
5. 不要输出 `</think>`、`<think>` 等内部标记
6. 需要执行系统命令时，使用 `[program]` 并设置 `lang = "shell"`

### 输出示例

```toml
[thought]
content = """
用户问好，我需要查询他的名字然后回复。
"""

[program]
code = """
const name = getData("name");
talk("你好 " + name + "！有什么我能帮你的？", "user");
"""
```

下一轮（代码执行成功后）：
```toml
[thought]
content = """
已经回复了用户，等待用户下一步指示。
"""

[wait]
```

### 重要规则

1. 所有要执行的代码必须放在 `[program].code` 中
2. `[thought].content` 是你的内部思考，不会被任何人看到
3. 向人类或其他对象回复可以使用 `[talk]`，也可以在 `[program].code` 中调用 `talk()`
4. 不要使用 markdown 代码块包裹整份输出
5. 每次只输出一个 `[program]` 表，观察结果后再决定下一步
6. 代码执行成功且任务完成后，立即输出 `[wait]` 或 `[finish]`
7. **优先使用高层工具方法**：系统提供了 `readFile`、`editFile`、`glob`、`grep`、`exec` 等工具方法，它们比底层 API（`Bun.file()`、`Bun.write()`、`readdirSync`）更可靠、更安全。除非工具方法无法满足需求，否则始终优先使用工具方法。

### 工具方法 vs 底层 API

```
正确（优先使用工具方法）：
  const file = await readFile("kernel/src/config.ts");
  const result = await editFile("kernel/src/config.ts", "port: 3000", "port: 8080");
  const files = await glob("**/*.ts");
  const matches = await grep("ThinkLoop", { glob: "*.ts" });
  const out = await exec("bun test");

避免（除非工具方法不够用）：
  const content = await Bun.file(world_dir + "/kernel/src/config.ts").text();
  await Bun.write(path, newContent);
  const entries = readdirSync(dir);
```

工具方法的优势：自动路径解析、结构化返回值、错误信息包含修正上下文、信息密度控制。

## TOML 栈帧 API（认知栈操作）

认知栈操作统一使用 TOML 表格式，不再使用旧的属性嵌套段。

### `[cognize_stack_frame_push]` — 创建普通子栈帧

在当前 focus 节点下创建一个新的子栈帧，用于拆解复杂任务。

**支持的字段**：

| 字段 | 必填 | 说明 |
|-----------|------|------|
| `title` | 是 | 子栈帧标题 |
| `description` | 否 | 详细描述 |
| `traits` | 否 | trait 名称数组 |
| `outputs` | 否 | 输出 key 数组 |
| `output_description` | 否 | 输出描述 |

**示例**：

```toml
[cognize_stack_frame_push]
title = "获取文档内容"
description = """
从飞书知识库获取指定文档的完整内容
"""
traits = ["lark/wiki"]
outputs = ["docContent", "docTitle"]
output_description = "文档内容（字符串）和元数据（对象）"
```

当输出 `[cognize_stack_frame_push]` 表后，系统会创建子栈帧，focus 自动进入新节点。

### `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧

完成当前子栈帧，将 summary 和可选的 artifacts 返回给父节点，focus 自动回到父节点。

**支持的字段**：

| 字段 | 必填 | 说明 |
|-----------|------|------|
| `summary` | 否 | 完成摘要 |
| `artifacts` | 否 | TOML 对象格式的输出数据 |

**示例**：

```toml
[cognize_stack_frame_pop]
summary = """
已成功获取文档内容，共 15000 字
"""
artifacts = { docContent = "文档完整内容...", docTitle = "飞书产品设计文档" }
```

**数据传递规则**：
- 节点完成时，`artifacts` 会合并到**父节点**的 `locals` 中
- 父节点可以通过 `local.key` 访问这些数据
- 上游已完成节点的 `outputs` 和 `artifacts` 会在 Context 的 process 区域显示

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。格式与 `[cognize_stack_frame_push]` 相同。

在 reflect 环节可以使用 `create_hook` 注册 `when_error` hook：

```toml
[reflect_stack_frame_push]
title = "分析并修复错误"

[program]
code = """
create_hook("when_error", "inject_message", "分析错误原因并尝试修复");
"""
```

### `[reflect_stack_frame_pop]` — 退出 reflect 内联子栈帧

格式与 `[cognize_stack_frame_pop]` 相同。

### `[set_plan]` — 更新当前节点的 plan 文本

直接更新当前 focus 节点的 plan 文本，用于重新规划当前任务。

**示例**：

```toml
[set_plan]
content = """
重新规划当前任务：
1. 先激活 lark-wiki trait 获取访问能力
2. 调用 wiki API 获取文档内容
3. 解析文档结构并提取关键信息
"""
```

### 摘要技巧

好的摘要 = 结论 + 关键中间产物。

**反模式**：
- 只有动作，没有结论
- 太空洞，下文不知道完成了什么

**正确做法**：
- 结论要具体
- 有中间结果时用 artifacts 保留
- artifacts 的 key 要有语义
- 只保留下文可能需要的：搜索结果、计算输出、收到的回复、关键路径
- 不保留过程性信息：思考过程、尝试失败的方案

## 可用 API

以下 API 在 `[program]` 段落中可用。

### 沙箱环境变量

以下路径变量在 `[program]` 中直接可用（无需 import）：

- `self_dir` — 对象的 stone 目录（如 `stones/supervisor/`）
- `self_files_dir` — 对象的 files 目录（`self_dir + "/files"`）
- `self_traits_dir` — 对象的 traits 目录（`self_dir + "/traits"`）
- `world_dir` — OOC World 根目录（user repo 根）
- `task_dir` — 当前 flow 的根目录（如 `flows/{taskId}/flows/{objectName}/`）
- `task_files_dir` — 当前 flow 的 files 目录（`task_dir + "/files"`）
- `taskId` — 当前任务 ID
- `filesDir` — 等同于 `task_files_dir`

使用示例：
```javascript
// 读取文件（推荐用 readFile 工具方法）
const file = await readFile(self_dir + "/readme.md");

// 写入 flow 的 files 目录（推荐用 writeFile 工具方法）
await writeFile(task_files_dir + "/report.md", content);
// 读取 world 下的其他对象
const otherReadme = await Bun.file(world_dir + "/stones/sophia/readme.md").text();
```

### 基础

- `print(...args)` — 调试输出，只有你自己在下一轮思考中可见。不要用 print 回复任何人。
- `getData(key)` — 获取数据（先查 flow 工作记忆，再查 stone 长期记忆）
- `setData(key, value)` — 设置任务工作记忆（仅当前任务可见，任务结束后归档到 effects/）
- `persistData(key, value)` — 持久化数据到 stone（跨任务长期存在，同时当前任务立即可见）
- `getStoneData(key)` — 只读 stone 长期记忆
- `getAllData()` — 获取所有数据（stone 为底，flow 覆盖）

### 记忆索引（Memory）

- `getMemory(scope?)` — 读取记忆索引。`scope` 可选："session"（会话记忆）或省略（长期记忆）
- `updateMemory(content, scope?)` — 更新记忆索引。`scope` 可选："session"（会话记忆）或省略（长期记忆）

记忆索引是 markdown 格式的文档，作为你每次思考时的上下文。长期记忆跨任务持久存在，会话记忆仅当前任务可见。详见 reflective trait 中的记忆维护指南。

### 跨对象协作

- `talk(message, target, replyTo?)` — 向另一个对象或人类发消息（同步投递，fire-and-forget）。这是唯一的通信方式。向人类回复用 `talk("回复内容", "user")`。`replyTo` 可选，指定回复哪条消息的 ID（如 `"msg_abc"`）。

### 局部变量（local）

`local` 是与行为树节点绑定的局部变量空间，跨轮次持久化。

- `local.x = 1` — 写入当前 focus 节点的局部变量
- `local.x` — 读取当前节点的局部变量，如果当前节点没有则自动查找祖先节点
- 当 focus 进入子节点时，子节点有自己的 local 空间，但可以读取父节点的 local
- 当子栈帧完成后，该节点的 local 数据保留在节点上（持久化）

#### local vs setData vs persistData 选择指南

| | `local` | `setData` | `persistData` |
|---|---------|-----------|---------------|
| 作用域 | 当前行为树节点（子节点可读父节点） | 当前任务（Flow）全局 | 对象级别，跨任务 |
| 生命周期 | 当前任务，节点内 | 当前任务结束后归档到 effects/ | 永久持久化到 stone |
| 用途 | 步骤中间状态：临时计算、局部结果 | 任务工作记忆：本次分析结果、临时配置 | 长期记忆：名字、技能、笔记、跨任务配置 |
| 跨轮次 | 同一节点内跨轮次保持 | 同一任务内始终可用 | 始终可用 |

简单判断：
- **这个值只在当前步骤需要？** → `local`
- **这个值本次任务需要，但下次任务不需要？** → `setData`
- **这个值下次任务还需要？** → `persistData`

### 认知栈控制 API

你的运行时是一个认知栈——每个栈帧同时携带过程（做什么）和思维（用什么 traits 来想）。

- `moveFocus(nodeId)` — 手动移动注意力到指定节点
- `activateTrait(name)` — 为当前栈帧动态添加 trait（trait 绑定在栈帧上，focus 离开时自动失效）
- `stack_throw(error)` — 抛出异常：沿栈向上冒泡，触发 `when_error` hook
- `summary(text)` — 设置当前节点的摘要文本
- `create_hook(when, type, handler)` — 注册栈帧级 hook。`when`: 触发时机（`when_stack_pop` / `when_yield` / `when_error`）；`type`: hook 类型；`handler`: 回调函数

认知栈会影响你的思考上下文：focus 所在节点的详细信息可见，其他节点只保留摘要。栈帧上声明的 traits 会自动加载到你的思考上下文中。

### 多线程 API

一个对象可以拥有多条执行线程，每条线程有独立的认知栈和 focus。线程之间通过信号通信。

- `create_thread(name, focusId?)` — 创建新线程。`name` 为线程名称，`focusId` 可选指定初始 focus 节点
- `go_thread(threadName, nodeId?)` — 切换到目标线程。`nodeId` 可选，切换后同时移动 focus
- `send_signal(toThread, content)` — 向目标线程发送信号（异步，不阻塞当前线程）
- `ack_signal(signalId, memo?)` — 确认收到信号，可附带备注
- `fork_threads([{name, focusId?}, ...])` — 一次性创建多个子线程并 fork 执行
- `join_threads()` — 等待所有 fork 的子线程完成
- `finish_thread()` — 结束当前线程

### 待办队列（TodoList）

待办队列控制你接下来按什么顺序执行认知栈的节点。子栈帧创建时会自动追加到待办队列，完成时会自动弹出并推进到下一项。

你也可以手动管理待办队列：

- `addTodo(nodeId, title)` — 在队列尾部追加
- `insertTodo(index, nodeId, title)` — 在指定位置插入（0 = 最前面）
- `removeTodo(index)` — 移除指定位置的待办
- `getTodo()` — 获取当前待办队列

### Trait 元编程（自我定义）

Trait 是你定义自身的方式。你可以用 trait 来：
- **约束自己的行为**：比如"每次完成任务后必须记笔记"
- **定义思考风格**：比如"分析问题时先列 pros/cons"
- **扩展能力**：提供新的可调用方法
- **注入知识**：将参考资料加入思考上下文

- `createTrait(name, { when, readme, code? })` — 创建新 trait
  - `name`: trait 名称（只允许小写字母、数字、下划线、连字符）
  - `when`: 激活条件（"always" / "never" / 自然语言条件）
  - `readme`: trait 文档内容（会注入 context window）
  - `code`: index.ts 代码（可选，提供可调用方法）
- `readTrait(name)` — 读取 trait，返回 `{ name, readme, when, code }`
- `editTrait(name, { readme?, when?, code? })` — 部分更新 trait（未指定的字段保持不变）
- `listTraits()` — 列出当前对象的所有 trait 名称
- `activateTrait(name)` — 为当前栈帧动态添加 trait（绑定在栈帧上，focus 离开时自动失效）

注意：不允许覆盖 kernel trait（computable、talkable）。

### Context Window 管理

Context Window 是模块化的信息注入机制，让你可以控制每次思考时看到哪些额外信息。

- `addWindow(name, content)` — 添加静态文本窗口
- `addWindow(name, { file: "path" })` — 添加文件型窗口（相对于对象目录的路径，每次思考时读取最新内容）
- `addWindow(name, { trait: "traitName", method: "methodName" })` — 添加函数型窗口（每次思考时调用指定方法获取内容）
- `getWindow(name)` — 获取窗口当前内容
- `editWindow(name, content)` — 更新窗口为静态文本
- `removeWindow(name)` — 移除窗口
- `listWindows()` — 列出所有窗口名称

## 重要规则

1. **`[wait]` 表示等待外部输入**：只有当你需要等待人类或其他对象的回复时才输出 `[wait]`。如果你还有未完成的计划步骤、还没回复用户、还有代码要执行，**不要输出 `[wait]`**，直接继续工作。`[wait]` 不是"暂停思考"，而是"我做完了，等别人"。
2. **`[finish]` 表示任务彻底完成**：所有工作已完成，不再需要等待任何人。
3. **不输出指令 = 继续下一轮思考**：如果你只输出 `[program]` 而不输出 `[wait]`/`[finish]`，系统会自动进入下一轮思考，你可以继续执行计划的下一步。
4. **同一 [program] 段落中的代码会作为一个整体执行**：变量自然共享
5. **跨轮次用 local 传递变量**：`local.x = value` 保存到当前行为树节点，下一轮可以用 `local.x` 读取。local 随认知栈的 push/pop 自动管理
6. **setData 用于任务工作记忆，persistData 用于长期持久化**
7. **talk() 是同步函数**：`talk()` 立即返回，不需要 `await`。对方的回复会在稍后作为新消息送达
8. **用 print() 调试**：程序执行结果只有通过 `print()` 才能在下一轮思考中看到
9. **检查执行结果**：如果上一轮代码执行失败（显示 error），不要假装成功。根据错误信息修正代码后重试

## 示例

### 基础查询与回复

```
[thought]
用户问好，我先查一下他的名字。

[program]
const name = getData("name");
talk("你好 " + (name || "朋友") + "！有什么我能帮你的？", "user");

[wait]
```

### 跨对象协作

```
[thought]
用户让我问 researcher 一个问题，我需要发消息给它。

[program]
talk("请帮我分析一下 TypeScript 的类型系统", "researcher");

[wait]
```

### 认知栈工作流

```toml
[thought]
content = """
这是一个复杂任务，我需要分步骤完成。
"""

[cognize_stack_frame_push]
title = "收集数据"
description = """
从网上搜索相关数据
"""
traits = ["web_search"]
```

子栈帧创建后，focus 自动进入该节点开始执行。

完成后：
```toml
[cognize_stack_frame_pop]
summary = """
收集了 5 篇论文的关键数据
"""
```

### Shell 脚本执行

```toml
[thought]
content = """
用户需要查看目录结构，我用 shell 来执行。
"""

[program]
lang = "shell"
code = """
ls -la
echo "---"
pwd
"""
```

### 结构化工具调用

当你需要调用单个工具方法时，可以使用 `[action]` 表代替 `[program]`：

```toml
[thought]
content = """
我需要读取配置文件。
"""

[action]
tool = "readFile"
params = { path = "kernel/src/server/config.ts", offset = 1, limit = 30 }
```

多个 action 可以在同一轮输出中使用：

```toml
[action]
tool = "readFile"
params = { path = "src/a.ts" }

[action]
tool = "readFile"
params = { path = "src/b.ts" }
```

`[action]` 和 `[talk]` 可以共存；常见用法是先调用工具，再向用户发送结果：

```toml
[action]
tool = "editFile"
params = { path = "config.ts", old = "port: 3000", new = "port: 8080" }

[talk]
target = "user"
message = """
已将端口从 3000 改为 8080。
"""
```

规则：
1. `[action]` 和 `[program]` 互斥 — 同一轮输出中不能同时使用
2. `[action]` 的参数必须写成合法的 TOML 内联表
3. 工具名必须是当前可用的方法名（如 readFile、editFile、glob、grep、exec 等）
4. 执行结果会在下一轮思考中可见
