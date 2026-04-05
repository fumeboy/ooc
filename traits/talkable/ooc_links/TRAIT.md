---
name: kernel/talkable/ooc_links
type: how_to_interact
when: never
description: ooc:// 链接协议和导航卡片格式
deps: ["kernel/talkable"]
---

# ooc:// 链接协议

OOC 系统使用 `ooc://` 协议来引用系统内的对象和文件。

## 链接格式

- `ooc://object/{name}` — 引用一个对象（如 `ooc://object/sophia`）
- `ooc://file/objects/{name}/files/{path}` — 引用对象的共享文件

路径中的 `{name}` 是对象名，`{path}` 是 files 目录下的相对路径。

## 导航卡片

当你生成了文档、UI 或重要内容需要引导用户查看时，使用导航卡片格式。前端会将其渲染为可点击的卡片。

### 格式

```
[navigate title="标题" description="简短描述"]ooc://...[/navigate]
```

- `title`（必填）— 卡片标题
- `description`（可选）— 卡片描述文字
- URL 必须是 `ooc://` 链接

### 示例

```toml
[talk]
target = "user"
message = """
我已经为你生成了项目看板，请查看：

[navigate title="项目看板" description="当前任务进度总览"]ooc://file/objects/supervisor/files/kanban.md[/navigate]
"""
```

### 使用场景

- 你生成了文档或报告，需要引导用户查看
- 你创建了自渲染 UI，需要引导用户访问
- 你完成了任务，结果保存在 files 文件中

普通引用用 `ooc://` 链接即可（渲染为可点击文本），导航卡片用于"我做了一个东西，请你来看"的场景。
