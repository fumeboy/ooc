# Web 前端架构文档

## 样式要求

现代化、扁平化、紧凑、面向开发者、信息密度高、组件化、支持 暗色模式切换、使用透明与模糊进行适当装饰
具体参照 DESIGN_LANGUAGE.md

## 技术栈

- **框架**: React 19.2.1 + TypeScript 5.9.3
- **构建工具**: Vite 7.2.6
- **状态管理**: Jotai 2.15.2
- **样式**: Tailwind CSS 4.1.17
- **HTTP 客户端**: 原生 fetch API
- **图标**: FontAwesome

### 按钮设计规范（全局最新）
- 形态：扁长（垂直 6px / 水平 16px），圆角 10px。
- 字色：浅底深字；`btn-primary` 文本使用 `var(--accent-color)`。
- 背景：`btn-primary` 用浅淡 accent 透明底（~14%），`btn-secondary` 用浅灰透明底 `#bdbdbd17`。
- 边框：默认浅色描边；Hover 无阴影/位移，仅加深边框色（primary 为更浓的 accent，secondary 为更深灰）。

## 实现方案速记（前端）

- 布局：`Background`（灰底）+`Background2`（多彩模糊）+`Container`（半透明暖白主体，左右分栏可拖拽宽度）。
- 主题：CSS 变量支持明/暗主题，统一圆角/阴影/间距符合 DESIGN_LANGUAGE.md。
- 状态切分（Jotai）：
  - `sessionsAtom` / `sessionsLoadingAtom`
  - `selectedSessionIdAtom`
  - `conversationsBySessionAtom` / `conversationDetailsAtom`
  - `infosBySessionAtom` / `selectedInfoBySessionAtom`
  - `manualThink*Atom`：等待手动思考的 LLM 输出与提交态
  - `openConversationTabsAtom`：动态详情 Tab 列表
- 拉取节奏：Session/Conversation/WaitingManualConversations 每 2s 轮询；Info on-demand。
- HTTP 适配：封装 `/api/*` 请求，接口类型与 `internal/server` 中的请求/响应结构保持一一对应。
- TDD：使用 Vitest + Testing Library，先写用例锁定接口与 UI 行为（tab 切换、拉取间隔、表单校验），再补实现。
- 目录文档：`src/README.md` 记录组件/状态/测试计划；本文件索引并追踪进度。

### 进度

- [x] 设计与状态规划
- [ ] 基础 UI 与主题
- [ ] API 适配层与轮询
- [ ] Tabs 与业务组件
- [ ] 单元测试覆盖

---

## 整体布局（当前）

```xml
<App>
  <Main>
    <Header>
      <TabSwitcher tabs=["Conversations","Info 表格"] />
      <SessionListToggle />
    </Header>
    <Content>
      <ConversationsPage />   <!-- index / 等待手动 / 动态详情 tabs -->
      <InfosPage />           <!-- index / 动态 Info 详情 tabs -->
    </Content>
  </Main>
  <SessionListPanel>         <!-- 右侧抽屉，默认隐藏 -->
    <SessionCreator />
    <SessionList />
    <ThemeToggle />
  </SessionListPanel>
</App>
```
背景：双层（灰底 + 彩色模糊）。Container 固定 96vw/96vh，磨砂圆角。Header = TabSwitcher + Session 抽屉按钮。SessionListPanel 右滑出现。

---

## 组件结构（更新）

### 核心布局
- `App.tsx`：主框架 + 右侧 Session 抽屉。
- `Main.tsx`：Header（TabSwitcher + SessionListToggle + 标题徽标）、Content（ConversationsPage / InfosPage）。
- `session/SessionListPanel.tsx`：抽屉式 Session 区域（SessionCreator + SessionList + 主题切换）。

### Conversations
- `conversation/ConversationsPage.tsx`：内部 TabSwitcher（Conversations / 等待手动 / 动态详情）；列表为纵向 `ConversationSummary` 网格（2 列）。
- `conversation/ConversationSummary.tsx`：横/纵布局可选，状态徽章着色，查看详情为放大镜按钮，未答问题高亮“？”。
- `conversation/ConversationDetailTab.tsx`：头部 Tag 一致，引用按需显示。
- `conversation/WaitingManualConversationsTab.tsx`：等待手动列表，附身开关。
- `conversation/ManualThinkResponder.tsx`：左右分栏，Prompt 用 `pre`，工具胶囊，右侧表单提交。
- `conversation/UserTalkForm.tsx`：底部浮动表单，talk_with/引用可搜索选择，iOS glass 风格。

### Infos
- `info/InfosPage.tsx`：@tanstack/react-table v8，列固定/列宽控制，单行截断，水平/垂直分割线，Class 列用 Tag 映射色；内部 TabSwitcher 管理 Index/详情。
- `info/InfoReferenceSelector.tsx`、`info/ReferenceList.tsx`：Info 选择与引用展示。

---

### Tab 组件

#### `UserInfoTab.tsx`
- **功能**: tabs 的首页
- **状态管理**:
  - `conversationsBySessionAtom`: Conversation 列表
  - `conversationsLoadingBySessionAtom`: 加载状态
- **功能**:
  - 显示 Conversation 列表
  - 每 2 秒自动刷新
  - 支持发起新的 Talk
  - 支持查看 Conversation 详情
- **子组件**:
  - `ConversationSummary`: Conversation 摘要卡片
  - `UserTalkForm`: User Talk 表单, 对应后端的 server.Talk.go

