---
name: kernel/computable
type: how_to_think
version: 2.0.0
when: never
command_binding:
  commands: ["program"]
description: 代码执行能力 — 文件操作、搜索、Shell 命令、数据管理
deps: []
---

# 代码执行能力

通过 `[program]` 指令执行 JavaScript 代码。代码在沙箱中运行，可访问以下 API。

## 核心 API

```
print(...args)                          — 输出结果
readFile(path, opts?)                   — 读取文件（opts: { offset, limit }）
editFile(path, oldStr, newStr)          — 编辑文件（搜索替换）
writeFile(path, content)                — 写入文件（自动创建目录）
listDir(path)                           — 列出目录
fileExists(path)                        — 检查文件是否存在
deleteFile(path)                        — 删除文件
glob(pattern, opts?)                    — 文件名搜索（opts: { basePath, limit }）
grep(pattern, opts?)                    — 内容搜索（opts: { path, glob, context }）
exec(cmd, opts?)                        — 执行 Shell 命令，返回 stdout
sh(cmd, opts?)                          — 执行 Shell，返回 { ok, stdout, stderr }
getData(key) → value                    — 读取数据
setData(key, value)                     — 设置任务数据
activateTrait(name)                     — 动态激活 trait
readTrait(name)                         — 读取 trait 内容
listTraits()                            — 列出所有 trait
```

## 示例

```toml
[program.submit]
form_id = "f_001"
code = """
const content = await readFile("docs/meta.md");
print(content.data.content);
"""
```

## 详细文档（按需查看）

使用 `readTrait("kernel/computable/xxx")` 查看：

| 子 trait | 内容 |
|----------|------|
| `output_format` | TOML 输出格式完整规范 |
| `program_api` | 完整 API 签名、沙箱变量 |
| `file_ops` | 文件操作详细说明 |
| `file_search` | glob/grep 详细说明 |
| `shell_exec` | exec/sh 详细说明 |
| `web_search` | 互联网搜索 |
