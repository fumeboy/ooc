# User Home 重设计 — Session Threads 索引 + 关系可见

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-26
**性质**：design 草稿（user 拍板后实施）
**触发**：user 指出当前 user home 只显示 user.root 的 talk_windows，看不到 session 内其它 threads / 跨 thread 关系

---

## 1. 问题陈述

### 1.1 当前 user home 形态（Round 7 A3 之后）
```
+----------+--------------------+
| Chats +  |  SelectionDetail   |
|  · sup   |   ChatPanel        |
|  · alice |   (peer thread)    |
+----------+--------------------+
```
- 只展示 `user.root.contextWindows` 中的 `talk_window`
- 用户视角："我和哪些 peer 聊"
- **缺失**：
  - 看不到 peer threads 派生的 sub-threads（do fork）
  - 看不到跨 thread 协作（plan_window share / window 转移）
  - 看不到 session 内 thread 的 status / 时间维度
  - 看不到 super flow thread（reflectable）

### 1.2 用户视角的真实信息需求
- "这个 session 里有几个 object 在工作？"
- "supervisor 跑了几个子任务？哪个还在 running？"
- "feedback-tracker 拿了我的什么 plan？现在改成啥样了？"
- "这个 thread 是谁创建的、为什么创建？"

当前 UI 无一回答。

---

## 2. 设计目标

User home 重定位为：**session 内 threads 的索引目录 + 关系可见**

- **session 视角**（不是 user 视角）：枚举 session 内所有 (object, thread) 二元组
- **关系可见**：threads 之间的 3 种关系一眼可见
- **保留发消息能力**：选中 user.root 的 talk_window 时仍能发消息（不能让现有交互断）

### 2.1 关系分类（OOC 已有概念）

| 关系 | 数据源 | 表达形态 |
|---|---|---|
| **creator** (do fork 子线程) | thread.parentThreadId / childThreadIds | 树形缩进 |
| **talk** (跨 object callee) | talk_window.target / targetThreadId | 跨栏箭头 / hover link |
| **share** (window 转移) | window.sharing.kind="ref"/"lent_out" | thread 卡片上 chip + 点开看共享详情 |
| **reflectable** (super flow) | objectId=self, sessionId="super" | 折叠区域单独列 |

---

## 3. 视图形态选型

### 选 A：多 Object 分栏 + 栏内 threadTree ✓ **推荐**

```
┌─────────────┬──────────────────┬──────────────────┐
│ user        │ supervisor       │ feedback-tracker │
│             │                  │                  │
│ ●root  (●)  │ ●root  (●)       │ root             │
│  ├ talk:sup │  ├ do:plan1 (◐)  │  (no threads)    │
│  └ talk:fb  │  │  └ do:sub1 ✓  │                  │
│             │  └ talk:user (●) │                  │
│             │                  │                  │
│             │ ─── super flow ─ │                  │
│             │ ⬢ super (○)      │                  │
└─────────────┴──────────────────┴──────────────────┘
```

每个 object 一栏（panel）；栏内 threads 按 threadTree 排序：
- root threads 在上
- 子线程按 parent-child 缩进
- 状态色点：● running / ◐ waiting / ✓ done / ✗ failed / ⏸ paused / ○ ephemeral
- 跨 object talk 关系**不画连线**；用 hover tooltip 提示 "talks to: supervisor.t_abc123"
- 点击 thread → 右栏切到对应详情

**优势**：
- 实现成本中等（没有图形 lib）
- multi-object 边界清晰（与 OOC 哲学一致）
- 树形表达 do fork 自然

**劣势**：
- 跨 object talk 关系靠 hover/click 联动，不是视觉直观
- object 多时（>5）横向滚动

### 选 B：图形视图（节点 + 边）

```
            user.root
            /        \
       talk         talk
        ↓            ↓
   supervisor.root  feedback-tracker.root
    ├ do.sub1 (◐)
    └ do.sub2 ─ share plan ─→ feedback-tracker.do_subthread
```

**优势**：所有关系视觉化、最直观
**劣势**：实现成本高（需要图布局算法或引入库如 reactflow）；threads 多时杂乱

### 选 C：扁平时间轴 + 关系列

```
| createdAt | object | thread | status | parent | shares |
|-----------|--------|--------|--------|--------|--------|
| 12:03     | user   | root   | ●      | -      | -      |
| 12:04     | super  | root   | ●      | -      | -      |
| 12:05     | sup    | plan1  | ◐      | sup.r  | plan→fb|
| ...       |        |        |        |        |        |
```

**优势**：信息密度高、可排序
**劣势**：失去层次感、关系列表难一眼看

### 选定：**A + B 的折中** — 分栏 + 关系箭头叠加层

- 默认渲染分栏（A）
- 选中某 thread 时高亮该 thread + 视觉**画出与其它 thread 的关系线**（叠加层）
- 不画全图（B 的弊端），仅"选中 thread 的关系"

这是最佳平衡：分栏给布局，按需画线给关系。

---

## 4. 数据需求

### 4.1 后端 API 增量

