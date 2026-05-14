# MainPanel Header Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `MainPanel` 的第二行 `content-tabs` 合并进第一行 `breadcrumb-bar`，形成单行顶栏并保留所有现有状态提示。

**Architecture:** 采用单文件最小改动方案，在 `MainPanel.tsx` 中重组顶栏 JSX。左侧保留 breadcrumb，右侧引入原标题与状态标签，再删除独立的 `content-tabs` 容器。主体内容区与欢迎页逻辑不变。

**Tech Stack:** React, TypeScript, JSX, 现有全局样式类

---

### Task 1: 重组 MainPanel 顶栏

**Files:**
- Modify: `web/src/app/layout/MainPanel.tsx`

- [ ] **Step 1: 读取当前文件并确认需要保留的条件渲染**

关注以下 JSX 片段：

```tsx
<div className="breadcrumb-bar min-h-8 max-h-8 panel">
  <span>{isWelcome ? "flows › welcome" : path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span>
  <span className="refresh">↻</span>
</div>
<div className="content-tabs">
  <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
  {loading && <span className="pill">loading</span>}
  {!isWelcome && editableFile && <span className="pill">codemirror</span>}
  {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
</div>
```

- [ ] **Step 2: 将第二行内容并入第一行右侧容器**

目标结构：

```tsx
<div className="breadcrumb-bar min-h-8 max-h-8 panel">
  <span>{isWelcome ? "flows › welcome" : path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span>
  <div className="flex items-center gap-3">
    <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
    {loading && <span className="pill">loading</span>}
    {!isWelcome && editableFile && <span className="pill">codemirror</span>}
    {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
    <span className="refresh">↻</span>
  </div>
</div>
```

- [ ] **Step 3: 删除独立的 `content-tabs` 容器**

删除以下代码：

```tsx
<div className="content-tabs">
  <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
  {loading && <span className="pill">loading</span>}
  {!isWelcome && editableFile && <span className="pill">codemirror</span>}
  {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
</div>
```

- [ ] **Step 4: 运行诊断检查**

Run: 使用编辑器诊断检查 `web/src/app/layout/MainPanel.tsx`  
Expected: 无 TypeScript / JSX 诊断错误

- [ ] **Step 5: 手动确认行为**

检查点：

```text
1. welcome 态左侧仍显示 flows › welcome，右侧显示 Welcome
2. 文件态左侧仍显示完整路径，右侧显示末级文件名
3. loading / codemirror / backend offline 条件显示不变
4. 页面顶部只保留一行标题栏
```
