# web/src 设计与进度

> 先写清楚问题，再动手写一行代码。

## 目标
- 实现 README 中定义的前端布局与交互：Session 创建与列表、Conversation 列表与详情、Info 表格、等待手动思考列表、附身开关。
- 遵守 DESIGN_LANGUAGE 的三层视觉层次，支持明/暗主题。
- 提供最小可维护的状态与 API 适配层，TDD 驱动关键行为。

## 状态与数据结构
- `sessionsAtom`：SessionListItem[]（含 possessed 标记）
- `sessionsLoadingAtom`
- `selectedSessionIdAtom`
- `conversationsBySessionAtom`：Record<sessionId, ConversationResponse[]>
- `conversationDetailsAtom`：Record<conversationId, ConversationResponse>
- `infosBySessionAtom`：Record<sessionId, InfoListItem[]>
- `selectedInfoBySessionAtom`：Record<sessionId, string | null>
- `waitingManualConversationsAtom`：Record<sessionId, ConversationResponse[]>
- `manualThinkMethodByConversationAtom` / `manualThinkParamsByConversationAtom` / `submittingManualThinkByConversationAtom`
- `openConversationTabsAtom`：详情页 Tab 列表，支持关闭
- `layoutAtom`：左右面板宽度，持久化于 localStorage

## 组件分解
- 布局：`App`（Provider + 主题） → `Background`/`Background2`/`Container`
- 右侧：`SessionCreator`（POST /sessions）+ `SessionList`（GET /sessions，点击触发 selectedSessionIdAtom）
- 左侧 Tabs：
  - `UserConversationsTab`：轮询 `/sessions/{id}/conversations`，支持 `UserTalkForm`（POST /sessions/{id}/talk`）
  - `InfoTableTab`：GET `/infos`；行内“查看详情”触发 GET `/info/{info_id}?detail=true`
  - `WaitingManualConversationsTab`：轮询 `/waiting_manual_conversations`，开关 `/possess`
  - `ConversationDetailTab`：GET `/conversations/{conversation_id}`，显示 Questions/Actions/ManualThink
- 辅助：`ConversationSummary`、`ReferenceList`、`InfoReferenceSelector`、`ManualThinkResponder`

## API 约定
- BasePath `/api`（vite 代理），错误统一映射为 `ApiError { message, status }`
- 封装函数：`createSession`、`listSessions`、`getSession`、`talk`、`answer`、`listConversations`、`getConversation`、`listInfos`、`getInfo`、`setPossess`、`getWaitingManualConversations`、`respondManualThink`
- 所有 fetch 默认超时 10s；返回非 2xx 抛 ApiError。

## 测试计划（Vitest + Testing Library）
- API 层：mock fetch，验证路径/方法/负载与响应解析。
- 状态：`openConversationTabsAtom` 行为（去重、关闭）；`layoutAtom` 落盘。
- 组件：
  - `SessionCreator`：必填校验 + 成功回调触发 refresh。
  - `TabSwitcher`：标签切换触发对应内容渲染。
  - `UserConversationsTab`：轮询调用节流（fake timers）。
  - `WaitingManualConversationsTab`：附身开关调用 /possess。

## 分工/子问题（SubAgents 心智）
- 子问题 A：样式与主题 —— 输入设计语言，输出 CSS 变量与背景层组件。
- 子问题 B：API 适配 —— 输入 server 路由规范，输出 typed fetch helpers + error 处理。
- 子问题 C：状态与轮询 —— 输入 Jotai 需求，输出 atom 定义与刷新 hooks。
- 子问题 D：UI 组件 —— 输入 README 布局，输出交互组件，确保无 3 层以上缩进。
- 子问题 E：测试 —— 输入交互需求，输出 Vitest 用例驱动实现。

## 进度
- [x] 文档与状态规划
- [ ] API 适配层
- [ ] 布局/样式
- [ ] 功能组件
- [ ] 测试用例
- [ ] 联调与文档更新

