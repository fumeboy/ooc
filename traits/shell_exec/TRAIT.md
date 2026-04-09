---
name: kernel/shell_exec
type: how_to_use_tool
version: 1.0.0
when: always
description: 执行 Shell 命令，支持自定义超时和工作目录
deps: []
---
# Shell 执行能力

你可以通过以下 API 执行 Shell 命令。

## 可用 API

### exec(command, options?)

执行一条 Shell 命令，**直接返回 stdout 字符串**。

- `command` — 要执行的 Shell 命令字符串
- `options.cwd` — 工作目录（默认为对象的 rootDir）
- `options.timeout` — 超时毫秒数（默认 120000，最大 600000）
- `options.env` — 额外环境变量
- `options.allowNonZero` — 允许非 0 exit code（默认 false）。用于 `grep/rg` 等“无匹配=1”的命令

**返回值：**
- 成功时返回 stdout 字符串
- 失败时抛出 `ExecError` 异常，异常消息包含 exitCode 和 stderr

#### 简单命令

```javascript
// 成功时直接返回 stdout
const output = await exec("echo hello");
print(output); // 输出: "hello\n"

// 自定义工作目录
const result = await exec("ls -la", { cwd: "/tmp" });

// 带超时
const result = await exec("long-running-task", { timeout: 5000 });
```

#### 错误处理

命令执行失败（非零 exitCode）或超时时会抛出 `ExecError` 异常：

```javascript
try {
  const output = await exec("invalid-command");
  print(output);
} catch (e) {
  print("执行失败:", e.message);
  // e.message 包含 exitCode 和 stderr
  // 还可以访问: e.stdout, e.stderr, e.exitCode, e.timedOut
}
```

### sh(command, options?)

执行一条 Shell 命令，返回结构化结果（不因非 0 exit code 直接抛错）：

- 返回：`{ ok, exitCode, timedOut, stdout, stderr }`
- 适合：`grep/rg` 等需要自行判断 exit code 的场景

#### ExecError 类型

```typescript
class ExecError extends Error {
  readonly stdout: string;    // 标准输出
  readonly stderr: string;    // 标准错误
  readonly exitCode: number;  // 退出码
  readonly timedOut: boolean; // 是否因超时被终止
}
```

## 注意事项

1. 命令失败（非零 exitCode）不会返回错误对象，而是直接抛出异常
2. 超时的命令会被强制终止，`e.timedOut` 为 true
3. 所有命令通过 `sh -c` 执行，支持管道、重定向等 Shell 特性

## ⚠️ 安全警告

以下命令具有破坏性，执行前请三思：

- `rm -rf` — 递归强制删除，可能导致不可恢复的数据丢失
- `sudo` — 提权操作，可能影响系统安全
- `git push --force` — 强制推送，可能覆盖他人工作
- `chmod -R 777` — 开放所有权限，存在安全风险
- `dd` — 低级磁盘操作，误用可能破坏数据
