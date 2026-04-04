---
namespace: kernel
name: computable/multi_thread
type: how_to_use_tool
when: never
description: 多线程 API — 创建/切换线程、信号通信、fork/join
deps: ["kernel/computable"]
---

# 多线程 API

一个对象可以拥有多条执行线程，每条线程有独立的认知栈和 focus。线程之间通过信号通信。

## API 列表

### `create_thread(name, focusId?)`
创建新线程。`name` 为线程名称，`focusId` 可选指定初始 focus 节点。

```javascript
create_thread("research", "node_research_1");
```

### `go_thread(threadName, nodeId?)`
切换到目标线程。`nodeId` 可选，切换后同时移动 focus。

```javascript
go_thread("research");
// 或切换并移动 focus
go_thread("research", "node_analysis");
```

### `send_signal(toThread, content)`
向目标线程发送信号（异步，不阻塞当前线程）。

```javascript
send_signal("research", "请搜索 AI 安全相关论文");
```

### `ack_signal(signalId, memo?)`
确认收到信号，可附带备注。

```javascript
ack_signal("sig_001", "已完成搜索，找到 5 篇论文");
```

### `fork_threads([{name, focusId?}, ...])`
一次性创建多个子线程并 fork 执行。

```javascript
fork_threads([
  { name: "research_1", focusId: "node_search_1" },
  { name: "research_2", focusId: "node_search_2" },
]);
// 之后主线程会等待所有 fork 的子线程完成
```

### `join_threads()`
等待所有 fork 的子线程完成。

```javascript
const results = join_threads();
// results 包含各子线程的产出
```

### `finish_thread()`
结束当前线程。

```javascript
finish_thread();
```

## 使用模式

### 并行研究

```javascript
// 主线程：创建并 fork 多个研究线程
fork_threads([
  { name: "paper_search", focusId: "node_papers" },
  { name: "code_search", focusId: "node_code" },
]);

// 子线程各自独立执行...
// 主线程 join 等待结果
const results = join_threads();
```

### 线程间通信

```javascript
// 线程 A：发送请求
send_signal("data_processor", { type: "analyze", data: rawData });

// 线程 B：接收并处理
// 信号到达时会触发对应线程的思考循环
ack_signal("sig_001", { result: processedData });
```

## 注意事项

1. 每条线程有独立的认知栈，local 变量不共享
2. 线程间只能通过信号通信，不能直接访问对方的变量
3. `fork_threads` 后主线程会阻塞直到 `join_threads` 或子线程全部完成
4. 线程名在同一个对象内必须唯一
