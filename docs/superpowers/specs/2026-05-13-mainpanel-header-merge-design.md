# MainPanel Header Merge Design

**Goal:** 将 `MainPanel` 顶部的 `content-tabs` 信息并入 `breadcrumb-bar`，保留原有展示语义，同时移除重复的第二行标题区。

## Scope

- 仅修改 `web/src/app/layout/MainPanel.tsx`。
- 不改动 `FileViewer`、`WelcomePage` 主体内容和后端交互。
- 仅做顶栏结构合并，不新增交互逻辑。

## Behavior

- `breadcrumb-bar` 继续作为主面板唯一顶栏。
- 左侧继续显示完整 breadcrumb：
  - welcome 态显示 `flows › welcome`
  - 文件态显示完整路径
  - 空路径时保留默认回退文本
- 右侧合并展示原 `content-tabs` 的信息：
  - 主标题：`Welcome`、末级文件名或 `OOC World`
  - `loading` pill
  - `codemirror` pill
  - `backend offline` 提示
  - 刷新符号 `↻`

## Layout

- 删除独立的 `content-tabs` 行，避免两层顶部栏造成信息重复。
- 合并后的右侧信息按单行横向排列，保持原条件渲染语义不变。
- 主体内容区 `main-body` 不变。

## Files

- Modify: `web/src/app/layout/MainPanel.tsx`

## Risks

- 顶栏内容合并后需要注意欢迎态、无路径态、离线态的文案回退不变。
- 如果 `content-tabs` 样式未来被其他区域复用，再单独清理样式；本次先只收敛结构变更。