#### `ConversationDetailTab.tsx`
- **功能**: Conversation 详情视图
- **状态管理**:
  - `conversationDetailsAtom`: Conversation 详情
  - `conversationDetailsLoadingAtom`: 加载状态
  - `manualThinkMethodByConversationAtom`: 手动思考方法
  - `manualThinkParamsByConversationAtom`: 手动思考参数
  - `submittingManualThinkByConversationAtom`: 是否正在提交
- **功能**:
  - 显示 Conversation 完整信息
  - 每 2 秒自动刷新
  - 支持回复手动思考请求
  - 显示 Questions 和 Activities
- **Props**:
  - `conversationId`: Conversation ID
  - `onClose`: 关闭回调

#### `InfoTableTab.tsx`
- **功能**: Info 表格视图，列出 Info 的 ID\Class\Name\Description
- **状态管理**:
  - `infosBySessionAtom`: Info 列表
  - `infosLoadingBySessionAtom`: 加载状态
  - `selectedInfoBySessionAtom`: 选中的 Info
  - `infoDetailLoadingBySessionAtom`: Info 详情加载状态
- **功能**:
  - 显示 Info 列表
  - 支持查看 Info 详情 (prompt 和 methods)
  - 支持跳转到 Conversation 详情 (如果 Info 类型是 conversation)

#### `WaitingManualConversationsTab.tsx`
- **功能**: 等待手动处理的 Conversation 列表
- **状态管理**:
  - `conversationsBySessionAtom`: Conversation 列表
  - `conversationsLoadingBySessionAtom`: 加载状态
  - `possessedBySessionAtom`: 附身状态
- **功能**:
  - 显示等待手动处理的 Conversation 列表
  - 每 2 秒自动刷新
  - 支持开关切换附身状态
  - 支持查看 Conversation 详情
- **子组件**:
  - `ConversationSummary`: Conversation 摘要卡片

---

### 辅助组件

#### `SessionCreator.tsx`
- **功能**: 创建新 Session 的表单
- **功能**:
  - 输入用户请求
  - 选择是否开启附身
  - 创建 Session

#### `SessionList.tsx`
- **功能**: Session 列表展示
- **Props**:
  - `sessions`: Session 列表
  - `selectedSessionId`: 当前选中的 Session ID
  - `onSelect`: 选择回调
  - `loading`: 加载状态
  - `onRefresh`: 刷新回调
- **功能**:
  - 显示 Session 列表
  - 高亮选中的 Session
  - 支持点击选择 Session
  - 自动去重 (防止重复 key 警告)

#### `ConversationSummary.tsx`
- **功能**: Conversation 摘要卡片
- **Props**:
  - `sessionId`: Session ID
  - `conversation`: Conversation 对象
  - `onViewDetail`: 查看详情回调
  - `onRefresh`: 刷新回调
- **功能**:
  - 显示 Conversation 基本信息
  - 支持点击查看详情
  - 显示状态和更新时间
- 布局
    ```xml
    <ConversationSummary>
        <ConversationSummaryHeader>
            ... 基本信息
            展示“查看详情”按钮
            如果有需要回复的 question，高亮展示 “问题” 按钮，点击后打开回复窗口
        </ConversationSummaryHeader>
        <ConversationSummaryContent>
            <Request>
                展示 conversation 的 request
            </Request>
            <Response>
                展示 conversation 的 response
            </Response>
        </ConversationSummaryContent>
    </ConversationSummary>
    ```

#### `ReferenceList.tsx`
- **功能**: 显示引用列表
- **Props**:
  - `sessionId`: Session ID
  - `references`: 引用对象 (Record<string, string>)
  - `onViewConversation`: 查看 Conversation 回调
- **功能**:
  - 显示引用的 Info 列表
  - 支持点击查看引用的 Conversation

#### `InfoReferenceSelector.tsx`
- **功能**: Info 引用选择器
- **Props**:
  - `sessionId`: Session ID
  - `selectedReferences`: 已选中的引用
  - `onReferencesChange`: 引用变化回调
- **功能**:
  - 显示可选的 Info 列表
  - 支持多选 Info 作为引用
  - 显示已选中的引用

### 路由与 URL 约定（前端）
- Session 选择：
  - `/session/:id` 或 `?sessionId=:id`：初始选中该 Session；否则尝试从 localStorage `lastSessionId` 恢复。
- Tab 页 初始状态（两层 tab 页，都需要支持路由，ConversationsPage 和 InfosPage 内部有子 tab 页）：
  - `tab=user|info`：主 Tab；若 `convTab` 是详情则强制 user，若 `infoTab` 是详情则强制 info。
  - `convTab=index|waiting|<conversationId>`：会话页初始 tab，具体 id 时自动打开详情。
  - `infoTab=index|<infoId>`：Info 页初始 tab，具体 id 时自动打开详情。

### 路由实现方案（执行中）
- 选型：`react-router-dom@6`，用 `BrowserRouter + useSearchParams` 管理路径与查询参数。
- 路径：`/` 与 `/session/:id` 复用同一布局；会话选择优先顺序为 path param > `?sessionId` > localStorage。
- 查询参数：`tab/convTab/infoTab` 由 URL 作为单一事实来源，UI 交互通过更新 search params 保持同步；当 `convTab` 为详情时强制 `tab=user`，当 `infoTab` 为详情时强制 `tab=info`。
- 兼容性：保留原有 localStorage `lastSessionId` 回退；不破坏现有未携带查询参数的访问。
