# OOC 前端 UI/UX 评审与问题跟踪（2026-06-11）

> 体验官以「真实新用户 + 设计评审」双视角逐界面走查（22 截图，1440×900 + 768 窄屏）。
> 本文是**问题跟踪表**：每条含严重度 / 界面 / 现象 / 修复方向 / 状态。截图存运行时 `/tmp/ooc-ui-shots/`（ephemeral）。

## 四维评分

| 维度 | 评分 | 一句话 |
|------|------|--------|
| 用户友好度 | 🟡→🔴 | welcome 建 session 引导清晰；但多处把内部契约甩给用户、术语零解释、首屏空态无路可走 |
| 信息呈现 | 🟡 OK | thinkloop trace 有层次；但重复 notice 卡片噪声大、thread 画布大片空白 |
| 样式统一性 | 🔴 Bad | 顶栏标题 chip 漂移（Pools 显示「World」）、catch-all 404 脱壳裸渲染、中英混排割裂 |
| 美观度 | 🟡 OK | 内页（landing/对象/stones）单色+绿 accent 克制专业；扣分在 404 裸页/空画布/红字报错 |

**定性**：「精致的主干 + 漏底的边缘」——内页是有品味的专业控制面，但边界态（空态/错误态/隐藏态）+ 顶栏标签系统性把实现细节暴露给用户，且中英混排割裂观感。

## 问题跟踪表

| ID | 严重度 | 界面 | 现象 | 修复方向 | 状态 |
|----|--------|------|------|----------|------|
| UI-1 | P0 · visibility-first | thread context 空态 | 正文直接写「URL 要带 `?sessionId=&objectId=&threadId=`」，把 query 参数语法甩给用户 | 换成可操作引导「从左侧 flow 图点选 thread 节点」，绝不暴露参数名 | ✅ 已修 |
| UI-2 | P0 · 样式统一 | catch-all 404 | 未知路由整个 app shell（侧栏/导航/logo）消失成灰底裸文本页 | `routes.tsx` 的 `*` 复用 AppShell + 内嵌 NotFound（向对象级 404 看齐） | ✅ 已修 |
| UI-3 | P1 · visibility-first | sessions 侧栏 | 默认滤掉 `_test_` 前缀，首屏「No sessions (N hidden)」+「Pick a session」无路可走、不知「眼睛」可解除 | 隐藏计数旁加 `title`/文案「显示 N 个隐藏会话」；或首访不过滤仅折叠提示 | ✅ 已修 |
| UI-4 | P1 · 样式统一 | 顶栏 page-title chip | Pools 页 chip 显示「World」（bug）；session 页显示陈旧「object client」「user home」标签 | 审计顶栏 scope→label 映射：pools 单独成项、client/clients 字样换 visible/对象名 | ✅ 已修 |
| UI-5 | P1 · 友好度 | 对象「源码」tab | 无 visible 实现的对象（supervisor）报「client source not found for stone 'supervisor'」dev 风格错误 + 陈旧术语 | 无 visible 实现时给友好空态「该对象暂无自定义界面」；术语统一 visible | ✅ 已修 |
| UI-6 | P2 · 信息呈现 | thinkloop trace | 三张 `notice LLM_INTERACTION · CALL_STARTED` 卡片近乎相同、各展开整段 JSON、挤占右栏 | 同类 notice 折叠/合并为「LLM 调用 ×N」一行摘要，JSON 默认收起 | ✅ 已修 |
| UI-7 | P2 · 样式统一 | 全程 | 中英混排系统性割裂（英文 heading + 中文正文同屏、按钮「暂停 session」「done」混用） | 定主语言，文案集中过一遍 i18n，至少同句不双语并排 | ✅ 已修 |
| UI-8 | P2 · 美观 | thread graph 画布 | 两节点占顶部一条，下方 ~70% 高度全空 | 节点垂直居中/自适应缩放填充 | ✅ 已修 |
| UI-9 | P3 · 友好度 | 窄屏 768px | 侧栏仍占 ~300px、不收起，两栏被压窄，无 hamburger/抽屉 | 断点收起侧栏为抽屉 | ✅ 已修 |
| UI-10 | P3 · 友好度 | 全程 | stone/flow/pool/thread/window/object 术语对新用户无 tooltip/glossary 入口 | 首屏或导航旁加轻量「这些词是什么」入口 | ✅ 已修 |

## 亮点（做得好的，别回归）

- **welcome 建 session 卡片**：标题+副标题+三字段+主按钮，session id 自动预填，全站最友好入口。
- **对象页 self.md 渲染**：markdown 排版干净、身份分节、右侧 ENTRY POINTS/Recent flows 有用，「已渲染/源码」双 tab 思路对。
- **对象级 404**：「Stone not found」+ 具体 objectId + 「Browse all stones」恢复链接——错误态范本（catch-all 404 应学它）。
- **整体视觉基调**：单色 + 绿 accent、克制留白，专业不脏乱，非 AI 默认模板。
- **顶部状态栏**：pause/debug/online 三态一眼可见。

## 最该先改的 3 件事（本轮修复优先级）

1. **UI-1 堵契约泄漏** + **UI-2 catch-all 404 套回 app shell**（P0）。
2. **UI-4 顶栏 chip 漂移** + **UI-5 源码 tab 友好空态**（P1）。
3. **UI-3 隐藏 session 对新用户可见**（P1）。

> **全部 UI-1~10 已修（2026-06-11）。** UI-6~10 polish 轮决策：
> - UI-7 语言方针：用户面 prose/按钮/标签/空态/错误统一中文；保留 OOC 领域名词（stone/flow/pool/object/thread/window、导航 tab）+ 代码标识符。thread.status pill（done/running/waiting/failed）作 canonical 状态枚举保留英文（≈代码标识符，非 prose）——如需中文化 status 需另加 status→中文 展示映射层。
> - UI-10 glossary 双入口（Welcome hero + sidebar brand），词条口径取自对象树 ooc-glossary/各维 self.md，未自创。
> - e2e create-session 定位改 testid（`create-session-submit`），文案中文化后更稳。
