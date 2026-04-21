---
namespace: kernel
name: computable/program_api
type: how_to_use_tool
when: never
description: 完整 API 参考文档 — 沙箱环境、callMethod 协议、Trait 自省
deps: ["kernel:computable"]
---

# 完整 API 参考文档

以下 API 在 `submit(code=...)` 执行代码时可用。

## 沙箱环境变量

以下路径变量直接可用（无需 import）：

- `self_dir` — 对象的 stone 目录（如 `stones/supervisor/`）
- `self_files_dir` — 对象的 files 目录（`self_dir + "/files"`）
- `self_traits_dir` — 对象的 traits 目录（`self_dir + "/traits"`）
- `world_dir` — OOC World 根目录（user repo 根）
- `task_dir` — 当前 flow 的根目录（如 `flows/{sessionId}/objects/{objectName}/`）
- `task_files_dir` — 当前 flow 的 files 目录（`task_dir + "/files"`）
- `sessionId` — 当前 session ID
- `filesDir` — 等同于 `task_files_dir`

## 基础 API（沙箱原生，不走 callMethod）

- `print(...args)` — 输出结果（必须用 print，不要用 console.log）
- `getData(key)` — 获取数据（先查 flow 工作记忆，再查 stone 长期记忆）
- `setData(key, value)` — 设置任务工作记忆（仅当前任务可见）
- `persistData(key, value)` — 持久化数据到 stone（跨任务长期存在）
- `getStoneData(key)` — 只读 stone 长期记忆
- `getAllData()` — 获取所有数据（stone 为底，flow 覆盖）
- `local.x = value` / `local.x` — 当前线程局部变量（跨轮次持久化）

## 唯一方法调用协议：`callMethod(traitId, methodName, args)`

**所有 trait 方法通过这个单一入口调用。** args 永远是对象。

```javascript
// 完整 traitId（推荐）
await callMethod("kernel:computable/file_ops", "readFile", { path: "docs/meta.md" });

// 省略 namespace：按 self → kernel → library 顺序解析
await callMethod("computable/file_ops", "readFile", { path: "docs/meta.md" });

// self namespace 的 trait
await callMethod("self:report", "parseReport", { path: "report.md" });
```

### 常用方法一览（kernel 命名空间）

**文件操作**（`kernel:computable/file_ops`）：
- `readFile({ path, offset?, limit? })` — 读文件，返回 `{ content, totalLines, truncated }`
- `writeFile({ path, content })` — 写文件（自动建目录）
- `editFile({ path, oldStr, newStr, replaceAll? })` — 搜索替换
- `listDir({ path, recursive?, includeHidden?, limit? })` — 列目录
- `fileExists({ path })` — 检查存在
- `deleteFile({ path, recursive? })` — 删除

**文件搜索**（`kernel:computable/file_search`）：
- `glob({ pattern, basePath?, limit?, ignore? })` — 文件名模式
- `grep({ pattern, path?, glob?, context?, maxResults?, ignoreCase? })` — 内容搜索

**Shell 执行**（`kernel:computable/shell_exec`）：
- `exec({ command, cwd?, timeout?, env?, allowNonZero? })` — 失败抛 ExecError
- `sh({ command, cwd?, timeout?, env? })` — 返回 `{ stdout, stderr, exitCode, timedOut, ok }`

**Web 搜索**（`kernel:computable/web_search`）：
- `search({ query, maxResults? })` — DuckDuckGo 搜索
- `fetchPage({ url })` — 抓取网页，HTML 自动转纯文本

**看板管理**（`kernel:plannable/kanban`）：
- `createIssue / updateIssueStatus / updateIssue / closeIssue / setIssueNewInfo`
- `createTask / updateTaskStatus / updateTask / setTaskNewInfo`
- `createSubTask / updateSubTask`

### 示例

```javascript
// 读文件
const r = await callMethod("computable/file_ops", "readFile", { path: "docs/meta.md", limit: 50 });
print(r.data.content);

// 搜索
const files = await callMethod("computable/file_search", "glob", { pattern: "**/*.ts", limit: 20 });
print(files.data);

// Shell
const out = await callMethod("computable/shell_exec", "exec", { command: "bun test", timeout: 60_000 });
print(out);
```

### 找不到方法时的错误

若 traitId 或 methodName 解析失败，`callMethod` 会抛错，错误消息包含
原始参数和通道信息（`... not found (llm channel)`）。

## 记忆

- `getMemory(scope?)` — 读取记忆。scope: "session"（会话记忆）或省略（长期记忆）
- `updateMemory(content, scope?)` — 更新记忆

## Trait 自省与动态激活

- `listTraits()` / `listLibraryTraits()` — 列出所有已加载的 traitId
- `listActiveTraits()` — 列出当前线程作用域链下生效的 traitId
- `readTrait(name)` — 读取 trait 文档，返回 `{ path, content }`
- `activateTrait(name)` / `deactivateTrait(name)` — 动态修改当前线程的激活 trait
- `methods(trait?)` — 列出当前可调用的工具方法签名
- `help()` — 打印 API 简短说明

## local vs setData vs persistData

| | `local` | `setData` | `persistData` |
|---|---------|-----------|---------------|
| 作用域 | 当前线程 | 当前任务全局 | 对象级别，跨任务 |
| 生命周期 | 当前任务 | 当前任务 | 永久 |
| 用途 | 步骤中间状态 | 任务工作记忆 | 长期记忆 |

## 工具方法 vs 底层 API

```javascript
// 优先用 callMethod
const r = await callMethod("computable/file_ops", "readFile", { path: "x.ts" });
const files = await callMethod("computable/file_search", "glob", { pattern: "**/*.ts" });
const out = await callMethod("computable/shell_exec", "exec", { command: "bun test" });

// 避免（除非工具方法不够用）
const content = await Bun.file(world_dir + "/x.ts").text();
```

工具方法的优势：自动路径解析、结构化返回值、错误信息包含修正上下文。

## 重要规则

1. 用 `print()` 输出结果
2. 检查执行结果：代码失败时根据错误修正重试
3. `callMethod` 和 `talk` 都是异步，必须 `await`
4. args 永远是对象，不要用位置参数
