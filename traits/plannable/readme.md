---
when: 当任务包含多个步骤、需要拆解、或不确定从哪里开始时
description: "任务拆解和行为树规划，先想清楚再动手"
deps: []
---

# 规划能力

## 规划 API

### createPlan(title, description)

创建完整的多步骤计划，替换当前行为树：

```javascript
const root = createPlan("任务名称", "任务的具体目标描述");
```

### create_plan_node(parentId, title, description, traits?)

在计划中添加步骤，所有步骤挂在 root 下平级排列：

```javascript
create_plan_node(root, "收集信息", "从 3 个来源收集数据", ["web_search"]);
create_plan_node(root, "分析数据", "对比各来源观点");
create_plan_node(root, "撰写报告", "整理结论并回复用户");
```

每个步骤应该：
- 有明确的完成标准
- 可以独立验证
- 足够小（一两轮思考能完成）
- 声明需要的 traits（让系统自动加载相关知识）

### finish_plan_node(summary)

完成当前步骤，focus 自动推进到下一个待办节点：

```javascript
finish_plan_node("从 3 个来源收集了关键数据");
```

## 栈帧语义 API

| API | 作用 | 等价操作 |
|-----|------|---------|
| `add_stack_frame(title, description?)` | 压栈 — 快速创建子帧 | createPlan 的轻量版 |
| `stack_return(summary?, artifacts?)` | 弹栈 — 完成当前帧 | finish_plan_node |
| `go(nodeId)` | 跳转到指定节点 | moveFocus |
| `compress(actionIds)` | 折叠多条 actions 为摘要 | — |

## 按步骤执行

- 一次只做一步
- 每步完成后用 `finish_plan_node(summary)` 标记，focus 自动推进到下一步
- 验证当前步骤的结果后再进入下一步
- 如果发现计划需要调整，用 `create_plan_node` 添加新步骤

## YAGNI 原则

不做没被要求的事：
- 不添加"以防万一"的功能
- 不做"顺便优化"
- 不解决没被提到的问题
- 当前任务需要什么就做什么

## Red Flags

- "这个很简单，不需要计划" → 拆解后再判断
- "我先把所有东西都做了再说" → 一次只做一步
- "顺便把这个也改了" → 不在计划内的不做
- 做了 3 轮还没有明确进展 → 停下来重新规划
