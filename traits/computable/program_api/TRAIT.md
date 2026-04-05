---
name: kernel/computable/program_api
type: how_to_use_tool
when: never
description: 完整 API 参考文档 — 所有工具方法、沙箱环境变量、Trait 元编程、Context Window
deps: ["kernel/computable"]
---

# 完整 API 参考文档

以下 API 在 `[program]` 段落中可用。

## 沙箱环境变量

以下路径变量在 `[program]` 中直接可用（无需 import）：

- `self_dir` — 对象的 stone 目录（如 `stones/supervisor/`）
- `self_files_dir` — 对象的 files 目录（`self_dir + "/files"`）
- `self_traits_dir` — 对象的 traits 目录（`self_dir + "/traits"`）
- `world_dir` — OOC World 根目录（user repo 根）
- `task_dir` — 当前 flow 的根目录（如 `flows/{sessionId}/objects/{objectName}/`）
- `task_files_dir` — 当前 flow 的 files 目录（`task_dir + "/files"`）
- `sessionId` — 当前任务 ID
- `filesDir` — 等同于 `task_files_dir`

## 基础 API

- `print(...args)` — 调试输出，只有你自己在下一轮思考中可见。不要用 print 回复任何人。
- `getData(key)` — 获取数据（先查 flow 工作记忆，再查 stone 长期记忆）
- `setData(key, value)` — 设置任务工作记忆（仅当前任务可见，任务结束后归档到 effects/）
- `persistData(key, value)` — 持久化数据到 stone（跨任务长期存在，同时当前任务立即可见）
- `getStoneData(key)` — 只读 stone 长期记忆
- `getAllData()` — 获取所有数据（stone 为底，flow 覆盖）

## 记忆索引（Memory）

- `getMemory(scope?)` — 读取记忆索引。`scope` 可选："session"（会话记忆）或省略（长期记忆）
- `updateMemory(content, scope?)` — 更新记忆索引。`scope` 可选："session"（会话记忆）或省略（长期记忆）

记忆索引是 markdown 格式的文档，作为你每次思考时的上下文。长期记忆跨任务持久存在，会话记忆仅当前任务可见。详见 reflective trait 中的记忆维护指南。

## 跨对象协作

- `talk(message, target, replyTo?)` — 向另一个对象或人类发消息（同步投递，fire-and-forget）。这是唯一的通信方式。向人类回复用 `talk("回复内容", "user")`。`replyTo` 可选，指定回复哪条消息的 ID（如 `"msg_abc"`）。

## 局部变量（local）

`local` 是与行为树节点绑定的局部变量空间，跨轮次持久化。

- `local.x = 1` — 写入当前 focus 节点的局部变量
- `local.x` — 读取当前节点的局部变量，如果当前节点没有则自动查找祖先节点
- 当 focus 进入子节点时，子节点有自己的 local 空间，但可以读取父节点的 local
- 当子栈帧完成后，该节点的 local 数据保留在节点上（持久化）

### local vs setData vs persistData 选择指南

| | `local` | `setData` | `persistData` |
|---|---------|-----------|---------------|
| 作用域 | 当前行为树节点（子节点可读父节点） | 当前任务（Flow）全局 | 对象级别，跨任务 |
| 生命周期 | 当前任务，节点内 | 当前任务结束后归档到 effects/ | 永久持久化到 stone |
| 用途 | 步骤中间状态 | 任务工作记忆 | 长期记忆 |

简单判断：
- **这个值只在当前步骤需要？** → `local`
- **这个值本次任务需要，但下次任务不需要？** → `setData`
- **这个值下次任务还需要？** → `persistData`

## 认知栈控制 API

- `moveFocus(nodeId)` — 手动移动注意力到指定节点
- `activateTrait(name)` — 为当前栈帧动态添加 trait（trait 绑定在栈帧上，focus 离开时自动失效）
- `stack_throw(error)` — 抛出异常：沿栈向上冒泡，触发 `when_error` hook
- `summary(text)` — 设置当前节点的摘要文本
- `create_hook(when, type, handler)` — 注册栈帧级 hook。`when`: `when_stack_pop` / `when_yield` / `when_error`；`type`: hook 类型；`handler`: 回调函数

## 待办队列（TodoList）

待办队列控制认知栈节点的执行顺序。子栈帧创建时自动追加，完成时自动弹出。

- `addTodo(nodeId, title)` — 在队列尾部追加
- `insertTodo(index, nodeId, title)` — 在指定位置插入（0 = 最前面）
- `removeTodo(index)` — 移除指定位置的待办
- `getTodo()` — 获取当前待办队列

## Trait 元编程（自我定义）

- `createTrait(name, { when, readme, code? })` — 创建新 trait
  - `name`: trait 名称（只允许小写字母、数字、下划线、连字符）
  - `when`: 激活条件（"always" / "never" / 自然语言条件）
  - `readme`: trait 文档内容（会注入 context window）
  - `code`: index.ts 代码（可选，提供可调用方法）
- `readTrait(name)` — 读取 trait，返回 `{ name, readme, when, code }`
- `editTrait(name, { readme?, when?, code? })` — 部分更新 trait
- `listTraits()` — 列出当前对象的所有 trait 名称
- `activateTrait(name)` — 为当前栈帧动态添加 trait

注意：不允许覆盖 kernel trait（computable、talkable）。

## Context Window 管理

- `addWindow(name, content)` — 添加静态文本窗口
- `addWindow(name, { file: "path" })` — 添加文件型窗口（相对于对象目录）
- `addWindow(name, { trait: "traitName", method: "methodName" })` — 添加函数型窗口
- `getWindow(name)` — 获取窗口当前内容
- `editWindow(name, content)` — 更新窗口为静态文本
- `removeWindow(name)` — 移除窗口
- `listWindows()` — 列出所有窗口名称

## 工具方法 vs 底层 API

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

## 重要规则

1. `[wait]` 表示等待外部输入，不是"暂停思考"
2. `[finish]` 表示任务彻底完成
3. 不输出指令 = 继续下一轮思考
4. 同一 [program] 中的代码作为一个整体执行
5. 跨轮次用 local 传递变量
6. talk() 是同步函数，不需要 await
7. 用 print() 调试
8. 检查执行结果：代码失败时根据错误修正重试
