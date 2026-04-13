---
name: kernel/computable/program_api
type: how_to_use_tool
when: never
description: 完整 API 参考文档 — 沙箱环境变量、工具方法、Trait 自省
deps: ["kernel/computable"]
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

## 基础 API

- `print(...args)` — 输出结果（必须用 print，不要用 console.log）
- `getData(key)` — 获取数据（先查 flow 工作记忆，再查 stone 长期记忆）
- `setData(key, value)` — 设置任务工作记忆（仅当前任务可见）
- `persistData(key, value)` — 持久化数据到 stone（跨任务长期存在）
- `getStoneData(key)` — 只读 stone 长期记忆
- `getAllData()` — 获取所有数据（stone 为底，flow 覆盖）

## 文件操作

- `readFile(path, opts?)` — 读取文件，返回字符串（不存在返回 null）。opts: { offset, limit }
- `editFile(path, oldStr, newStr)` — 编辑文件（搜索替换），返回字符串
- `writeFile(path, content)` — 写入文件（自动创建目录）
- `listDir(path)` — 列出目录，返回文件名数组
- `fileExists(path)` — 检查文件是否存在，返回 boolean
- `deleteFile(path)` — 删除文件

## 搜索

- `glob(pattern, opts?)` — 文件名搜索，返回路径数组。opts: { basePath, limit }
- `grep(pattern, opts?)` — 内容搜索，返回匹配结果字符串。opts: { path, glob, context }

## Shell

- `exec(cmd, opts?)` — 执行 Shell 命令，返回 stdout 字符串
- `sh(cmd, opts?)` — 执行 Shell，返回 { ok, stdout, stderr }

## 记忆

- `getMemory(scope?)` — 读取记忆。scope: "session"（会话记忆）或省略（长期记忆）
- `updateMemory(content, scope?)` — 更新记忆。scope: "session" 或省略

## Trait 自省与动态激活

- `listTraits()` / `listLibraryTraits()` — 列出所有已加载的 trait ID
- `listActiveTraits()` — 列出当前线程作用域链下生效的 trait ID
- `readTrait(name)` — 读取 trait 文档，返回 { path, content }
- `activateTrait(name)` / `deactivateTrait(name)` — 动态修改当前线程的激活 trait
- `methods(trait?)` — 列出当前可调用的工具方法签名
- `help()` — 打印 API 简短说明

## 局部变量（local）

`local` 是与线程节点绑定的局部变量空间，跨轮次持久化。

- `local.x = 1` — 写入当前线程的局部变量
- `local.x` — 读取当前线程的局部变量

子线程完成后，artifacts 会合并到父线程的 locals 中。

### local vs setData vs persistData

| | `local` | `setData` | `persistData` |
|---|---------|-----------|---------------|
| 作用域 | 当前线程 | 当前任务全局 | 对象级别，跨任务 |
| 生命周期 | 当前任务 | 当前任务 | 永久 |
| 用途 | 步骤中间状态 | 任务工作记忆 | 长期记忆 |

## 工具方法 vs 底层 API

```
优先使用工具方法：
  const file = await readFile("kernel/src/config.ts");
  const result = await editFile("kernel/src/config.ts", "port: 3000", "port: 8080");
  const files = await glob("**/*.ts");
  const matches = await grep("ThinkLoop", { glob: "*.ts" });
  const out = await exec("bun test");

避免（除非工具方法不够用）：
  const content = await Bun.file(world_dir + "/kernel/src/config.ts").text();
  await Bun.write(path, newContent);
```

工具方法的优势：自动路径解析、结构化返回值、错误信息包含修正上下文。

## 重要规则

1. 用 print() 输出结果
2. 检查执行结果：代码失败时根据错误修正重试
3. talk() 是同步函数，不需要 await
