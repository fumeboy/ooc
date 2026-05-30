/**
 * 文档维护说明（app.client）
 *
 * 本文件是 OOC app.client（Web 控制面）概念子树的"树形文档源"，与 meta/object.doc.ts
 * 使用相同的 DocTreeNode 形态。维护时请遵循以下原则：
 *
 * 1. children vs patches
 *    - children: app.client "由什么组成"，每个 child 是一个明确的子概念（例如 chat、
 *      file viewer、tree/scope、routing）。
 *    - patches: 补充说明（边界约束、不变量、设计取舍、本地联调小知识），不引入新概念，
 *      只对父节点行为加注。
 *
 * 2. top-light, leaf-heavy
 *    - 根节点回答 "app.client 是什么、由几块组成"，不谈具体组件文件名。
 *    - 叶节点才引用 web/src/** 下的真实文件、API 路径、字段名。
 *    - 如果某层 content 开始堆细节，应再拆一层。
 *
 * 3. named 词典
 *    只收录 content 中真出现且需要解释的术语（cross-object talk、talk_window、
 *    polling-job 等），不堆砌全部前端词汇。
 *
 * 4. todo / warnings
 *    - todo: 设计上承诺但实现未到位的（例如部分 server 能力未在 transport 登记）。
 *    - warnings: 已知问题或当前形态的局限。
 *
 * 5. 与源代码一致性
 *    web 端前端代码位于仓库根 `web/`（vite + React），叶节点用相对仓库根的路径
 *    引用，例如 `web/src/domains/chat/formatter.ts`。当源代码搬迁或重写时，先核对
 *    叶节点事实陈述，再调整 content。
 */

type DocTreeNode = {
    title: string; // 文档节点标题
    content?: string; // 文档节点内容

    named?: Record<string, string>; // content 中提到的名词的词典

    children?: Record<string, DocTreeNode>; // 该节点的主要组成部分
    patches?: Record<string, DocTreeNode>; // 该节点的补充(比如特殊逻辑、边界情况等)
    relations?: [[DocTreeNode, string]]; // 该节点与其他节点的关系， [0] 为其他节点，[1] 为关系描述
    sources?: [[any, string]]; // 该节点与源代码的关系， [0] 为源代码，[1] 为关系描述

    todo?: string[]; // 该节点需要完成的任务
    warnings?: string[]; // 该节点的问题
};

/**
 * App Client 文档树根节点。
 *
 * 本根只回答 "app.client 是什么、当前由哪几块控制面能力组成、与 app server 是
 * 什么关系"，不下沉到组件、路由细节。具体内容在 children / patches 中展开。
 */
