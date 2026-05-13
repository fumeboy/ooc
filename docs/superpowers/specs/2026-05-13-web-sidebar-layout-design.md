# Web Sidebar Layout Design

**Goal:** 让新 `web/` 的左栏行为对齐旧版 `App.tsx` 的 `sidebarContent/SessionBar`：`flows` 下的 session list 与 filetree 互斥显示，tabs 视觉对齐旧版，左中右三栏固定到视口高度并各自滚动。

## Scope

- 仅调整 `web/` 的布局与展示逻辑，不改后端 API。
- 仅迁移旧版 `SessionBar` 的核心行为，不迁移 Jotai、hash router、SSE、Kanban 等旧机制。
- `create session` 表单只在 `flows` tab 且未进入 session filetree 时显示。

## Behavior

### Flows Sidebar

- 当 `activeSessionId` 为空时，左栏显示：
  - tabs
  - session list
  - create session form
  - heatmap/底部装饰区（可保留当前简化版）
- 当 `activeSessionId` 非空时，左栏显示：
  - tabs
  - `SessionBar`
  - session filetree
- `SessionBar` 提供单一切换入口：
  - `showSessions = true` 时展示 session list + create session
  - `showSessions = false` 时展示 filetree
- 初始进入已选 session 时默认展示 filetree。

### Stones / World Sidebar

- 不显示 session list 和 create session。
- 保持 tree-only 结构。
- `stones` 仍保留 create object / create knowledge 入口。

## Layout

- 整页采用固定视口高度布局。
- 左中右三栏容器高度固定为网页高度，不随内容撑高。
- 内容超出时在各自容器内部滚动。
- 左栏 Logo 固定在顶部，不参与滚动。
- 左栏仅 Logo 下方区域滚动。

## Visual Alignment

- tabs 采用旧版 `sidebarContent` 的胶囊式切换视觉：
  - 外层共享浅色背景
  - 激活态为内层白底胶囊
  - 未激活态为 muted 文本
- `SessionBar` 采用旧版结构：
  - 左侧 list icon
  - 中间 session title / 占位标题
  - 右侧 chevron

## Files

- Modify: `web/src/app/shell.tsx`
- Modify: `web/src/app/layout/Sidebar.tsx`
- Modify: `web/src/app/layout/AppLayout.tsx`
- Modify: `web/src/styles.css`

## Risks

- 当前 `Sidebar` 是单文件内联 JSX，布局逻辑改动较集中，需避免把 `flows` 的切换逻辑污染到 `stones/world`。
- 需要保证 `showSessions` 与 `activeSessionId` 的关系清晰，避免“已选 session 但仍停在 session list”。
