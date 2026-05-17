# Web Sidebar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新 `web/` 的 sidebar 行为和旧版 `sidebarContent/SessionBar` 对齐：`flows` 下 session list/create session 与 filetree 互斥显示，tabs 视觉回到旧版风格，三栏固定视口高度并在各自容器内滚动。

**Architecture:** 在前端 `AppShell` 中引入最小的 sidebar UI 状态 `showSessions`，只驱动 `flows` tab 的左栏展示；`Sidebar` 负责渲染旧版风格 tabs、`SessionBar` 和互斥内容区；`AppLayout/styles.css` 负责把 Logo 固定、滚动区域下沉到 Logo 下方，并保证左中右三栏固定视口高度。

**Tech Stack:** React, TypeScript, Vite, plain CSS, current `web/` domain queries.

---

## File Structure

### Modify

- `web/src/app/shell.tsx` - 增加 `showSessions` 状态，并把它与 `activeSessionId`/scope 切换联动。
- `web/src/app/layout/Sidebar.tsx` - 迁移旧版 `SessionBar` 行为，按 scope 和 `showSessions` 互斥渲染 session list/create session/filetree。
- `web/src/app/layout/AppLayout.tsx` - 给三栏布局添加稳定容器 class，便于固定高度和滚动。
- `web/src/styles.css` - 调整 tabs、sidebar 滚动分区、三栏固定高度与内部滚动。

---

### Task 1: 恢复 flows 左栏互斥逻辑

**Files:**
- Modify: `web/src/app/shell.tsx`
- Modify: `web/src/app/layout/Sidebar.tsx`

- [ ] **Step 1: 在 shell 中加入 sidebar 展示态**

在 `AppShell` 增加：

```ts
const [showSessions, setShowSessions] = useState(true);
```

并在 `scope` / `activeSessionId` 变化时同步：

```ts
useEffect(() => {
  if (state.scope !== "flows") return;
  setShowSessions(!state.activeSessionId);
}, [state.scope, state.activeSessionId]);
```

- [ ] **Step 2: 把 sidebar 状态透传给 Sidebar**

把 `showSessions` 和 `onToggleSessions` 传给 `Sidebar`：

```tsx
<Sidebar
  ...
  showSessions={showSessions}
  onToggleSessions={() => setShowSessions((prev) => !prev)}
/>
```

- [ ] **Step 3: 在 Sidebar 中按 scope 组织三个分支**

让 `Sidebar` 拆成：

```tsx
if (scope === "flows") {
  return (
    <>
      <SessionBar ... />
      {showSessions ? <FlowSessionsPane ... /> : <FlowTreePane ... />}
    </>
  );
}

if (scope === "stones") {
  return <StoneTreePane ... />;
}

return <WorldTreePane ... />;
```

- [ ] **Step 4: 只在 flows + showSessions 时显示 create session**

把 `SessionCreator` 放进 `showSessions` 分支，不再常驻显示。

- [ ] **Step 5: 运行 web build**

Run: `cd web && bun run build`

Expected: build passes.

---

### Task 2: 迁移旧版 SessionBar 和 tabs 视觉

**Files:**
- Modify: `web/src/app/layout/Sidebar.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: 在 Sidebar 中新增 SessionBar 组件**

新增一个最小版 `SessionBar`：

```tsx
function SessionBar({
  title,
  showSessions,
  onToggle,
}: {
  title: string;
  showSessions: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="session-bar">
      <button className="session-bar-icon" onClick={onToggle}>
        <List size={14} />
      </button>
      <button className="session-bar-title" onClick={onToggle}>
        {title || "Untitled session"}
      </button>
      <button className="session-bar-icon" onClick={onToggle}>
        <ChevronDown className={showSessions ? "rotated" : ""} size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: tabs 样式向旧版胶囊结构靠拢**

在 `styles.css` 中把 `.tabs` / `.tab` 调整为：

```css
.tabs {
  display: flex;
  align-items: center;
  background: var(--accent);
  border-radius: 999px;
  padding: 2px;
}

.tab {
  flex: 1;
  border: 0;
  border-radius: 999px;
  background: transparent;
}

.tab.active {
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 3: 添加 SessionBar 相关样式**

在 `styles.css` 中新增：

```css
.session-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px;
  padding: 0;
  border-radius: 10px;
  background: rgba(232, 235, 228, 0.7);
}
```

并补齐 title、icon、chevron 旋转样式。

- [ ] **Step 4: 运行 web build**

Run: `cd web && bun run build`

Expected: build passes and no CSS syntax error.

---

### Task 3: 固定三栏高度并收口滚动区域

**Files:**
- Modify: `web/src/app/layout/AppLayout.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: 给 layout 增加稳定 class**

将 `AppLayout` 改成：

```tsx
export function AppLayout(...) {
  return (
    <div className="app-shell">
      <div className="app-layout app-layout-fixed">
        {sidebar}
        {main}
        {right}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 让 app-shell / app-layout 固定到视口**

在 `styles.css` 中调整：

```css
.app-shell {
  height: 100vh;
  padding: 8px;
  overflow: hidden;
}

.app-layout-fixed {
  height: calc(100vh - 16px);
  min-height: 0;
}
```

- [ ] **Step 3: 让 sidebar 的 Logo 固定，内容区滚动**

把 sidebar 拆成固定头部 + 可滚动主体：

```css
.sidebar {
  min-height: 0;
  overflow: hidden;
}

.sidebar-brand {
  flex: 0 0 auto;
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
```

- [ ] **Step 4: 主面板和右面板保持内部滚动**

确认并补齐：

```css
.main-panel,
.right-panel {
  min-height: 0;
  overflow: hidden;
}

.main-body,
.right-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
```

- [ ] **Step 5: 运行 web build**

Run: `cd web && bun run build`

Expected: build passes.

---

### Task 4: 回归验证布局与链路

**Files:**
- Modify: none

- [ ] **Step 1: 启动 server**

Run: `bun src/app/server/index.ts --world./.ooc-world-test`

Expected: server listens on `:3000`.

- [ ] **Step 2: 启动 web**

Run: `cd web && OOC_API_TARGET=http://127.0.0.1:3000 bun run dev --host 127.0.0.1 --port 5173`

Expected: Vite listens on `http://127.0.0.1:5173/`.

- [ ] **Step 3: 人工/自动验证 flows 左栏切换**

检查：

```text
1. 初始 flows 态显示 sessions + create session
2. 选择 session 后显示 SessionBar + filetree
3. 点击 SessionBar 可切回 sessions 列表
```

- [ ] **Step 4: 验证 stones/world 不显示 session list**

检查：

```text
1. stones 仅显示 tree + create object 入口
2. world 仅显示 tree
```

- [ ] **Step 5: 验证三栏滚动**

检查：

```text
1. Logo 固定在左栏顶部
2. 左栏内容滚动时 Logo 不动
3. 中间和右侧内容超长时在各自区域滚动
```

---

## Self-Review

- Spec coverage: 覆盖了 flows 左栏互斥、tabs 对齐旧版、固定视口高度与内部滚动三个需求。
- Placeholder scan: 无 TBD/TODO；每个任务都给出了目标文件和验证命令。
- Type consistency: `showSessions`、`SessionBar`、`onToggleSessions` 命名在任务内保持一致。
