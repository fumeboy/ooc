# Welcome Session Form Design

## Goal

把 `web/src/app/layout/MainPanel.tsx` 中内联的 Welcome 区拆到同级 `Welcome.tsx`，并为 Welcome 页里的 session 创建表单引入最小可用的 shadcn 风格组件集，在不改变创建逻辑的前提下提升页面结构清晰度与表单观感。

## Current State

- `MainPanel.tsx` 同时承担 header 编排、Welcome 页面、文件查看三类职责。
- Welcome 区通过内联样式直接渲染标题、说明和 session 创建块。
- `SessionCreator.tsx` 使用原生 `input / select / textarea` 与现有 `Button`，功能可用但视觉层次较弱。
- 项目已有 `class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 等依赖，但没有完整 shadcn CLI 生成层。

## Design

### 1. Structure Split

- 从 `web/src/app/layout/MainPanel.tsx` 拆出 `web/src/app/layout/Welcome.tsx`。
- `MainPanel.tsx` 只保留页面骨架与 `isWelcome` 分支编排。
- `Welcome.tsx` 负责：
  - 页面标题与说明文案
  - session 创建卡片布局
  - 调用美化后的 `SessionCreator`

### 2. UI Component Strategy

本次只补齐 Welcome 页面所需的最小 shadcn 风格组件集，统一放在 `web/src/shared/ui/`：

- `button.tsx`：升级现有按钮，支持 variant / size
- `card.tsx`
- `input.tsx`
- `textarea.tsx`
- `label.tsx`
- `select.tsx`

策略是“shadcn-like local primitives”，而不是引入完整脚手架。目标是让 Welcome 表单拿到更清晰的组件边界与视觉层次，同时继续贴合项目当前色板、圆角、阴影与边框系统。

### 3. Welcome Layout

- Welcome 页保持内容居中。
- 页面主体采用单主卡片布局：
  - 顶部：`Welcome` 标题与辅助说明
  - 下方：`Create session` 卡片
- 卡片和字段间距遵循当前 `styles.css` 已有的轻量面板风格，不额外引入厚重营销页样式。

### 4. SessionCreator Refresh

`SessionCreator.tsx` 保持现有业务逻辑不变，仅调整表现层：

- `sessionId` → labeled input
- `objectId` → labeled select
- `initialMessage` → labeled textarea
- create button → 更清晰的 CTA
- 当 `stones.length === 0` 时：
  - 顶部显示更克制的提示信息
  - select 与按钮禁用

### 5. Non-goals

- 不修改 session 创建 API
- 不修改 sidebar / flow 切换逻辑
- 不一次性铺完整 shadcn 组件体系
- 不重构其他页面的表单

## Verification

- Welcome 模式正常渲染
- 非 Welcome 模式文件查看不受影响
- 无 stone / busy / 正常提交三类状态都显示正确
- 通过：
  - `tsc --noEmit -p ./tsconfig.json`
  - `vite build`
