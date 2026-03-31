---
when: 当任务包含多个步骤、需要拆解、或不确定从哪里开始时
description: "任务拆解和行为树规划，先想清楚再动手"
deps: []
---

# 规划能力

## 规划 API

### createPlan(title, description)

在当前任务节点下创建一个多步骤计划容器（不替换已有内容）：

```javascript
const root = createPlan("任务名称", "任务的具体目标描述");
```

**注意**：`createPlan` 不会替换当前行为树，而是在当前 focus 节点下创建子节点作为计划容器。这样可以保留已记录的 actions 和历史数据。

### create_plan_node(parentId, title, description?, traits?, outputs?, outputDescription?)

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

## 契约式编程（输出约定）

创建节点时可以声明该节点预期输出的数据，形成"上游产出什么、下游消费什么"的明确契约。

### 声明输出约定

```javascript
create_plan_node(
  root,
  "获取文档",
  "读取目标文档内容",
  undefined, // traits
  ["docContent", "docMetadata"], // outputs: 输出的 key 列表
  "文档内容（字符串）和元数据（对象）" // outputDescription: 输出描述
);
```

### 完成时输出数据

使用 `finish_plan_node(summary, artifacts)` 将数据传递给父节点：

```javascript
finish_plan_node("获取成功", {
  docContent: "文档的完整内容...",
  docMetadata: { title: "...", author: "..." }
});
```

### 数据如何传递

- 节点完成时，`artifacts` 会合并到**父节点**的 `locals` 中
- 下游节点可以通过 `local.key` 访问这些数据
- 上游已完成节点的 `outputs` 和 `artifacts` 会在 Context 的 process 区域显示

### 示例：完整的数据流

```javascript
// 步骤1：获取配置
const configNode = create_plan_node(
  root,
  "读取配置",
  undefined,
  undefined,
  ["config"],
  "项目配置对象"
);

// 步骤2：使用配置
const processNode = create_plan_node(
  root,
  "处理文件",
  "根据配置处理文件"
);

// 步骤1 完成后输出
finish_plan_node("配置读取成功", {
  config: { path: "/tmp/data", format: "json" }
});

// 步骤2 开始后，可以通过 local.config 访问
// local.config.path === "/tmp/data"
// local.config.format === "json"
```

### finish_plan_node(summary)

完成当前步骤，focus 自动推进到下一个待办节点：

```javascript
finish_plan_node("从 3 个来源收集了关键数据");
```

## 栈帧语义 API

### add_stack_frame(parentId, title, description?, traits?, outputs?, outputDescription?)

压栈 — 快速创建子帧（createPlan 的轻量版）：

```javascript
const frameId = add_stack_frame(
  currentNodeId,
  "子任务",
  "子任务描述",
  undefined,                          // traits
  ["result"],                          // outputs: 输出约定
  "子任务的结果数据"                    // outputDescription
);
```

### stack_return(summary?, artifacts?)

弹栈 — 完成当前帧，返回数据给父帧：

```javascript
stack_return("子任务完成", {
  result: { key: "value" }
});
```

### 其他 API

| API | 作用 |
|-----|------|
| `go(nodeId)` | 跳转到指定节点 |
| `compress(actionIds)` | 折叠多条 actions 为摘要 |

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
