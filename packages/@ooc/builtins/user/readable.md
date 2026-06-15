---
title: user
description: 真人用户的占位 Object；定义 inline UI token 协议供其它 Object 学习
---

# user

我是真人用户在 OOC World 内的占位 Object。你通过 `talk_window` 向我发消息时
（`target: "user"`），消息会渲染到 web 控制面的 chat panel 给真人看。

## 特殊语法：inline UI 组件

发给我的文本里可以嵌入特殊 token，让前端在消息中渲染出可交互的小组件，而不
止是纯文本。

### 语法

```
[[ui{"comp":"<组件名>","<参数1>":"<值1>",...}ui]]
```

- `[[ui` 起首、`ui]]` 结束（双方括号 + ui 标记）
- 中间是一个**严格 JSON 对象**（注意所有 key 必须用双引号），其中 `comp` 字段
  指定组件名，其余字段是该组件的参数
- 一条消息里可以出现任意多个 token，可以与普通文本混排

### 已注册组件

| comp | 必选参数 | 可选参数 | 行为 |
|---|---|---|---|
| `file-link` | `path` | `label` | 渲染一个可点击的链接，点击会在主视图打开该文件（路径相对 world root） |
| `follow-ups` | `options` | — | 在消息末尾渲染一组**建议追问按钮**，竖排卡片样式；用户点击任一按钮即把该文本作为下一轮 user 输入直接发送给本 thread 的对端。`options` 是 string 数组，每条建议一句完整的话，长度建议 ≤ 80 字。仅当对端 thread（user 这条 chat）是 user 自己 own 或被 user 派生时才有用——其它场景下按钮不渲染。 |

### 示例

```
分析完了，结论写在 [[ui{"comp":"file-link","path":"flows/main/agent_of_x/threads/root/findings.md","label":"findings.md"}ui]] 里，你看一下。
```

```
完成。还需要我做什么？

[[ui{"comp":"follow-ups","options":["把这个改动应用到 handler.go","继续生成 TCC 配置示例","帮我整理 PR 描述"]}ui]]
```

### 何时使用 follow-ups

- 任务完成 / 阶段总结后，列出 2–4 条**用户大概率会接着问**的下一步动作
- 选项要写成完整的、可独立发送的句子（点击直接发出去），不要写成"是 / 否"或"选项 A / 选项 B"这种依赖上下文才能解读的标签
- 不必每条消息都加；信息查询类 / 已确定下一步时省略
- 一般放在消息末尾。中部嵌入也合法，但视觉上会打断阅读流

### 失败回退

- JSON 解析失败：原文按字面文本展示（不报错）
- 未知 `comp`：渲染成 inline 灰色 `<code>` 提示 `[unknown ui: <comp>]`
- 缺必选参数：组件不渲染，等价于 token 被吞
