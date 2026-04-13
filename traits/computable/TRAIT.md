---
name: kernel/computable
type: how_to_think
version: 2.1.0
when: never
command_binding:
  commands: ["program"]
description: 代码执行能力 — 文件操作、搜索、Shell 命令、数据管理
deps: []
---

# 代码执行能力

通过 `program_submit` 工具执行 JavaScript 代码。代码在沙箱中运行，可访问以下 API。

## 核心 API

```
print(...args)                          — 输出结果（必须用 print，不要用 console.log）
readFile(path, opts?)                   — 读取文件，返回字符串（不存在返回 null）
                                          opts: { offset: 起始行, limit: 最大行数 }
editFile(path, oldStr, newStr)          — 编辑文件（搜索替换），返回字符串
writeFile(path, content)                — 写入文件（自动创建目录）
listDir(path)                           — 列出目录，返回文件名数组
fileExists(path)                        — 检查文件是否存在，返回 boolean
deleteFile(path)                        — 删除文件
glob(pattern, opts?)                    — 文件名搜索，返回路径数组
                                          opts: { basePath, limit }
grep(pattern, opts?)                    — 内容搜索，返回匹配结果字符串
                                          opts: { path, glob, context }
exec(cmd, opts?)                        — 执行 Shell 命令，返回 stdout 字符串
sh(cmd, opts?)                          — 执行 Shell，返回 { ok, stdout, stderr }
getData(key)                            — 读取数据
setData(key, value)                     — 设置任务数据
activateTrait(name)                     — 动态激活 trait
readTrait(name)                         — 读取 trait 内容
listTraits()                            — 列出所有 trait
```

## 示例

读取文件：
```javascript
const content = await readFile("docs/meta.md");
print(content);  // 直接输出字符串，不需要 .data.content
```

读取前 10 行：
```javascript
const content = await readFile("docs/meta.md", { limit: 10 });
print(content);
```

搜索文件：
```javascript
const files = await glob("**/*.ts");
print(files);
```

执行 Shell：
```javascript
const output = await exec("ls -la");
print(output);
```

## 详细文档（按需查看）

使用 `readTrait("kernel/computable/xxx")` 查看：

| 子 trait | 内容 |
|----------|------|
| `program_api` | 完整 API 签名、沙箱变量 |
| `file_ops` | 文件操作详细说明 |
| `file_search` | glob/grep 详细说明 |
| `shell_exec` | exec/sh 详细说明 |
| `web_search` | 互联网搜索 |