**现状**：`GET /api/flows/:sessionId/threads` 返回 `{ items: [{ objectId, threadId }] }`

**需要扩展**：
```ts
type ListThreadsItem = {
  objectId: string;
  threadId: string;
  status: ThreadStatus;  // running / waiting / done / failed / paused
  createdAt?: number;    // 从 thread.json 读
  parentThreadId?: string;
  creatorThreadId?: string;
  creatorObjectId?: string;
  childThreadIds: string[];
  // 关系摘要（不展开 contextWindows 全量，仅必要字段）
  talkPeers: Array<{ targetObjectId: string; targetThreadId?: string; windowId: string }>;
  shares: {
    holding: Array<{ windowId: string; kind: "ref"; ownerObjectId?: string; ownerThreadId?: string }>;
    lentOut: Array<{ windowId: string; borrowerObjectId?: string; borrowerThreadId?: string }>;
  };
  isSuperFlow?: boolean;  // sessionId === "super" 或 thread 属 super flow
};
type ListThreadsResponse = { items: ListThreadsItem[] };
```

实现：service.listThreads 改造，**对每个 thread 调 readThread 拿到完整 ThreadContext**，提取上述字段。

**性能考量**：
- 一个 session 内 threads 数预估 < 50
- 每个 thread.json 读一次（一次 listing 50 次 fs.read）
- 可接受；不必加缓存

**退化处理**：
- thread.json 损坏 / ENOENT → 该条 status="failed"，其它字段 undefined，**不抛错**
- 不包含 super flow 的 threads（super 是另一个 sessionId）—— 除非 user 显式访问 super session

### 4.2 web 端类型镜像

`web/src/domains/sessions/types.ts` 或同 location 加 `ListThreadsItem` 镜像类型；与 LoopMeta 一样 web 端复声明（避免跨 src 边界 import）。

---

## 5. 前端组件分解

### 5.1 新增组件
```
web/src/domains/sessions/components/
├── SessionThreadsIndex.tsx       ← 主组件（替换 UserThreadHome 主体）
├── ObjectColumn.tsx               ← 单 object 分栏
├── ThreadNode.tsx                 ← 单 thread 节点（树形项）
├── ThreadInspectDetail.tsx        ← 右栏 — 非 chat thread 的只读检查面板
├── RelationOverlay.tsx            ← 选中 thread 时的关系叠加层（绘制连线）
├── SessionThreadsIndex.test.ts
└── ObjectColumn.test.ts
```

### 5.2 保留组件
- `UserThreadHome.tsx` → 保留外壳，内部主体替换为 `SessionThreadsIndex`
- 右栏选中 user.root 的 talk_window 时仍渲染 `ChatPanel`（继续聊天能力不破坏）
- `SelectionDetail` 改造：根据选中 kind 路由到 `ChatPanel`（talk_window）/ `ThreadInspectDetail`（其它 thread）

### 5.3 选中 / URL 状态

复用现有 routing `?selected=chat:<wid>` 协议，扩展：
```
?selected=chat:<wid>          ← user.root 的 talk_window（现有）
?selected=thread:<obj>:<tid>  ← 任意 (object, thread) 二元组（新）
```

routing.ts 加新 `selected.kind="thread"` variant + parser/serializer。

### 5.4 关系叠加层（RelationOverlay）

选中某 thread 后：
- 找该 thread 的所有关系（creator / parent / talk peers / share peers）
- 用 SVG overlay 在分栏上画连线（虚线 = ref share，实线箭头 = creator/talk）
- 简单实现：每个 ThreadNode 在 DOM 上有 `data-thread-id`，overlay 用 getBoundingClientRect 算出位置画 line

如果实现成本过高，**MVP 跳过叠加层**，仅用 hover tooltip + 高亮节点。可作为 phase 2 增强。

---

## 6. 视觉细节

### 6.1 Object 栏头部
```
[icon] supervisor    [active: 2 / done: 1]
```
- displayName 派生（visible.display_name_from_self_md）
- 计数胶囊：active / done / paused 各几个 thread

### 6.2 Thread 节点
```
●root      ← 状态色点 + thread 标识
↳ do:plan1   ← 缩进 + creator chain
   ↳ do:sub1
↳ talk:user  ← talk thread (跨 object 关系暗示)
```

属性：
- thread title 派生：optional thread.title 或 humanizeThreadId(threadId, createdAt, kind)
- 状态色点
- 鼠标 hover → 显示 createdAt / parent / 持有/借出的 windows 数

### 6.3 选中 thread 的右栏
```
+----------------------------------+
| supervisor / t_abc123 (do.plan1) |
| ────────────────────────────────  |
| Status: ◐ waiting                |
| Created: 12:04:23                 |
| Created by: supervisor.root      |
| Parent thread: t_root             |
|                                  |
| Plan windows (1):                |
|  - PW1 "重构 thinkable" lent to:  |
|    feedback-tracker.t_xyz789      |
|                                  |
| Recent events: ...               |
| [Loop Timeline] [Context Snapshot]|
+----------------------------------+
```

