export const app_web_v20260513_1 = {
  index: `
web 是 OOC app 层的浏览与人工操作入口。

职责边界：

- web 不拥有核心业务状态；核心状态仍落在 world 的 flows / stones 文件结构中。
- web 通过 app server API 读取目录树、文件内容、stones、flows，并复用 flows/runtime API 创建与继续 root thread chat。
- 本轮 web 只覆盖最小控制面闭环：flows / stones / world 浏览、session 创建、初始消息、继续 chat、文本文件查看，以及针对 \`llm.input.json\` 的结构化调试视图。
- web 主动不迁移旧 Web 的 Kanban、Issue、Task、SSE 实时事件、Command Palette、复杂 FlowData 聚合模型和旧 /api/talk/:target 兼容层。

实现入口：

- 前端：web/src/app、web/src/domains、web/src/transport、web/src/shared。
- 服务端支撑：src/app/server/modules/ui 以及 src/app/server/modules/flows 的 GET /api/flows 列表能力。

当前文件查看器能力补充：

- 普通文本、JSON、Markdown 仍沿用通用 CodeMirror 预览。
- 当打开 \`llm.input.json\` 时，\`web/src/domains/files/components/FileViewer.tsx\` 会切换到专用 viewer：
  - 左侧按 input item 展示 message / function_call / function_call_output / reasoning。
  - 对 system message 中的 XML context 继续拆成树形节点与详情面板，便于直接查看 \`context\` / \`thread\` / \`active_forms\` / \`active_knowledge\` / \`windows\` / \`inbox\` 等结构。
  - 目标不是编辑 debug 文件，而是降低人工排查 LLM 输入时的阅读成本。

当前 chat / session 控制面补充：

- 欢迎页与 session 创建表单已从主面板拆分；创建入口改为更接近 shadcn 风格的 Input / Select / Textarea / Button 组合，减少把布局和字段逻辑耦在单个面板中的做法。
- chat 时间线不再直接按 thread inbox 粗暴平铺，而是先把事件归一成 \`message | tool | notice\` 三类显示模型：
  - 用户消息只在 \`inbox_message_arrived\` 事件出现时显示；
  - \`function_call\` 与 \`function_call_output\` 会按 \`callId\` 合并成一张 tool card；
  - \`context_change.inject\` 改为提示卡（notice card），避免把过程事件误看成用户对话。
- message 渲染支持 Markdown；tool / notice header 被压缩进卡片内部，并进一步收敛到单层 compact header。
- chat composer 新增左右对称的 pause / send 操作位；session pause 状态直接通过 flows/runtime API 驱动，而不是只做静态按钮。
- 左侧 MainLogo 已直接接上后端真实接口：
  - \`GET /api/health\` 探测 online / offline；
  - \`GET|POST /api/runtime/global-pause/*\` 控制全局 pause；
  - \`GET|POST /api/runtime/debug/*\` 控制 debug 开关。
  同时 Logo 本体颜色也被当作状态编码：默认灰、pause 橙、debug 蓝、pause+debug 渐变。

## 这一轮背后的设计

1. **UI 是状态的解释器，不是状态源**
   - web 不自行发明“消息列表”“tool 输出”“pause 开关”这类第二状态；
   - 它只把 world / thread / runtime 中已经存在的状态翻译成更适合人读的界面。

2. **先归一化，再展示**
   - thread 原始事件种类很多，直接在组件里 if/else 会迅速失控；
   - 因此先在 formatter 中把原始事件压平成稳定的 \`ChatLine\` 联合类型，再交给 TuiBlock 等组件渲染。

3. **观测优先于装饰**
   - \`llm.input.json\` viewer、tool card、notice card、本轮 pause/debug 控制面，核心都不是“更好看”，而是让人更快定位：这轮输入了什么、模型决定了什么、哪些输出尚未执行、系统当前是否暂停/可观测。

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
