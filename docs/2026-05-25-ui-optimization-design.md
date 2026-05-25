# UI Optimization Design (2026-05-25, visible AgentOfX)

派单来源：Supervisor — 三个 UI 优化 (Task A/B/C)。

## 摸底结论

| 已存在 | 状态 |
|---|---|
| `ContextSnapshotViewer` 各 window type 详情面板 | 基本完整（root / command_exec / do / talk / todo / program / file / knowledge / search / relation 都有分支渲染）。 |
| `IssueDetailView` GitHub 风格元素 | 已有 StatusBadge / AuthorChip / TimeChip / comments timeline。**缺**：comment 输入框、close issue 按钮。 |
| `MarkdownContent` | react-markdown + remark-gfm，可直接复用。 |
| `FileWindowContentView` (file window 内容预览) | md 走 MarkdownContent，其余走 CodeMirror（无 json tree / csv table / 图片）。 |
| Issue list | 仅 sidebar tree 内合成节点（B5）；**没有**独立列表页。 |
| User thread 默认页 | `activeObjectId === "user"` 时走 FileViewer → ContextSnapshotViewer（整棵 context tree）；**没有** talk-first home。 |

## 实施范围（按优先级）

### Task A：file window 按 mime/ext 分发

修改 `FileWindowContentView.tsx`，加 4 个分支：
- `.md` / `.markdown` → MarkdownContent（已有）
- `.json` → `<JsonTreeView>`（新增，折叠 recursive）
- `.csv` / `.tsv` → `<CsvTableView>`（新增，sticky header）
- `.png` / `.jpg` / `.jpeg` / `.gif` / `.svg` / `.webp` → `<ImagePreview>`（新增，`/api/file/read` 返回 content base64？— 检查；否则直接用 `<img src="/api/file/read?path=...">`）
- 其它 → 现有 CodeMirror

JsonTreeView：纯本地递归组件，~80 LOC；按 type 标色（string=绿、number=蓝、bool=紫、null=灰、object/array=折叠）。

CsvTableView：手写 parser（处理 quoted "..."），生成 `<table>`，第一行作 sticky header；超过 200 行折叠 + "show all" 按钮。

ImagePreview：fetch metadata（size），然后用 `<img>` + alt + 尺寸标签。

### Task B：user thread 默认页 = talk + issues

新增 `web/src/domains/sessions/components/UserThreadHome.tsx`：

```
+---------------------------------------------+
| header: "User session <sessionId>"  [toggle] |
+----------------------+----------------------+
| Talk timeline (LHS)  | Issues (RHS, 280px)  |
|                      |                      |
| 各 talk_window:      | #1 title (open)      |
|   - peer chip        | #2 title (closed)    |
|   - last N messages  | ...                  |
|   - "view thread"    | [View all issues →]  |
|                      |                      |
+----------------------+----------------------+
```

- header 右上一个 "advanced view" 按钮，切回 ContextSnapshotViewer。状态用 useState（不进 URL，刷新回归默认）。
- Talk timeline：扫 `thread.contextWindows` 取 type=talk 的窗口；每个 window 渲染一个 card，card 内列 transcript（fromObjectId · 前 80 char）；card footer "Continue chat" 按钮 → navigate 到对端 thread 视图。
- Issues 列表：复用 `useIssues(sessionId)`，渲染前 8 条 + "View all" link → `/flows/:sid/issues`。

集成点：`MainPanel.tsx` —— 当 `route.kind === "session" && route.objectId === undefined or === "user"` 且非 file 路径时，渲染 UserThreadHome 替代 FileViewer。

### Task C：Issue list 页 + GitHub 风格

新增 `web/src/domains/issues/components/IssueListView.tsx`：

```
+---------------------------------------------+
| [🔍 Search issues...]   [Open|Closed|All]   |
+---------------------------------------------+
| ● #42 Title here                    8h ago  |
|    opened by alice · 3 comments             |
| ○ #41 Another title                 1d ago  |
|    opened by bob (closed) · 0 comments      |
+---------------------------------------------+
```

- 行视觉：左 status icon（绿圆 open / 紫圆 closed）；标题 14px / 600；副标题 11px muted。
- 搜索：本地 `.filter(i => i.title.includes(q) || String(i.id) === q)`，无 debounce 必要。
- 排序：updated_desc 默认。

路由：增 `/flows/:sessionId/issues` → RouteState 新增 `kind: "issueList"`，sidebar tree issues 节点 click 顶层 → 跳到该路由（而不是只能点 child）。但这会改动 sidebar 交互——**降级方案**：保留现有侧栏交互，issue list 通过 IssueDetailView 头部加 "← All issues" 按钮回到列表（或 breadcrumb segment）。

最终采用：**新增路由 `/flows/:sid/issues`**，加 RouteState `kind: "issueList"`，breadcrumb 在 issueDetail / issueList 之间互链。Sidebar issues tree node 维持现状。

IssueDetailView 增量：底部加 "Add a comment" 区域：
- textarea + Markdown preview tab
- "Comment" button (POST `/api/flows/:sid/issues/:id/comments` body `{ text, authorObjectId: "user", mentions: [] }`)
- "Close issue" button（POST `/flows/:sid/issues/:id/close`，仅 open 状态显示）；closed 状态显示 "Reopen"（API: POST `.../reopen` 若存在，否则隐藏）。

## 不做（明确裁剪）

- `@mention` 高亮跳转 talk window —— 现版本 IssueDetailView 已通过 markdown 渲染，token 跳转不在本轮 scope。
- Issue list 的 "has-mention / author" filter —— 仅做 status filter + text search。
- Avatar 头像 —— 用 displayName chip + 圆点（已有的 AuthorChip）。
- 修 `relation` window UI — 当前已经合理。
- 新引入 framework / dep — 全部用现有 react-markdown / lucide-react / CodeMirror。

## 验证

- `bun tsc --noEmit` 不新增 src/ 错误。
- `bun test src/` 仍 548 pass。
- 浏览器 e2e (HTML 抓取)：
  1. 启 backend (port 7891) + vite (5174)
  2. 创 session → 进入 user.root，应见 UserThreadHome
  3. /flows/<sid>/issues 应见 list 页
  4. file window 加 md / json / csv 测试件，分发渲染
