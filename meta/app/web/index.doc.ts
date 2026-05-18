/**
 * AppWeb — OOC app 层最小 Web 控制面。
 *
 * 此文档节点不携带 sources（前端代码尚未与 meta 树绑定），仅作为 app 子树下的
 * 章节描述存在。
 */
export const app_web_v20260513_1 = {
  title: "AppWeb",
  content: `
web 是 OOC app 层的浏览与人工操作入口。

职责边界：
- web 不拥有核心业务状态；核心状态仍落在 world 的 flows / stones 文件结构中
- web 通过 app server API 读取目录树、文件内容、stones、flows，并复用
  flows/runtime API 创建与继续 root thread chat
- 当前最小控制面闭环：flows / stones / world 浏览、session 创建、初始消息、
  继续 chat、stone 创建、knowledge 目录/文件创建、knowledge 文件编辑保存，
  以及针对 \`llm.input.json\` / \`loop_*.input.json\` 的结构化调试视图
- 主动不迁移旧 Web 的 Kanban、Issue、Task、SSE 实时事件、Command Palette、
  复杂 FlowData 聚合模型和旧 \`/api/talk/:target\` 兼容层

实现入口：
- 前端：\`web/src/app\`、\`web/src/domains\`、\`web/src/transport\`、\`web/src/shared\`
- 服务端支撑：\`src/app/server/modules/ui\`，以及 flows / runtime / stones 提供的
  list / create / continue / pause / debug / knowledge 写入能力
  `.trim(),

  stateModel: {
    title: "当前前端状态模型",
    summary: "AppShell 本地 useState；无 router / URL state / 全局 store",
    content: `
- 当前 Web 没有 router / URL state / 全局 store；页面状态主要集中在 AppShell
  的本地 \`useState\` 中
- 这意味着当前控制面更接近"单页工作台"，刷新页面后不会自动恢复 scope /
  activeSessionId / activeObjectId / activeFile / thread 等本地选择
- 应理解为"最小人工控制面"，而不是已经稳定支持深链接、可分享页面状态的正式
  产品化 UI
    `.trim(),
  },

  consumedApi: {
    title: "当前实际消费的 API 子集",
    summary: "web 只消费 server 暴露能力的一个较小子集",
    content: `
当前 web 实际消费：
- **flows**：list / create session / create flow object / get root thread /
  continue root thread / pause / resume
- **ui**：tree / file
- **stones**：list / create stone / create knowledge directory / create knowledge
  file / update knowledge file
- **runtime**：job status、global pause status & toggle、debug status & toggle

当前 web **没有**直接消费：
- runtime llm-config / jobs list / latest debug / loop debug
- flows / stones 的 call_method
- stone self/readme/data/server-source 读写
    `.trim(),
  },

  writeBoundary: {
    kind: "invariant",
    title: "写入边界：仅 stones/{objectId}/knowledge/**",
    summary: "world / flows 树仍是只读浏览；其他文件不可经 web 编辑",
    content: `
- world 与 flows 树仍然只读浏览
- 只有命中 \`stones/{objectId}/knowledge/**\` 的文件会进入可编辑模式，并通过
  stones knowledge API 保存
    `.trim(),
    rationale: `
保持"web 是控制面，不是任意文件编辑器"的边界——避免 UI 成为旁路绕过 server
策略校验、绕开 stone server method 的写入口。
    `.trim(),
  },

  fileViewer: {
    title: "文件查看器",
    summary: "通用预览 + llm.input.json / loop_*.input.json 专用 viewer + 任意路径文件预览",
    content: `
- 普通文本、JSON、Markdown 沿用通用 CodeMirror 预览
- 当打开 \`llm.input.json\` 或 \`loop_*.input.json\` 时，
  \`web/src/domains/files/components/FileViewer.tsx\` 会切换到专用 viewer：
  - 左侧按 input item 展示 message / function_call / function_call_output / reasoning
  - 对 system message 中的 XML context 继续拆成树形节点与详情面板，便于直接
    查看 context / thread / active_forms / active_knowledge / windows / inbox
    等结构
  - viewer 还会展示 XML attrs / comments、字符数与粗略 token 估算
  - 若 JSON 解析失败，则回退原始只读 JSON 视图
- 目标不是编辑 debug 文件，而是降低人工排查 LLM 输入时的阅读成本

注意：debug viewer 当前**不是**走 runtime debug 文件 HTTP API，而是仍然通过
\`/api/tree/file\` 读取 world 里的 debug JSON 文件，再在前端按路径切换 viewer。

任意路径文件预览：
- 新增 \`GET /api/file/read?path=&maxBytes=\` 不受 world 隔离的只读 endpoint
  （\`src/app/server/modules/ui/api.read-any-file.ts\`），用于服务 file_window
  详情面板的内容预览（file_window.path 通常是绝对路径，不在 \`--world\` 内）
- 256KB 软上限，超出标 \`truncated\`；仅本地 dev 场景使用，公开部署需再加策略层
- 前端通过 \`fetchAnyFile(path)\` 消费，\`.md\` / \`.markdown\` 走 MarkdownContent
  渲染，其它扩展名走 CodeMirror 语法高亮
    `.trim(),
  },

  contextWindowViewer: {
    title: "ContextSnapshotViewer：thread context 可视化",
    summary: "左树 + 右详情；按 type 分组；file/edit/program/diff/markdown 增强；events 默认折叠",
    content: `
\`ContextSnapshotViewer\` 把后端 \`ContextSnapshot\`（与 \`thread.json\` 同 shape）
渲染成结构化的左树 + 右详情面板，是排查 thread 状态的主要入口。两处使用：
1. \`FileViewer\` 在选了 session 但未选文件时直接展示 thread context
2. \`LLMInputJsonViewer\` 在新版 \`llm.input.json\` 中替代 system message XML 子树

**左树组织：**
- thread 根节点对用户隐藏（已经在 viewer header 显示 thread id 了，重复无用）；
  TreeNode 用 \`depthOffset=1\` 让 children 表现为 depth=0 顶层
- top-level windows **按 type 分组**（root / command_exec / do / talk / todo /
  program / file / knowledge / search），组内按 \`createdAt\` 升序，避免 15+ 个
  混杂 window 难以扫读
- events section **默认折叠**（\`collectInitialExpandedIds\` 不把 events section
  自身加进展开集，children 自然不渲染），避免 100+ 条 llm_interaction /
  tool_runtime 事件淹没视图

**右详情按 window type 增强：**
- **file_window** 调 \`FileWindowContentView\` 实时 fetch 文件内容，按 lines /
  columns 切片显示；\`.md\` 走 MarkdownContent，其它走 CodeMirror
- **command_exec(command=edit)** 把 \`accumulatedArgs.{old,new}\` 渲染为
  \`@codemirror/merge\` 的 unifiedMergeView 红绿 diff；\`edits[]\` 多条按顺序展示
- **command_exec(command=write_file)** 把 content 单独成大段预览
- **program** 详情平铺 history（lang / status / time + 首行 code），最后一次
  完整展开 code+args+output，前面 output 截断 200 字预览
- **knowledge** body 走 MarkdownContent，与 file_window 一致
- **command_exec.result** 按 success/error 加色调

**transcript / message 展示 fromObjectId：**
- 后端 \`ThreadMessage\` 增加可选 \`fromObjectId\`（由 \`talk-delivery\` 写入）
- 前端三处（左树 message label / 右侧 transcript dir / message detail header）
  都改成 \`<obj> · <thread>\` 双字段显示，让对端身份一目了然

**跨组件导航：**
- \`web/src/domains/files/navigation-events.ts\` 提供 CustomEvent 总线
  \`dispatchNavigateToWindow(windowId)\` / \`subscribeNavigateToWindow(handler)\`
- ContextSnapshotViewer 订阅后会展开目标节点的祖先链 + smooth scrollIntoView
  + select；TreeNode row 元素带 \`data-cw-node-id\` 便于定位
- TuiBlock 中 \`WindowLinkRow\` 从 tool call 的 \`rawOutput.window_id / form_id\`
  → \`rawArguments\` → \`wait.on\` 顺序提取目标 id，渲染 "view in context tree" 按钮
    `.trim(),
  },

  chatTimelineEnhancements: {
    title: "chat 时间线显示增强",
    summary: "sender label / outbox-to-user 穿插 / tool ok 校正 / window 跳转",
    content: `
在原"message | tool | notice 三元模型"基础上的增量改进，都集中在
\`web/src/domains/chat/formatter.ts\` 与 \`TuiBlock.tsx\`：

- **inbox 消息按 source / fromObjectId 显示真实标签** —
  原来 \`inbox_message_arrived\` 全部硬编码 \`role: "user"\`，多 object talk 场景
  下完全错位。\`senderLabel\` 现按 \`fromObjectId\` 优先（\`<obj> · <thread>\`），
  fallback \`source\`（\`user\` / \`system\` / \`talk · <thread>\`），再 fallback
  \`fromThreadId\`
- **tool ok/fail 优先用 output JSON 的 ok 字段** —
  \`deriveOk(outputValue, eventOk)\`：JSON.parse output，取里面的 \`ok\`；
  无法解析时退回 \`event.ok\`。这覆盖了后端 \`thinkloop\` 老版本硬写 \`ok:true\`
  留下的旧 thread 数据，让 refine 拦截错误能正确显示红色 fail 徽章
- **assistant→user 的回信穿插到时间线** —
  当 \`thread.creatorObjectId === "user"\` 时，从 \`thread.outbox\` 取所有
  \`windowId\` 对应 \`talk_window.target=user\` 的消息，按 createdAt 用游标在
  inbox events 之间穿插 push。否则 LLM 三段式 \`open(say) → refine(msg) →
  submit\` 的内容只落 outbox，events 里只有 tool call，timeline 上看不到对话
- **tool card 末尾的"view in context tree"按钮** —
  \`WindowLinkRow\` 从 tool 的 \`rawOutput.window_id / form_id\` → \`rawArguments\`
  → \`wait.on\` 顺序提取目标 id，点击 dispatch \`navigate-window\` 事件，
  ContextSnapshotViewer 自动展开父链 + scrollIntoView + select
    `.trim(),
  },

  routingNotes: {
    title: "路由细节",
    summary: "文件路径反推 sessionId 以保持侧栏在 flow tree 而非 session list",
    content: `
\`web/src/app/shell.tsx\` 派生 \`activeSessionId\` 时，除了
\`route.kind ∈ {session, thread, flowPage}\`，还会在 \`route.kind === "file"\` 且
路径以 \`flows/<sid>/...\` 开头时反推 sessionId。

这是为了避免一个原本误导的行为：用户在 flow 树里点开任意文件，路由变成
\`kind: "file"\`，\`activeSessionId\` 派生为 undefined → effect \`setShowSessions(true)\`
→ 侧栏从 file tree 翻回 session list。反推后浏览文件不再丢 session 上下文。
    `.trim(),
  },

  chatControlPlane: {
    title: "chat / session 控制面",
    summary: "polling-job、message/tool/notice 三元模型、root-thread-only",
    content: `
- 欢迎页与 session 创建表单已从主面板拆分；创建入口改为 shadcn 风格的
  Input / Select / Textarea / Button 组合
- create session / continue thread 的前端闭环不是 SSE，而是
  "发起动作 → 轮询 job → 再刷新 thread"；\`jobId\` 是 web 与 runtime 协作的一等契约
- 当前 job 轮询窗口有限：最多 20 次、每次 500ms，约 10 秒；超时后前端停止等待，
  但不视为硬错误
- flow object 创建时，只有带 \`initialMessage\` 才一定会得到 \`jobId\`；空初始消息
  只建 root thread，不自动跑模型
- chat 时间线先把事件归一成 \`message | tool | notice\` 三类显示模型：
  - 用户消息只在 \`inbox_message_arrived\` 事件出现时显示
  - \`function_call\` 与 \`function_call_output\` 按 callId 合并成一张 tool card
  - \`context_change.inject\` 改为提示卡（notice card），避免误看成用户对话
- message 渲染支持 Markdown；tool / notice header 收敛到单层 compact header
- chat composer 新增左右对称的 pause / send 操作位；session pause 状态通过
  flows/runtime API 驱动，而不是只做静态按钮
- 当前 web 是 **root-thread-only** 控制面：thread 查询与 continue 默认都固定走
  \`threadId="root"\`，右侧面板没有线程切换器
- 直接打开既有 session 时，UI 会先取 stones 列表中的第一个 object 作为默认聊天对象
- 左侧 MainLogo 已接上后端真实接口：
  - \`GET /api/health\` 探测 online / offline
  - \`GET|POST /api/runtime/global-pause/*\` 控制全局 pause
  - \`GET|POST /api/runtime/debug/*\` 控制 debug 开关
  MainLogo 按 10 秒间隔轮询；Logo 颜色编码状态：默认灰、pause 橙、debug 蓝、
  pause+debug 渐变
    `.trim(),
  },

  treeBoundary: {
    title: "tree / knowledge 边界",
    summary: "scope 切换并行重拉整树；非懒加载；knowledge 写入限定 stones 子路径",
    content: `
- 前端切换 scope 时，会并行重新拉取 flows、stones 和对应 scope 下的整棵 tree；
  不是按节点懒加载的 explorer
- flows scope 下，Sidebar 当前是"session list 与当前 session tree 二选一"的展示
  模型，而不是多 session 树同时常驻
- knowledge 的创建/编辑入口被严格限制在 \`stones/{objectId}/knowledge/**\`；
  world 其他文件与 flows 树仍是只读浏览
    `.trim(),
  },

  designPrinciples: {
    title: "设计原则",
    summary: "UI 是状态解释器；先归一再展示；观测优先；语义共享；渐进替换",
    content: `
1. **UI 是状态的解释器，不是状态源**
   - web 不自行发明"消息列表"/"tool 输出"/"pause 开关"等第二状态
   - 只把 world / thread / runtime 中已经存在的状态翻译成更适合人读的界面

2. **先归一化，再展示**
   - thread 原始事件种类很多，直接在组件里 if/else 会迅速失控
   - 先在 formatter 中把原始事件压平成稳定的 \`ChatLine\` 联合类型，
     再交给 TuiBlock 等组件渲染

3. **观测优先于装饰**
   - llm.input.json / loop_*.input.json viewer、tool card、notice card、
     pause/debug 控制面，核心都不是"更好看"，而是让人更快定位：这轮输入了什么、
     模型决定了什么、哪些输出尚未执行、系统当前是否暂停/可观测

4. **前后端共享同一语义**
   - session pause、global pause、debug status 统一从 app server API 暴露
   - web 只消费这些语义，不维护平行实现，避免"UI 看起来打开了，但 runtime
     实际没开"的双重真相

5. **渐进替换旧 UI，而不是一次性重写**
   - 通过 Welcome 拆分、SessionCreator 重构、MainLogo 对齐旧视觉语义、
     chat block 小步压缩 header 等方式，逐步收敛设计
    `.trim(),
  },

  startup: {
    kind: "example",
    title: "启动方式",
    content: `
1. 启动后端 app server，指向要浏览和操作的 world 目录：

   \`\`\`bash
   bun src/app/server/index.ts --world .ooc-world-test
   \`\`\`

   后端默认监听 3000 端口，通过 \`/api\` 暴露 stones、flows、runtime 与
   tree/file 读取接口。

2. 启动前端 Web dev server：

   \`\`\`bash
   cd web
   bun install
   bun run dev
   \`\`\`

   Vite dev server 把 \`/api\` 请求代理到 \`http://127.0.0.1:3000\`，因此本地开发
   时需要先启动后端。

3. 构建前端静态产物：

   \`\`\`bash
   cd web
   bun run build
   \`\`\`
    `.trim(),
  },
};
