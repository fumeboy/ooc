---
when: always
description: "执行 Shell 命令，支持自定义超时和工作目录"
---

# Shell 执行能力

你可以通过以下 API 执行 Shell 命令。

## 可用 API

### exec(command, options?)

执行一条 Shell 命令，返回 stdout、stderr、exitCode 和超时标志。

- `command` — 要执行的 Shell 命令字符串
- `options.cwd` — 工作目录（默认为对象的 rootDir）
- `options.timeout` — 超时毫秒数（默认 120000，最大 600000）
- `options.env` — 额外环境变量

```javascript
// 简单命令
const result = await exec("echo hello");
// result.data = { stdout: "hello\n", stderr: "", exitCode: 0, timedOut: false }

// 自定义工作目录
const result = await exec("ls -la", { cwd: "/tmp" });

// 带超时
const result = await exec("long-running-task", { timeout: 5000 });
// 超时时 result.data.timedOut = true

// 带环境变量
const result = await exec("echo $MY_VAR", { env: { MY_VAR: "hello" } });
```

## 注意事项

1. 命令失败（非零 exitCode）不会返回错误，而是在 `data.exitCode` 中体现
2. 超时的命令会被强制终止，`data.timedOut` 为 true
3. 所有命令通过 `sh -c` 执行，支持管道、重定向等 Shell 特性

## ⚠️ 安全警告

以下命令具有破坏性，执行前请三思：

- `rm -rf` — 递归强制删除，可能导致不可恢复的数据丢失
- `sudo` — 提权操作，可能影响系统安全
- `git push --force` — 强制推送，可能覆盖他人工作
- `chmod -R 777` — 开放所有权限，存在安全风险
- `dd` — 低级磁盘操作，误用可能破坏数据
