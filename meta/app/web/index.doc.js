export const app_web_v20260513_1 = {
  index: `
web 是 OOC app 层的浏览与人工操作入口。

职责边界：

- web 不拥有核心业务状态；核心状态仍落在 world 的 flows / stones 文件结构中。
- web 通过 app server API 读取目录树、文件内容、stones、flows，并复用 flows/runtime API 创建与继续 root thread chat。
- 本轮 web 覆盖的最小控制面闭环已经包括：flows / stones / world 浏览、session 创建、初始消息、继续 chat、stone 创建、knowledge 目录/文件创建、knowledge 文件编辑保存，以及针对 \`llm.input.json\` / \`loop_*.input.json\` 的结构化调试视图。
- web 主动不迁移旧 Web 的 Kanban、Issue、Task、SSE 实时事件、Command Palette、复杂 FlowData 聚合模型和旧 /api/talk/:target 兼容层。

实现入口：

- 前端：web/src/app、web/src/domains、web/src/transport、web/src/shared。
- 服务端支撑：src/app/server/modules/ui，以及 src/app/server/modules/flows、runtime、stones 提供的 list / create / continue / pause / debug / knowledge 写入能力。

## 当前前端状态模型

- 当前 Web 没有 router / URL state / 全局 store；页面状态主要集中在 \`AppShell\` 的本地 \`useState\` 中。
- 这意味着当前控制面更接近“单页工作台”，刷新页面后不会自动恢复 \`scope / activeSessionId / activeObjectId / activeFile / thread\` 等本地选择状态。
- 文档上应把它理解为“最小人工控制面”，而不是已经稳定支持深链接、可分享页面状态的正式产品化 UI。

## 当前实际消费的 API 子集

虽然 server 暴露了更完整的 runtime / flows / stones 能力，但当前 web 实际只消费其中一个较小子集：

- flows：list / create session / create flow object / get root thread / continue root thread / pause / resume
- ui：tree / file
- stones：list / create stone / create knowledge directory / create knowledge file / update knowledge file
- runtime：job status、global pause status & toggle、debug status & toggle

当前 web **没有**直接消费：

- runtime \`llm-config\` / jobs list / latest debug / loop debug
- flows / stones 的 \`call_method\`
- stone \`self/readme/data/server-source\` 读写

当前写入边界：

- world 与 flows 树仍然只读浏览。
- 只有命中 \`stones/{objectId}/knowledge/**\` 的文件会进入可编辑模式，并通过 stones knowledge API 保存。
- 这保持了“web 是控制面，不是任意文件编辑器”的边界。

当前文件查看器能力补充：

- 普通文本、JSON、Markdown 仍沿用通用 CodeMirror 预览。
- 当打开 \`llm.input.json\` 或 \`loop_*.input.json\` 时，\`web/src/domains/files/components/FileViewer.tsx\` 会切换到专用 viewer：
  - 左侧按 input item 展示 message / function_call / function_call_output / reasoning。
  - 对 system message 中的 XML context 继续拆成树形节点与详情面板，便于直接查看 \`context\` / \`thread\` / \`active_forms\` / \`active_knowledge\` / \`windows\` / \`inbox\` 等结构。
  - viewer 还会展示 XML attrs / comments、字符数与粗略 token 估算；若 JSON 解析失败，则回退原始只读 JSON 视图。
  - 目标不是编辑 debug 文件，而是降低人工排查 LLM 输入时的阅读成本。

注意：这个 debug viewer 当前**不是**走 runtime debug 文件 HTTP API，而是仍然通过 \`/api/tree/file\` 读取 world 里的 debug JSON 文件，再在前端按路径切换 viewer。

当前 chat / session 控制面补充：

- 欢迎页与 session 创建表单已从主面板拆分；创建入口改为更接近 shadcn 风格的 Input / Select / Textarea / Button 组合，减少把布局和字段逻辑耦在单个面板中的做法。
- create session / continue thread 的前端闭环不是 SSE，而是“发起动作 → 轮询 job → 再刷新 thread”；因此 \`jobId\` 是 web 与 runtime 协作的一等契约。
- 当前 job 轮询窗口是有限的：最多轮询 20 次、每次 500ms，约 10 秒；超时后前端停止等待，但不把它当成硬错误。
- flow object 创建时，只有带 \`initialMessage\` 才一定会得到 \`jobId\`；空初始消息只建 root thread，不自动跑模型，web 已按这个约束兼容。
- chat 时间线不再直接按 thread inbox 粗暴平铺，而是先把事件归一成 \`message | tool | notice\` 三类显示模型：
  - 用户消息只在 \`inbox_message_arrived\` 事件出现时显示；
  - \`function_call\` 与 \`function_call_output\` 会按 \`callId\` 合并成一张 tool card；
  - \`context_change.inject\` 改为提示卡（notice card），避免把过程事件误看成用户对话。
- message 渲染支持 Markdown；tool / notice header 被压缩进卡片内部，并进一步收敛到单层 compact header。
- chat composer 新增左右对称的 pause / send 操作位；session pause 状态直接通过 flows/runtime API 驱动，而不是只做静态按钮。
- 当前 web 实际上是 **root-thread-only** 控制面：thread 查询与 continue 默认都固定走 \`threadId="root"\`，右侧面板也没有线程切换器。
- 直接打开既有 session 时，UI 会先取 stones 列表中的第一个 object 作为默认聊天对象，这是一条需要被文档显式说明的当前约束。
- 左侧 MainLogo 已直接接上后端真实接口：
  - \`GET /api/health\` 探测 online / offline；
  - \`GET|POST /api/runtime/global-pause/*\` 控制全局 pause；
  - \`GET|POST /api/runtime/debug/*\` 控制 debug 开关。
  MainLogo 会按 10 秒间隔定时轮询这些状态；同时 Logo 本体颜色也被当作状态编码：默认灰、pause 橙、debug 蓝、pause+debug 渐变。

## 当前 tree / knowledge 边界

- 前端切换 scope 时，会并行重新拉取 flows、stones 和对应 scope 下的整棵 tree；这不是按节点懒加载的 explorer。
- 在 flows scope 下，Sidebar 当前是“session list 与当前 session tree 二选一”的展示模型，而不是多 session 树同时常驻。
- knowledge 的创建/编辑入口被严格限制在 \`stones/{objectId}/knowledge/**\` 路径；world 其他文件与 flows 树仍是只读浏览。

## 这一轮背后的设计

1. **UI 是状态的解释器，不是状态源**
   - web 不自行发明“消息列表”“tool 输出”“pause 开关”这类第二状态；
   - 它只把 world / thread / runtime 中已经存在的状态翻译成更适合人读的界面。

2. **先归一化，再展示**
   - thread 原始事件种类很多，直接在组件里 if/else 会迅速失控；
   - 因此先在 formatter 中把原始事件压平成稳定的 \`ChatLine\` 联合类型，再交给 TuiBlock 等组件渲染。

3. **观测优先于装饰**
   - \`llm.input.json\` / \`loop_*.input.json\` viewer、tool card、notice card、本轮 pause/debug 控制面，核心都不是“更好看”，而是让人更快定位：这轮输入了什么、模型决定了什么、哪些输出尚未执行、系统当前是否暂停/可观测。

4. **前后端共享同一语义**
   - 比如 session pause、global pause、debug status，都统一从 app server API 暴露；
   - web 只消费这些语义，不维护平行实现，避免“UI 看起来打开了，但 runtime 实际没开”的双重真相。

5. **渐进替换旧 UI，而不是一次性重写**
   - 通过 Welcome 拆分、SessionCreator 重构、MainLogo 对齐旧视觉语义、chat block 小步压缩 header 等方式，逐步收敛设计，而不是整站大改后再回头补行为。

启动方式：

1. 启动后端 app server，指向要浏览和操作的 world 目录：

   bun src/app/server/index.ts --world .ooc-world-test

   后端默认监听 3000 端口，并通过 /api 暴露 stones、flows、runtime 与 tree/file 读取接口。

2. 启动前端 Web dev server：

   cd web
   bun install
   bun run dev

   Vite dev server 会把 /api 请求代理到 http://127.0.0.1:3000，因此本地开发时需要先启动后端。

3. 构建前端静态产物：

   cd web
   bun run build
`,
};
