---
namespace: kernel
name: plannable/kanban
type: how_to_use_tool
description: Session 级 Issue/Task 管理 API
deps: []
---

# Kanban API

Session 级别的 Issue/Task 管理。通过 `program` 的 trait/method 形态调用：

```json
open({
  "title": "创建 Issue",
  "type": "command",
  "command": "program",
  "trait": "kernel:plannable/kanban",
  "method": "createIssue",
  "description": "创建 Issue"
})
refine({
  "form_id": "f_xxx",
  "args": { "title": "标题", "description": "描述" }
})
submit({
  "form_id": "f_xxx"
})
```

## Issue 管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `createIssue(title, description?, participants?)` | title: 标题 | 创建 Issue，初始状态 discussing |
| `updateIssueStatus(issueId, status)` | status: discussing/designing/reviewing/executing/confirming/done/closed | 更新状态 |
| `updateIssue(issueId, fields)` | fields: { title?, description?, participants?, taskRefs?, reportPages? } | 更新字段 |
| `setIssueNewInfo(issueId, hasNewInfo)` | hasNewInfo: boolean | 标记需要人类确认 |
| `closeIssue(issueId)` | | 关闭 Issue |

## Task 管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `createTask(title, description?, issueRefs?)` | title: 标题 | 创建 Task，初始状态 running |
| `updateTaskStatus(taskId, status)` | status: running/done/closed | 更新状态 |
| `updateTask(taskId, fields)` | fields: { title?, description?, issueRefs?, reportPages? } | 更新字段 |
| `createSubTask(taskId, title, assignee?)` | assignee: 分配对象名 | 创建子任务 |
| `updateSubTask(taskId, subTaskId, fields)` | fields: { title?, assignee?, status? } | 更新子任务 |
| `setTaskNewInfo(taskId, hasNewInfo)` | hasNewInfo: boolean | 标记需要人类确认 |

## 数据存储

- Issues: `flows/{sessionId}/issues/index.json` + `issue-{id}.json`
- Tasks: `flows/{sessionId}/tasks/index.json` + `task-{id}.json`