如果选中的 thread 是 user.root 的 talk_window → 右栏渲染原有 ChatPanel（保持现有发消息流程）。

---

## 7. 不变量

- **不破坏现有发消息流程**：选中 user.root 的 talk_window 时 ChatPanel 完全保留（含 H-3 修复 / composer 等）
- **不引入新协议**：sharing / talk / do 关系全部从 OOC 现有数据派生
- **session 边界严格**：只显示 sessionId 对应 session 内的 threads；super flow 独立 session
- **不修改 thread 数据**：纯只读视图
- **lazy fetch**：选中某 thread 时才 fetch 详细 events / contextWindows；列表只用 listThreads metadata

---

## 8. 实施分阶段

| Phase | 工作量 | 范围 | 派单 |
|---|---|---|---|
| **D1** | 小 | meta 加 `visible.children.session_threads_index` 子节点 + warnings 标"current user home 仅 chat list, 即将重构" | Supervisor 直写 + tsc clean |
| **D2** | 中 | 后端 service.listThreads 扩展返回 metadata；route-audit 同步加 schema 断言 | AgentOfCollaborable + AgentOfPersistable |
| **D3** | 中-大 | 前端 SessionThreadsIndex + ObjectColumn + ThreadNode + ThreadInspectDetail + routing 扩展（thread: selected variant）+ 单测 | AgentOfVisible |
| **D4** | 小 | RelationOverlay 叠加层（MVP 选做；时间不够留 phase 2）| AgentOfVisible |
| **D5** | 小 | UserThreadHome 内部替换 + ChatPanel 保留路径 + 视觉验证 | AgentOfVisible |

D2 与 D3 文件域不重叠，可并行。

D4 是增强可选项；如果 D3 完成后视觉够用，D4 留下一轮。

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 多 object 分栏在 object 多时横向滚动 | object 数 ≤4 时全展示；>4 时折叠次要 object（按 thread 数排序，少的折叠） |
| listThreads 性能（50 thread.read）| 50 次本地 fs.read 合计 <100ms；可接受。若未来 thread 多用 streaming/分页 |
| RelationOverlay SVG 绘制成本 | MVP 跳过；先用 hover tooltip + thread 节点高亮 |
| user 选中非 user.root 的 thread 后想"发消息"会失望 | ThreadInspectDetail 显式说明"该 thread 只读检查；要操作请去 LoopTimeline 跑 permission approve / 或换到对端 object 的 user 视角" |
| 跨 object talk 关系不画线 → 用户不知道 sup.root 跟 user 在聊 | hover tooltip + 关系叠加层兜底 |
| 选中 talk_window vs 选中 callee thread 的差异 | 分清两个 selected variant：`chat:<wid>` 是 user 视角的 talk_window；`thread:<obj>:<tid>` 是 callee 视角的 thread 自身 |

---

## 10. 不在本轮做的事（明确范围）

- 编辑 thread（删除 / rename / 强制 abort）—— 纯只读
- thread 时间轴 / scroll-to-time
- 跨 session threads 比较
- 拖拽重排 / 自定义 object 顺序
- thread 评论 / 标签 / 自定义元数据
- 真 LLM e2e（机制级 e2e 即可）

---

## 11. 与 Round 1-7 的接口

- **接 P0-2（context budget）**：thread 节点上可显示 thread 是否触发过 compress
- **接 P0-1（permission）**：thread 节点上可显示 pending permission_ask 数（提示"有审批待处理"）
- **接 P1-3（loop timeline）**：右栏 ThreadInspectDetail 集成 LoopTimeline tab（已有）
- **接 plan_window**：thread 节点上显示 plan window count + share 状态
- 不动 P0-1 / P0-2 / P1-3 任一组件

---

## 12. 验收

最终交付要满足：
1. 进入任一 session（含 demo session）→ 看到所有 object 分栏 + thread 树
2. 状态色点正确（与 thread.status 一致）
3. 选中 user.root 的 talk_window → 仍是原 ChatPanel 体验（不退化）
4. 选中其它 thread → ThreadInspectDetail 显示 status / created / parent / shares
5. hover thread 节点 → tooltip 含详细信息
6. URL `?selected=thread:<obj>:<tid>` 刷新可保留
7. listThreads API 返回扩展 metadata；单测 + route-audit 覆盖
8. 现有 H-3 "去 welcome" 按钮在空 session 仍正常
9. ChatList 入口（user.root 视角的 quick chat list）作为一种 view 仍可访问（可选：加 toggle "session view ↔ chat view"）

---

## 13. 待用户拍板

1. **视图形态**：选 A（分栏）+ MVP 跳 D4 RelationOverlay / 还是 A+D4 一次到位？
2. **ChatList 入口保留方式**：完全替换（user home = SessionThreadsIndex 全部）/ 还是加 toggle（默认 SessionThreadsIndex，可切到 ChatList）？
3. **本轮直接实施 D1-D5 全套**还是只交付 design 等下一轮拍板？
4. **关系叠加层（D4）**：MVP 跳过 / MVP 必做？

---

## 历史

- **2026-05-26**：首版。Round 8 design 草稿。