export const root: DocTreeNode = {
    title: "App Client",
    content: `
    app.client 是 OOC app 层的最小 Web 控制面（基于 React + Vite，仓库内位于 \`web/\`），
    作为人工浏览与轻量操作 world 的入口。它不持有任何核心业务状态，所有状态仍落在
    world 的 flows / stones 文件结构里，client 只通过 app server 暴露的 HTTP API
    读取目录树、文件内容、stones、flows、threads，并以 cross-object talk 模型
    创建 session、继续 thread。

    当前 app.client 控制面的核心组成：
    - chat / session 控制面：建 session（seed user→talk→target）、发起初始消息、轮询 job、
      在 session 内任意 thread 继续对话；ThreadHeader 提供 session 内 thread 切换器。
    - routing：基于 react-router 的 URL 单向真相；AppShell 从 URL 派生 scope / sessionId
      / objectId / threadId / path 等导航维度，刷新可恢复。
    - tree / scope 浏览：flows / stones / world 三个 scope 的目录树与文件预览。
    - file viewer：通用预览 + 针对 \`llm.input.json\` / \`loop_*.input.json\` 的结构化
      debug viewer；任意路径的只读预览。
    - context snapshot viewer：把 thread 的 ContextSnapshot 渲染成左树 + 右详情。
    - object client renderer：动态 \`/@fs/\` 加载 stones/flows 自带的 client 入口
      （\`client/index.tsx\` / \`client/pages/*.tsx\`），主控制面内联渲染。
    - knowledge 编辑：唯一开放写入的区域，仅限 \`stones/<git_branch>/<objectId}/{objectId}/knowledge/**\`。
    - 顶部状态（MainLogo）：health / global pause / debug 状态轮询与切换。

    app.client 的 chat 默认 \`threadId="root"\`，但已经具备 session 内 thread 切换器
    （ThreadHeader 列出 \`/api/flows/:sid/threads\` 的结果），不再是 root-thread-only。

    它有意不迁移旧 Web 的 Kanban、Issue、Task、SSE 实时事件、Command Palette、
    复杂 FlowData 聚合模型，也不复用旧 \`/api/talk/:target\` 兼容层；定位是"最小人工
    控制面"，不是产品化 UI。
    `,
    named: {
        "app.client": "OOC app 层的 Web 控制面，位于仓库 `web/`",
        "Web 控制面": "面向人工浏览与轻量操作 world 的最小前端",
        "app server": "OOC app 层的 HTTP 控制面后端，app.client 只消费它的 API",
        "world": "OOC 的状态根目录（flows / stones / ...），由 app server 启动时通过 --world 指定",
        "scope": "前端浏览维度，当前划分为 flows / stones / world 三个",
        "cross-object talk": "user 通过 user.root 上的 talk_window 与 target object 对话；user 没有自由文本输入，输入即派送到 talk_window 指向的 target thread",
        "talk_window": "context 中的一种 window；持有 source/target 的 (objectId, threadId)，是 chat 派送的路由表",
        "polling-job": "client 与 runtime 协作的一等契约：发起动作返回 jobId → 轮询 job 状态 → 再刷新 thread",
        "ContextSnapshot": "后端 thread.json 的 shape，被 ContextSnapshotViewer 渲染成左树 + 右详情",
        "ChatLine": "前端把异构 thread 事件归一化后的三元联合类型：message | tool | notice",
    },
    children: {
        "stack": {
            title: "技术栈与入口",
            content: `
            app.client 基于 React + Vite 构建，仓库根目录 \`web/\` 即前端工程：
            - \`web/index.html\` + \`web/vite.config.ts\`：Vite 入口与 dev 配置（dev 时把
              \`/api\` 代理到 \`http://127.0.0.1:3000\`，即本地 app server）。
            - \`web/src/main.tsx\`：React 应用入口；挂载 react-router。
            - \`web/src/app/\`：AppShell、路由派生与匹配、layout、本地状态（\`shell.tsx\`、
              \`routes.tsx\`、\`routing.ts\`、\`state.ts\`）。
            - \`web/src/domains/\`：按业务域分包，目前有 chat / clients / files / flows /
              sessions / stones。
            - \`web/src/transport/\`：HTTP 通信层（\`http.ts\`、\`endpoints.ts\`、\`errors.ts\`）。
            - \`web/src/shared/\`：跨域共享 UI、品牌资产与 \`WORLD_ROOT\` 辅助。

            另有 \`web/object-client.html\` + \`web/src/object-client-preview.tsx\` 作为
            Object Client 独立预览入口；与主控制面的 \`ObjectClientRenderer\` 共用 \`/@fs/\`
            动态加载契约。

            transport 不变量：\`requestJson\` 在响应 body 为空 / null 时返回 null
            （\`web/src/transport/http.ts\`）；shell 多处对 \`thread\` 做 null 保护，
            避免刚 seed / 短暂 404 时把旧 thread 状态覆盖掉。
            `,
            named: {
                "AppShell": "client 的顶层布局组件；从 URL 派生导航维度，本地 state 只缓存数据 + transient UI",
                "transport": "前端 HTTP 通信层，封装 endpoints 与错误处理",
                "WORLD_ROOT": "Vite 构建期注入的 world 绝对路径常量，ObjectClientRenderer 拼 /@fs/${...} 用",
            },
        },
        "routing": {
            title: "routing：URL 单向真相",
            content: `
            \`web/src/app/routing.ts\` 定义 \`RouteState\` 6 个 kind（welcome / scope /
            file / stoneClient / flowPage / flowsView）；\`useRouteState()\`
            用 \`useLocation()\` + \`useParams()\` 从当前 URL（含 pathname + search）派生
            \`RouteState\`，\`toPath(state)\` 是反向构造函数（shortcut 优先：命中 client
            入口的 file path 会规范化为 \`/stones/:id\` 或 \`/flows/.../pages/:page\`）。

            AppShell 不再 \`setState\` 改 \`activePath / activeSessionId\` 等导航字段；
            所有 handler 都走 \`navigate(toPath(...))\`，URL 变化经 \`useRouteState\` 回流
            为下一帧 state。这让浏览器前进/后退、刷新、复制粘贴 URL 都能恢复页面。

            **Thread 上下文 = query string overlay（2026-05 重构）**：原 \`kind: "thread"\`
            的路径段 \`/flows/<sid>/threads/<oid>/<tid>\` 已废弃；改为 \`kind: "flowsView"\`
            （带 \`view: "index" | "thread_context"\` 判别）可附带 \`sessionId? objectId? threadId?\`
            字段（在 URL 里编码为 \`?sessionId=&objectId=&threadId=\`；另有 \`selected?\` / \`loop?\` 可选 overlay）。
            同样 \`kind: "file"\` 也可携带可选 \`thread: { sessionId, objectId, threadId }\`，
            URL 形如 \`/files/<path>?sessionId=&objectId=&threadId=\`。这意味着：在 chat
            里看文件时 RightPanel 的 chat 不再消失——chat 上下文随 file URL 一起带过去。
            老 \`/threads/...\` 路径在 \`parseRoute\` 里仍能识别（归一为 \`kind: "flowsView"\`
            + view="thread_context" + thread 字段，见 routing.ts:191-194），保证已收藏的链接不挂；\`toPath\` 不再产此形态。

            派生关系（\`shell.tsx:56-83\`）：
            - \`scope = scopeOf(route)\`（welcome 视作 flows）。
            - \`activeSessionId\`：route.kind ∈ {flowsView, flowPage} 直接取；
              file 路由先看 \`thread.sessionId\`，再 fallback 从 \`flows/<sid>/\` path 前缀
              反推（保留 file 浏览的 session 上下文，避免侧栏从 file tree 翻回 SessionList）。
            - \`activeObjectId\`：flowsView 路由取 \`route.objectId\`；
              file 路由取 \`route.thread?.objectId\`（仅在 chat 上下文携带过来时存在）。
            - \`activeThreadId\`：flowsView 路由取 \`route.threadId\`；file 路由取
              \`route.thread?.threadId\`。
            - \`activePath\`：file/stoneClient/flowPage 三者按 \`derivePathFromRoute\`
              拼成 world 相对路径，让 \`MainPanel\` 的 \`matchClientTarget\` 命中 client 入口。

            FileTree 点击时（\`shell.tsx:handleNode\`）会主动续上当前 thread 上下文：
            \`navigate(toPath({ kind: "file", path, thread: { sessionId, objectId, threadId } }))\`，
            这样切换文件时 RightPanel 不被销毁。stale-tree 自愈见 \`useEffect\` on
            \`activeSessionId\`（不在 cached tree.children 中时主动 \`fetchTree\`）。
            `,
            named: {
                "RouteState": "判别联合：welcome / scope / file / stoneClient / flowPage / flowsView；flowsView（带 view + sessionId/objectId/threadId query string）/ file 可携带 thread 上下文",
                "toPath": "RouteState → URL 反向构造函数；shortcut 优先；thread 上下文走 query string",
                "useRouteState": "从 react-router 当前 URL（pathname + search）派生 RouteState 的 hook",
                "parseRoute": "纯函数版本，签名 (pathname, search, params)；老的 parsePathname 是 deprecated 同名 wrapper",
                "extractThreadContext": "从任意 RouteState 抽出 thread context（若有），navigate handler 需要保留时使用",
            },
            sources: [
                [
                    "web/src/app/routing.ts",
                    "RouteState / toPath / parseRoute / useRouteState / extractThreadContext；flowsView 路由的 sessionId/objectId/threadId 字段、file 路由的 thread 字段；老 /threads/... 路径在 parser 中归一到 flowsView(view=thread_context)+thread context 保证向后兼容（routing.ts:191-194）；shell.tsx:56-83 的 active* 派生 + handleNode 保留 thread 上下文逻辑；测试见 web/src/app/routing.test.ts（toPath ↔ parseRoute roundtrip + 老路径兼容）",
                ],
            ],
        },
        "chat": {
            title: "chat / session 控制面",
            content: `
            chat 是 client 最核心的交互区，负责会话创建、消息发送、thread continue
            与 timeline 展示。它不是普通"一问一答"对话流，而是 **cross-object talk**：
            user 在 user.root 上持有一个 talk_window 指向 target object 的 callee
            thread，user 的"消息"实际是 \`user.root.talk_window.say\` 的三段式调用，
            派送到 talk_window.target；callee 的回信通过 \`thread.outbox\` 流回 user。

            会话与消息流：
            - 欢迎页与 session 创建表单已从主面板拆分；SessionCreator 是 shadcn 风格的
              Input / Select / Textarea / Button 组合。
            - **创建 session 必须带 initialMessage**：前端 SessionCreator 的 \`canSubmit\`
              强制 \`sessionId\` / \`targetObjectId\` / \`initialMessage\` 三者非空；后端
              \`POST /api/sessions\`（\`seedSession\`）一次性 seed session + user flow object
              + user.root 上指向 target 的 talk_window + 派送 initialMessage 到 callee
              thread + enqueue job，返回 \`{ sessionId, userThreadId, talkWindowId,
              targetObjectId, targetThreadId, jobId }\`。
            - continue 不走 SSE，而是 "发起动作 → 轮询 job → 再刷新 thread"；
              \`POST /api/flows/:sid/continue\` body \`{ text, targetWindowId? }\` 固定走
              user.root.talk_window，返回 \`{ jobId?, targetObjectId, targetThreadId }\`。
              \`targetWindowId\` 缺省时后端取首个非 creator talk_window；多 talk 主题时 UI
              应显式传。
            - 直接打开既有 session（\`route.kind = "flowsView"\`，仅 sessionId）默认进入 \`user.root\`，
              先看到 user 视角的 talk 时间线。

            chat composer 位置：
            - composer 落在 RightPanel（\`web/src/app/layout/RightPanel.tsx\`）底部的
              ChatPanel 内，pause / send 都在右侧面板；MainPanel 不持有 composer。
            - RightPanel 是否渲染由 shell 决定：\`activeObjectId === "user"\` 时不渲染
              （user 不能和自己对话），切到两列布局；composer 还会按
              \`isUserOwnedOrCreated\` 判断是否显示（owner=user 或 creator=user 才展示）。

            timeline 展示模型（三元）：
            - 在 \`web/src/domains/chat/formatter.ts\` 中把原始 thread 事件归一为
              \`ChatLine\` 联合类型，分别是 message / tool / notice，再交由 TuiBlock 渲染。
            - 用户消息只在 \`inbox_message_arrived\` 事件出现时显示。
            - \`function_call\` 与 \`function_call_output\` 按 callId 合并为一张 tool card。
            - \`context_change.inject\` 渲染为 notice card，避免误看成用户对话。
            - message 渲染支持 Markdown；tool / notice header 收敛到单层 compact header。
            `,
            named: {
                "ChatLine": "归一化的三元联合类型 message | tool | notice",
                "TuiBlock": "渲染 ChatLine 的展示组件",
                "compact header": "tool/notice 卡片的单层 header 收敛形式",
                "ChatPanel": "RightPanel 内承载 timeline + composer 的容器",
                "SessionCreator": "Welcome 页的 session 创建表单组件",
            },
            children: {
                "polling-job": {
                    title: "polling-job 协议",
                    content: `
                    create session、continue thread、create flow object 等动作的前端闭环：
                    1. 发起 HTTP 调用，拿到 \`jobId\`。
                    2. 轮询 job 状态：\`web/src/domains/chat/policy.ts\` 中 \`waitForJob\`
                       最多 20 次、每次 500ms，约 10 秒上限。
                    3. job 终态后再触发 thread 刷新。

                    超时后前端停止等待但不视为硬错误。该协议让 client 不需要 SSE
                    / WebSocket 也能跟随 runtime 进度。

                    **额外的 4s thread 轮询**（\`shell.tsx:164-193\`）：当 session 视图打开
                    （\`activeSessionId && activeObjectId\` 非空）时，AppShell 每 4 秒静默
                    \`Promise.all([fetchThread, fetchFlows])\`，做 hash diff 后只在变化时更新
                    state；URL 变化时 useEffect 自动重置 interval。这让 callee 在用户不动
                    的情况下也能渐进显示新事件与 pause 状态。
                    `,
                    warnings: [
                        "20 × 500ms 的轮询窗口（约 10 秒）对长任务过短；超时后 UI 会停止等待，但 runtime 仍在跑，需要等 4s 轮询接力或用户手工触发刷新。",
                    ],
                },
                "thread-switcher": {
                    title: "session 内 thread 切换器（ThreadHeader）",
                    content: `
                    \`web/src/app/layout/ThreadHeader.tsx\` 在 MainPanel 的 breadcrumb-bar
                    内联显示当前 \`<objectId> · <threadId>\` 与状态 pill；当 \`sessionThreads.length > 1\`
                    时渲染 \`<select>\` 切换 thread，选中后 shell 通过
                    \`navigate(toPath({ kind: "thread", sessionId, objectId, threadId }))\`
                    跳转。

                    数据源：\`fetchSessionThreads(sessionId)\` 走
                    \`GET /api/flows/:sid/threads\`（\`endpoints.sessionThreads\`），后端实现
                    \`src/app/server/modules/flows/api.list-threads.ts\` 列出 session 下所有
                    \`(objectId, threadId)\` 对。

                    与 chat 行为解耦：ThreadHeader 只显示与切换，不携带 send / pause；
                    RightPanel 被隐藏（如 user.root）时仍可见。
                    `,
                },
                "timeline-enhancements": {
                    title: "chat 时间线显示增强",
                    content: `
                    在 message | tool | notice 三元模型之上的增量改进，集中在
                    \`web/src/domains/chat/formatter.ts\` 与 TuiBlock 组件中：

                    - **inbox 消息按 source / fromObjectId 显示真实标签**：
                      原来 \`inbox_message_arrived\` 全部硬编码 \`role: "user"\`，多 object
                      talk 场景下完全错位。\`senderLabel\` 现按 \`fromObjectId\` 优先
                      （格式 \`<obj> · <thread>\`），fallback \`source\`（\`user\` / \`system\` /
                      \`talk · <thread>\`），再 fallback \`fromThreadId\`。
                    - **tool ok/fail 优先用 output JSON 的 ok 字段**：
                      \`deriveOk(outputValue, eventOk)\` 先 JSON.parse output 取 \`ok\`，
                      解析失败再退回 \`event.ok\`。这覆盖了 thinkloop 老版本硬写
                      \`ok:true\` 留下的旧 thread 数据，让 refine 拦截错误正确显示红色
                      fail 徽章。
                    - **assistant→user 回信穿插到时间线**：
                      当 \`thread.creatorObjectId === "user"\` 时，从 \`thread.outbox\` 取
                      所有 \`windowId\` 对应 \`talk_window.target = user\` 的消息，按
                      createdAt 用游标在 inbox events 之间穿插 push；否则三段式
                      \`open(say) → refine(msg) → submit\` 的内容只落 outbox，时间线
                      上看不到对话。
                    - **tool card 末尾的 "view in context tree" 按钮**：
                      \`WindowLinkRow\` 从 \`rawOutput.window_id / form_id\` →
                      \`rawArguments\` → \`wait.on\` 顺序提取目标 id，点击 dispatch
                      \`navigate-window\` 事件，ContextSnapshotViewer 自动展开父链
                      + scrollIntoView + select。
                    `,
                },
                "constraints": {
                    title: "当前 chat 的硬约束",
                    content: `
                    - **默认 root thread**：\`session\` 路由默认派生 \`activeThreadId="root"\`、
                      \`activeObjectId="user"\`；要切到其他 thread 必须经过 ThreadHeader
                      下拉或显式 \`/flows/:sid/threads/:obj/:tid\` URL。
                    - **没有 SSE**：所有进度都靠 polling-job + 4s thread 轮询；UI 上的
                      "进行中" 仅在 \`waitForJob\` 轮询窗口内有 jobId 的明确状态。
                    - **只在 inbox_message_arrived 时显示用户消息**：客户端不会乐观地
                      把用户输入直接显示成气泡，必须等 thread 事件回灌。
                    - **chat 是 cross-object talk，不是自由对话**：composer 输入永远
                      经 user.root.talk_window 派送，没有"裸消息"通道。
                    - **消息文本支持 inline UI token**（详见 \`inline_ui\` 子节点）：
                      Object 写 \`[[ui{"comp":"file-link","path":"..."}ui]]\` 嵌入文本，
                      \`InlineUiContent\` 解析后渲染成 React 组件。
                    - **连续 tool 卡合并**：\`open\` 后紧邻同一 window_id 的
                      \`refine / submit / close\` 会折叠成一张主卡 + 紧凑 followUps 列表
                      （\`formatter.ts:groupConsecutiveToolLines\`）；中间夹 message /
                      notice / 不同 window 即断链。\`ChatLine.tool.followUps\` 是新加的
                      可选字段，旧消费者忽略时仍能渲染主行。详见
                      \`web/src/domains/chat/formatter.test.ts\` 7 项单测。
                    `,
                },
            },
        },
        "layout_mode": {
            title: "Layout mode 切换：三栏 / 两栏",
            content: `
            \`web/src/app/layout/LayoutModeToggle.tsx\` 提供单独的切换按钮组件，状态由
            \`shell.tsx\` 的 \`useState<LayoutMode>\` + localStorage（\`ooc:layoutMode\`）
            持久化。AppLayout 接收 \`mode\`：\`"three-column"\` 走原 grid（280 + 1fr + 350），
            \`"two-column"\` 时强制 \`!showSidebar\` 并改为 \`1fr + 1fr\`，让主面板与右面板
            各占 50%——典型场景：用户进入"专注 chat ↔ 主视图"模式，把 sidebar 暂时挪开。

            按钮挂在两个常用视区：
            - \`MainPanel\` breadcrumb-bar 最左（\`.breadcrumb-layout-toggle\`）
            - \`RightPanel\` 顶部 header（取代原 invisible spacer，详见 \`right_header\`）

            状态共享但 UI 复制——同 \`mode\` 渲染同 icon（\`Columns3\` ↔ \`Columns2\`），点
            任一处都触发 \`toggleLayoutMode\` 走 setter + persist。
            `,
            named: {
                "LayoutMode": "判别联合 'three-column' | 'two-column'，决定 sidebar 是否渲染 + grid 列数",
                "LayoutModeToggle": "单一按钮组件，shell 决定 mode 与回调",
                "ooc:layoutMode": "localStorage key，跨刷新保持用户偏好",
            },
            sources: [
                [
                    "web/src/app/layout/LayoutModeToggle.tsx",
                    "LayoutMode type / LayoutModeToggle 按钮 / readPersistedLayoutMode + persistLayoutMode；AppLayout 在 mode='two-column' 时省略 sidebar、加 .app-layout-two-col 类（grid-template-columns: 1fr 1fr）；shell.tsx 的 toggleLayoutMode 包 setState + persistLayoutMode；MainPanel 的 breadcrumb-bar 最左、RightPanel 的 .right-header 内各挂一份",
                ],
            ],
        },
        "right_header": {
            title: "RightPanel header：对话对象 + 主视图切换 + layout 切换",
            content: `
            原 \`right-breadcrumb-spacer\`（仅占位的 invisible div）已替换为完整 header
            行（2026-05-21 改造）。布局：左侧"对话对象 displayName"（取自 self.md 首行，
            fallback 到 objectId），右侧两个图标按钮——

            1. **查看 context windows**（\`Network\` icon）：调 shell.handleShowContextWindows，
               其本质是 \`navigate(toPath({ kind: "flowsView", view: "thread_context", sessionId, objectId, threadId }))\`，
               把 MainPanel 从 file viewer / 其它视图切回 thread context tree
               视图（即用户从 chat 里 file-link 跳到 file 视图后，一键回 chat 主视图）。
            2. **LayoutModeToggle**：与 breadcrumb-bar 那个共享同一 mode（详见 \`layout_mode\`）。

            行为契约：与原 spacer 同高（\`.right-header\` 高 34px），保证两列顶部对齐
            （breadcrumb-bar 也是 34px）；不渲染 RightPanel 时（user.root）整个 header
            连同 ChatPanel 一起隐藏。
            `,
            named: {
                "对话对象 displayName": "通过 useDisplayNames(objectId) 解析 self.md 首行；fallback 到 objectId",
                "查看 context windows 按钮": "shell.handleShowContextWindows，本质是导航到当前 session+thread 的 URL，让 MainPanel 退回 thread 视图",
            },
            sources: [
                [
                    "web/src/app/layout/RightPanel.tsx",
                    ".right-header 行（左侧 displayName / 右侧 Network 按钮 + LayoutModeToggle）；shell.handleShowContextWindows 走 navigate(toPath({kind:'session',...}))；样式见 web/src/styles.css 的 .right-header* 段（与 breadcrumb-bar 同高 34px 保证两列顶部对齐）",
                ],
            ],
        },
        "inline_ui": {
            title: "inline UI tokens：消息文本里的可交互组件",
            content: `
            **场景**：Agent（user readme 里给出的协议）向 user 发消息时，可在文本里
            嵌入特殊 token \`[[ui{"comp":"<name>",...其它参数}ui]]\`，让前端渲染成可
            点击 / 可交互的 inline 组件，而不只是纯文本。Agent 端只产 token 文本，
            前端集中 dispatch 渲染——不让 Agent 直接写 HTML，避免 XSS。

            **语法**：
            - \`[[ui\` 起首、\`ui]]\` 结束（双方括号 + ui 标记）
            - 中间是**严格 JSON 对象**（key 必须双引号），其中 \`comp\` 字段指定组件名，
              其余字段是该组件的参数
            - 一条消息里任意多个 token，与普通文本混排

            **已注册组件**：
            - \`file-link\` —— 必选 \`path\`，可选 \`label\`；渲染 React-Router \`<Link>\`，
              点击跳到 file viewer 视图。**关键**：\`FileLinkInline\` 用 \`useLocation()\`
              读当前 thread 上下文（query string 里的 \`sessionId / objectId / threadId\`），
              拼到 file URL 上让 RightPanel 的 chat 跨文件查看持续显示。

            **失败回退**：
            - JSON 解析失败 → 原文按字面文本展示
            - 缺 \`comp\` 字段 / \`comp\` 非 string → 同上
            - 未知 \`comp\` → 渲染 \`<code>[unknown ui: <comp>]</code>\` 占位

            **渲染入口**：\`TuiBlock\` 在渲染 \`line.kind === "message"\` 时不再直接调
            \`<MarkdownContent>\`，而是走 \`<InlineUiContent>\`：fast path（无 \`[[ui\` 子串）
            退回原 MarkdownContent；含 token 时 \`parseInlineUiSegments\` 切分成
            \`[text, ui, text, ...]\` 段，分别渲染。

            **协议来源**：\`stones/main/user/readme.md\` 是约定的权威文本——Agent 在 super
            flow 注入到 LLM context 时通过读 user 的 readme 学习这套语法。新组件
            注册时同步更新 readme 即可，Agent 端零改动。

            **扩展点**：加新组件只需在 \`InlineUiContent.tsx\` 的 \`InlineUiComponent\`
            switch 加一条 case，更新 user readme 注册表。例子：未来可加
            \`image\` / \`chart\` / \`confirm-button\` / \`code-snippet\`；都走同一通道、
            零 \`dangerouslySetInnerHTML\`。
            `,
            named: {
                "[[ui...ui]]": "inline UI token 语法外壳；中间是 JSON 对象描述要渲染的组件",
                "comp": "JSON 字段，指定组件名（如 file-link）；其余字段是组件 props",
                "InlineUiContent": "消息文本渲染入口，替代 TuiBlock 里直调的 MarkdownContent",
                "parseInlineUiSegments": "把含 token 的文本切成 text / ui 段的纯函数（9 个单测）",
                "FileLinkInline": "已注册组件之一；用 useLocation 续 thread 上下文到 file URL，让 chat 不消失",
                "user readme 协议来源": "stones/main/user/readme.md 是 Agent 学这套语法的权威文档",
            },
            sources: [
                [
                    "web/src/shared/ui/InlineUiContent.tsx",
                    "parseInlineUiSegments / InlineUiContent / InlineUiComponent dispatch / FileLinkInline 用 useLocation 续 thread context；TuiBlock 在 message 渲染处用 InlineUiContent 替换 MarkdownContent；样式 .inline-ui-container / .inline-ui-file-link / .inline-ui-unknown 在 web/src/styles.css；语法约定见 .ooc-world/stones/main/user/readme.md；测试 web/src/shared/ui/InlineUiContent.test.ts 9 项",
                ],
            ],
        },
        "main-logo": {
            title: "MainLogo / 顶部状态控制",
            content: `
            左侧 MainLogo 已接上后端真实接口，作为全局健康/暂停/调试控制位：
            - \`GET /api/health\` 探测 online / offline。
            - \`GET|POST /api/runtime/global-pause/*\` 控制全局 pause。
            - \`GET|POST /api/runtime/debug/*\` 控制 debug 开关。

            刷新策略：每 10 秒轮询一次。
            视觉编码：默认灰、pause 橙、debug 蓝、pause+debug 渐变。
            `,
        },
        "tree-scope": {
            title: "tree / scope 浏览",
            content: `
            client 通过 scope 切换浏览不同视角的 world：

            - 切换 scope 时（\`shell.tsx:70-78\` 的 \`refreshBasics\`）并行拉取
              **flows list + stones list + 当前 scope 的一棵 tree**
              （\`Promise.all([fetchFlows(), fetchStones(), fetchTree(targetScope)])\`），
              不是三个 scope 的 tree 全拉，也不是按节点懒加载的 explorer。
            - flows scope 下 Sidebar 当前是 "session list 与当前 session tree 二选一"
              的展示模型，而不是多 session 树同时常驻；\`showSessions\` 状态由
              \`!activeSessionId\` 同步驱动。
            - file 路径与 session 上下文反推：\`web/src/app/shell.tsx\` 派生
              \`activeSessionId\` 时，除了 \`route.kind ∈ {session, thread, flowPage}\`，
              还会在 \`route.kind === "file"\` 且路径以 \`flows/<sid>/...\` 开头时反推
              sessionId。这是为了避免一个原本误导的行为：用户在 flow 树点开任意文件，
              路由变成 \`kind: "file"\`，\`activeSessionId\` 派生为 undefined → effect
              \`setShowSessions(true)\` → 侧栏从 file tree 翻回 session list。反推后浏览
              文件不再丢 session 上下文。
            `,
            named: {
                "scope": "flows / stones / world 三种浏览视角",
            },
        },
        "file-viewer": {
            title: "文件查看器",
            content: `
            通用文件查看器 + 针对 LLM 调试文件的专用 viewer + 任意路径预览。

            通用预览：
            - 普通文本、JSON、Markdown 沿用通用 CodeMirror 预览。

            llm.input.json / loop_*.input.json 专用 viewer：
            - 实现位于 \`web/src/domains/files/components/FileViewer.tsx\`，命中
              \`llm.input.json\` 或 \`loop_*.input.json\` 时切换到专用渲染。
            - 左侧按 input item 展示 message / function_call / function_call_output /
              reasoning。
            - 对 system message 中的 XML context 继续拆成树形节点与详情面板，便于
              直接查看 context / thread / active_forms / active_knowledge / windows /
              inbox 等结构。
            - viewer 还会展示 XML attrs / comments、字符数与粗略 token 估算。
            - 若 JSON 解析失败，则回退原始只读 JSON 视图。
            - 目标不是编辑 debug 文件，而是降低人工排查 LLM 输入时的阅读成本。

            任意路径文件预览：
            - 新增 \`GET /api/file/read?path=&maxBytes=\` 不受 world 隔离的只读 endpoint
              （后端 \`src/app/server/modules/ui/api.read-any-file.ts\`），用于服务
              file_window 详情面板的内容预览（\`file_window.path\` 通常是绝对路径，
              不一定落在 \`--world\` 内）。
            - 256 KB 软上限，超出标 \`truncated\`；仅本地 dev 场景使用，公开部署需再
              加策略层。
            - 前端通过 \`fetchAnyFile(path)\` 消费，\`.md\` / \`.markdown\` 走
              MarkdownContent 渲染，其它扩展名走 CodeMirror 语法高亮。
            `,
            warnings: [
                "debug viewer **不是**走 runtime debug 文件 HTTP API，而是仍然通过 /api/tree/file 读取 world 里的 debug JSON 文件，再在前端按路径切换 viewer；与 runtime debug endpoint 不一致。",
                "/api/file/read 没有 world 隔离与策略层，只允许在本地 dev 场景下使用；公开部署必须先加 path 白名单或鉴权。",
            ],
        },
        "context-snapshot-viewer": {
            title: "ContextSnapshotViewer：thread context 可视化",
            content: `
            \`ContextSnapshotViewer\` 把后端 \`ContextSnapshot\`（与 \`thread.json\` 同
            shape）渲染成结构化的左树 + 右详情面板，是排查 thread 状态的主要入口。

            两处使用：
            1. \`FileViewer\` 在选了 session 但未选文件时直接展示 thread context。
            2. \`LLMInputJsonViewer\` 在新版 \`llm.input.json\` 中替代 system message
               XML 子树。

            左树组织：
            - thread 根节点对用户隐藏（viewer header 已显示 thread id，重复无用）；
              TreeNode 用 \`depthOffset=1\` 让 children 表现为 depth=0 顶层。
            - top-level windows **按 type 分组**（root / command_exec / do / talk /
              todo / program / file / knowledge / search），组内按 \`createdAt\` 升序，
              避免 15+ 个混杂 window 难以扫读。
            - events section **默认折叠**（\`collectInitialExpandedIds\` 不把 events
              section 自身加进展开集，children 自然不渲染），避免 100+ 条
              \`llm_interaction\` / \`tool_runtime\` 事件淹没视图。

            右详情按 window type 增强：
            - **file_window**：调 \`FileWindowContentView\` 实时 fetch 文件内容，按
              lines / columns 切片显示；\`.md\` 走 MarkdownContent，其它走 CodeMirror。
            - **command_exec(command=edit)**：把 \`accumulatedArgs.{old, new}\` 渲染为
              \`@codemirror/merge\` 的 unifiedMergeView 红绿 diff；\`edits[]\` 多条按
              顺序展示。
            - **command_exec(command=write_file)**：把 content 单独成大段预览。
            - **program**：详情平铺 history（lang / status / time + 首行 code），
              最后一次完整展开 code+args+output，前面 output 截断 200 字预览。
            - **knowledge** body 走 MarkdownContent，与 file_window 一致。
            - **command_exec.result**：按 success / error 加色调。

            transcript / message 展示 fromObjectId：
            - 后端 \`ThreadMessage\` 增加可选 \`fromObjectId\`（由 \`talk-delivery\` 写入）。
            - 前端三处（左树 message label / 右侧 transcript dir / message detail
              header）都改成 \`<obj> · <thread>\` 双字段显示，让对端身份一目了然。

            跨组件导航：
            - \`web/src/domains/files/navigation-events.ts\` 提供 CustomEvent 总线
              \`dispatchNavigateToWindow(windowId)\` / \`subscribeNavigateToWindow(handler)\`。
            - ContextSnapshotViewer 订阅后会展开目标节点的祖先链 + smooth
              scrollIntoView + select；TreeNode row 元素带 \`data-cw-node-id\` 便于定位。
            - TuiBlock 中 \`WindowLinkRow\` 从 tool call 的 \`rawOutput.window_id /
              form_id\` → \`rawArguments\` → \`wait.on\` 顺序提取目标 id，渲染 "view in
              context tree" 按钮。
            `,
            named: {
                "ContextSnapshot": "后端 thread.json 的 shape，作为该 viewer 的输入",
                "LLMInputJsonViewer": "llm.input.json 专用 viewer，内嵌 ContextSnapshotViewer",
                "navigate-window": "跨组件导航 CustomEvent 名，定位到 context tree 指定 window",
            },
        },
        "object-client-renderer": {
            title: "ObjectClientRenderer：动态加载 Object 自带 UI",
            content: `
            \`web/src/domains/clients/ObjectClientRenderer.tsx\` 让主控制面直接 render
            stones / flows 自带的 React 组件，不再只能展示文件源码。契约见
            \`meta/object/executable/client/index.doc.js\`：
            - Stone：\`<dir>/client/index.tsx\` 单页入口。
            - Flow：\`<dir>/client/pages/{page}.tsx\` 多页。
            - 组件 \`default export\`，props \`{ sessionId?, objectName?, callMethod? }\`。

            加载机制：
            - 拼绝对路径 \`\${WORLD_ROOT}/stones|flows/...\`（\`WORLD_ROOT\` 由 vite
              \`define\` 注入），通过 \`/@fs\${absPath}\` 形式动态 \`import\`。
            - vite dev server 用 \`server.fs.allow\` 把 worldRoot 加入白名单，让
              \`/@fs/\` 协议可以访问 world 目录。
            - 先 \`HEAD\` 探测：缺文件按 content-type 判（\`text/javascript\` = 存在，
              \`text/html\` = SPA fallback），缺则渲染 "信息待产出..."；其它加载错
              展示红色 LoadErrorBox；ErrorBoundary 捕获渲染期异常，仅 \`console.error\`
              不发请求。
            - \`callMethod\` 由 renderer 合成：stone 走 \`POST /api/stones/:id/call_method\`，
              flow 走 \`POST /api/flows/:sid/objects/:id/call_method\`，注入到组件 props。

            主控制面集成：
            - shell 的 \`/stones/:id\` 和 \`/flows/:sid/objects/:id/pages/:page\` 两条路由
              经 \`derivePathFromRoute\` 拼出 client 入口文件路径；MainPanel 用
              \`matchClientTarget(path)\` 命中后渲染 \`ClientWithSourceToggle\`，可在
              "object client UI" 与 "源码"之间切换。
            - 独立预览页 \`web/object-client.html\` 用同一 renderer 做沙箱式预览。
            `,
            named: {
                "ObjectClientRenderer": "动态加载并渲染 Object 自带 React UI 的核心组件",
                "ClientWithSourceToggle": "MainPanel 内 'object client UI ↔ 源码' 切换器",
                "/@fs/": "Vite 暴露的本地文件访问协议；用 server.fs.allow 白名单授权",
            },
        },
        "knowledge-editing": {
            title: "knowledge 编辑（唯一写入口）",
            content: `
            client 唯一开放写入的区域是 \`stones/{objectId}/knowledge/**\`，通过
            stones knowledge API 保存：
            - 支持创建 knowledge 目录、创建 knowledge 文件、更新 knowledge 文件。
            - 命中该路径前缀的文件会进入可编辑模式；其余文件均为只读浏览。

            world 与 flows 树仍然只读浏览，禁止经由 UI 旁路 server 策略校验或绕开
            stone server method 写入。
            `,
        },
        "consumed-api": {
            title: "当前实际消费的 server API 子集",
            content: `
            app.client 只消费 app server 暴露能力的一个较小子集（登记在
            \`web/src/transport/endpoints.ts\`）：
            - **sessions / chat**：
              - \`POST /api/sessions\` — seed session（cross-object talk 入口），body
                \`{ sessionId, title?, targetObjectId, initialMessage }\`，response
                \`{ sessionId, userThreadId, talkWindowId, targetObjectId, targetThreadId, jobId }\`。
              - \`GET /api/flows/:sid/objects/:oid/threads/:tid\` — 拉 thread context。
              - \`GET /api/flows/:sid/threads\` — 列出 session 下所有 (objectId, threadId)，
                ThreadHeader 切换器数据源。
              - \`POST /api/flows/:sid/continue\` — 用户回复，body \`{ text, targetWindowId? }\`，
                response \`{ jobId?, targetObjectId, targetThreadId }\`。
              - \`POST /api/flows/:sid/pause\` / \`/resume\` — session 级 pause。
            - **flows**：list、create flow object（\`POST /api/flows/:sid/objects/\`，
              目前主要由 ad-hoc 工具/调试触发，不是 chat 入口）。
            - **ui**：\`GET /api/tree\`、\`GET /api/tree/file\`、\`GET /api/file/read\`。
            - **stones**：list / create stone / create knowledge directory / create
              knowledge file / update knowledge file。
            - **runtime**：job status、global pause status & toggle、debug status & toggle。
            - **call_method**：stone (\`POST /api/stones/:id/call_method\`) 与 flow object
              (\`POST /api/flows/:sid/objects/:id/call_method\`) 都已登记，由
              \`ObjectClientRenderer\` 等组件按需调用。

            当前 **不**消费的 server 能力：
            - runtime: llm-config / jobs list / latest debug / loop debug。
            - stone self / readme / data / executable-source 读写。
            `,
            todo: [
                "若后续要把 stone self/readme/data 编辑、loop debug 等纳入 client，需先把对应 endpoint 在前端 transport 层登记。",
            ],
        },
    },
    patches: {
        "backend-resolver-authority": {
            title: "frontend 路径解析必须经 backend resolver（2026-05-24，根因 #3）",
            content: `
            **契约 1（接口 explicit）**：frontend 不假设 backend 存储路径，所有
            path / marker 解析必经 backend resolver。

            **历史踩坑（4 处同根因 facet）**：
            - R2 #6 tree marker 错位：前端按 path-prefix 启发式判 marker，2026-05-21
              stones 重组（加 \`<branch>/objects/\` 中间层）后失效。
            - R3 #11 stones knowledge HTTP 写到 pools：路径标签 \`/api/stones/.../knowledge\`
              语义错位。
            - R6 #39 ObjectClientRenderer 未加 \`main/objects/\`：硬编码
              \`\${WORLD_ROOT}/stones/<id>/client/index.tsx\`，stones 重组后 404。
            - R6 #43 seeded stone 不在 sidebar tree：marker 启发式 4 段路径失效。

            **新约定**：
            - marker：backend \`/api/tree\` 基于 \`.stone.json\` / \`.pool.json\` /
              \`.flow.json\` / \`.session.json\` 元数据存在性给出。
            - client 源文件路径：frontend 走 \`/api/objects/:scope/:id/client-source-url\`
              endpoint 拿 backend 用 \`stoneDir() / objectDir()\` 权威解析的
              \`{ absPath, fsUrl }\`。
            - knowledge 写入：用 \`/api/pools/...\`（旧 \`/api/stones/.../knowledge/...\`
              保留 deprecation 兼容）。

            **反熵**：删除前端 path 拼接代码（\`web/src/shared/world-root.ts:WORLD_ROOT\`
            目前仅在 vite config inject 时使用，不再被业务代码 import）；不引入新的
            "路径标准化"抽象——backend 已经给 path，frontend 用就是了。
            `,
            sources: [
                [
                    "web/src/domains/clients/ObjectClientRenderer.tsx",
                    "resolveClientSource() 调 backend /api/objects/:scope/:id/client-source-url 拿 absPath/fsUrl；clientAbsPath 自拼逻辑已删除。",
                ],
            ],
        },
        "write-boundary": {
            title: "写入边界（invariant）：仅 stones/{objectId}/knowledge/**",
            content: `
            world / flows 树始终只读浏览。只有命中
            \`stones/{objectId}/knowledge/**\` 的文件会进入可编辑模式，并通过 stones
            knowledge API 保存。

            动机：保持 "client 是控制面，不是任意文件编辑器" 的边界——避免 UI 成为
            旁路绕过 server 策略校验、绕开 stone server method 的写入口。
            `,
        },
        "state-model": {
            title: "当前前端状态模型：URL 是导航源，本地 useState 只缓存数据",
            content: `
            导航维度（scope / sessionId / objectId / threadId / path）**全部从 URL 派生**：
            \`AppShell\` 用 \`useRouteState()\`（\`web/src/app/routing.ts\`）取当前
            \`RouteState\`，再经 \`scopeOf\` / \`derivePathFromRoute\` 等纯函数派生出
            下游需要的导航变量。所有点击 / 切换 handler 都走 \`navigate(toPath(...))\`，
            不再 \`setState\` 改导航字段。

            本地 \`useState\` 现在只承担两类职责：
            1. **数据缓存** —— 拉下来的 tree / thread / flows / stones / activeFile，
               以及对应的 \`hash\`（用于 4s 轮询做 no-op 短路）。
            2. **transient UI** —— 表单 draft、modal open、pauseBusy、showSessions 等
               不需要进 URL 的临时态。

            这意味着浏览器前进/后退、刷新、URL 复制粘贴都能恢复页面；深链接（直接
            打开 \`/flows/:sid/threads/:obj/:tid\`）也可用。
            `,
            todo: [
                "transient UI 中的 showSessions 仍由 useEffect 副作用驱动，未来若再加一类持久 UI 状态（如 sidebar 折叠），建议直接写进 URL search params 而非 useState。",
            ],
        },
        "design-principles": {
            title: "设计原则",
            content: `
            1. **UI 是状态的解释器，不是状态源**
               - client 不自行发明 "消息列表" / "tool 输出" / "pause 开关" 等第二状态。
               - 只把 world / thread / runtime 中已经存在的状态翻译成更适合人读的界面。

            2. **先归一化，再展示**
               - thread 原始事件种类很多，直接在组件里 if/else 会迅速失控。
               - 先在 formatter 中把原始事件压平成稳定的 ChatLine 联合类型，再交给
                 TuiBlock 等组件渲染。

            3. **观测优先于装饰**
               - llm.input.json / loop_*.input.json viewer、tool card、notice card、
                 pause/debug 控制面，核心都不是 "更好看"，而是让人更快定位：这轮输入
                 了什么、模型决定了什么、哪些输出尚未执行、系统当前是否暂停 / 可观测。

            4. **前后端共享同一语义**
               - session pause、global pause、debug status 统一从 app server API 暴露；
                 client 只消费这些语义，不维护平行实现，避免 "UI 看起来打开了，但
                 runtime 实际没开" 的双重真相。
               - chat 走 cross-object talk 的同一套 talk_window 契约，没有"前端专用消息"。

            5. **渐进替换旧 UI，而不是一次性重写**
               - 通过 Welcome 拆分、SessionCreator 重构、MainLogo 对齐旧视觉语义、
                 chat block 小步压缩 header、引入 react-router 替代单页 useState 等
                 方式，逐步收敛设计。
            `,
        },
        "non-goals": {
            title: "明确不做的事（旧 Web 未迁移）",
            content: `
            当前 client **不**迁移以下旧 Web 能力：
            - Kanban、Issue、Task 视图。
            - SSE 实时事件流（统一改用 polling-job + 4s thread 轮询）。
            - Command Palette。
            - 复杂的 FlowData 聚合模型。
            - 旧 \`/api/talk/:target\` 兼容层（cross-object talk 走新版 \`/api/sessions\`
              + \`/api/flows/:sid/continue\`）。

            这些是显式裁剪，不是"还没做"。除非控制面定位升级，否则不应回填。
            `,
        },
        "startup": {
            title: "启动方式（本地 dev）",
            content: `
            1. 启动后端 app server，指向要浏览和操作的 world 目录：

               \`\`\`bash
               bun --env-file=.env src/app/server/index.ts --world ./.ooc-world
               \`\`\`

               后端默认监听 3000 端口（环境变量名为 \`OOC_APP_PORT\`，不是
               \`OOC_PORT\`），通过 \`/api\` 暴露 stones、flows、runtime 与 tree/file
               读取接口。

            2. 启动前端 Web dev server。**必须传 \`OOC_WORLD_DIR\`，与 backend 的
               \`--world\` 指同一目录**：

               \`\`\`bash
               cd web
               bun install
               OOC_WORLD_DIR=../.ooc-world bun run dev
               \`\`\`

               vite 在 \`web/vite.config.ts\` 启动期若没读到 \`OOC_WORLD_DIR\` 会直接
               \`throw\`（fail-loud；防止 \`ObjectClientRenderer\` 静默指错目录导致
               头号 debug 黑洞）。worldRoot 会被 \`server.fs.allow\` 加入白名单，并
               作为 \`__OOC_WORLD_ROOT__\` 注入到 client。Vite dev server 把 \`/api\`
               请求代理到 \`http://127.0.0.1:3000\`，因此本地开发时需要先启动后端。

            3. 构建前端静态产物：

               \`\`\`bash
               cd web
               bun run build
               \`\`\`
            `,
            warnings: [
                "启动 app server 必须显式传 --world ./.ooc-world，否则 config.ts 会回退到 process.cwd() 把源码目录当 world，污染源码树。",
                "启动 web dev server 必须显式传 OOC_WORLD_DIR；vite.config.ts 缺时直接 throw，不会回退到任何默认值。",
            ],
        },
        "local-debugging": {
            title: "本地联调补充：404 不一定是代码缺失",
            content: `
            控制面 API 的 "404 但不是全部 404" 在本地开发时未必是代码没写进去，也可
            能是 **旧 server 进程还活着**。

            典型症状：
            - \`GET /api/health\` 正常。
            - 某些旧路由也正常。
            - 但新加的路由（例如 \`GET /api/runtime/debug/status\`）返回 404。

            通常说明当前端口上有多个 bun server 竞争或残留，实际收到请求的是旧实例；
            旧实例的路由表没有最新变更，于是看起来像 "新接口不存在"。

            排查原则：
            - 先看端口监听：\`lsof -nP -iTCP:3000 -sTCP:LISTEN\`。
            - 若发现多个监听进程，先清理旧进程，再启动新的 app server。
            - 不要只看 health 是否可用；要直接探测新增控制面路由本身。

            另外，app server 读取的端口环境变量是 \`OOC_APP_PORT\`，不是 \`OOC_PORT\`。
            若切端口后服务仍然起在 3000，应优先检查这里的环境变量名是否写对。

            背后的原则：**控制面调试要先确认 "你打到的是不是你以为的那个进程"**。
            `,
        },
    },
};
