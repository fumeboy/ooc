import { meta_v20260506_1 } from "@meta/index.doc";

/**
 * 迭代历史 — 按时间线追溯本项目从空到能跑 ReAct 闭环的全部主题。
 *
 * 每个节点对应"一个有明确产出的设计/实现循环"，物理上落在
 * docs/superpowers/specs/ 与 docs/superpowers/plans/ 下的同名文件。
 *
 * 此文件只描述"做了什么、为什么做、对应的 spec/plan 在哪"，
 * 不重复每次迭代的具体实施细节——细节去 spec/plan 看。
 */
export const iteration_v20260511_1 = {
  parent: meta_v20260506_1,
  index: `
ooc-2 迭代历史

每个迭代必须满足最小契约：
1. 一个明确目的（要让系统获得什么新能力 / 解决什么具体问题）
2. 一份文档（spec 或 plan，至少之一）
3. 一组提交（每个 commit 一个原子改动）
4. 验证（单元测试新增 / 已有测试不退化 / tsc clean）

阶段不是预先规划的，是事后回看的标签——为了让"还差什么"在一眼能看清。

\`\`\`
ooc-2  (2026-05-08 ~ 2026-05-12)
│
├── 阶段 1：thinkable 骨架 — 让 LLM 接得通、tool 调得到
│   ├── [2026-05-08] thinkable-llm-client          统一 LLM client（OpenAI + Claude 双 provider，按 OOC_PROVIDER 切换）
│   │   ├── spec: docs/superpowers/specs/2026-05-08-thinkable-llm-client-design.md
│   │   └── plan: docs/superpowers/plans/2026-05-08-thinkable-llm-client.md
│   ├── [2026-05-08] thinkloop-tool-call           ThinkLoop 工具调用骨架（5 原语 + form 三阶段）
│   │   ├── spec: docs/superpowers/specs/2026-05-08-thinkloop-tool-call-design.md
│   │   └── plan: docs/superpowers/plans/2026-05-08-think-tool-call.md
│   └── [2026-05-09] thinkloop-real-verification   真 LLM 验证骨架，确认 provider 通路
│       └── plan: docs/superpowers/plans/2026-05-09-thinkloop-real-verification.md
│
├── 阶段 2：context 与多线程 — 让 Object 能在内部派生协作
│   ├── [2026-05-09] build-context-inbox-outbox    Context 渲染加 inbox/outbox + activeForms
│   │   └── plan: docs/superpowers/plans/2026-05-09-build-context-inbox-outbox.md
│   ├── [2026-05-09] thread-tree-do-core           线程树 + do.fork/continue 派生子线程
│   │   └── plan: docs/superpowers/plans/2026-05-09-thread-tree-do-core.md
│   └── [2026-05-09] todo-command-unification      todo 收敛到 form 生命周期，不再有独立 todos 窗口
│       └── plan: docs/superpowers/plans/2026-05-09-todo-command-unification.md
│
├── 阶段 3：单 object 闭环 — 让运行态可落盘可观测
│   ├── [2026-05-10] current-thinkable-doc-alignment   meta doc.js 与现有源码对齐，消除孤儿
│   │   └── plan: docs/superpowers/plans/2026-05-10-current-thinkable-doc-alignment.md
│   └── [2026-05-10] single-object-core-implementation persistable 落 thread.json + observable 落 llm.input/output.json + scheduler 集成
│       └── plan: docs/superpowers/plans/2026-05-10-single-object-core-implementation.md
│
├── 阶段 4：可用执行 + 真 LLM 验证 — 让 Agent 真能对外做事
│   └── [2026-05-10] executable-completion          Form 三段生命周期(open→executing→executed→close) + program.shell + do.continue+wait + 9 个真 LLM 集成测试
│       ├── spec: docs/superpowers/specs/2026-05-10-executable-completion-design.md
│       └── plan: docs/superpowers/plans/2026-05-10-executable-completion.md
│
├── 阶段 5：元编程 + stone 持久化 — 让 Object 能给自己写方法、保留身份
│   └── [2026-05-11] stone-server-meta-programming  stone 全套持久化(.stone.json/self.md/readme.md/data.json/server/index.ts) + program.ts/js(in-process dynamic import) + program.function(callMethod) + ProgramSelf(callMethod/getData/setData) + 元编程 knowledge + 真 LLM 集成测试
│       ├── spec: docs/superpowers/specs/2026-05-11-stone-server-meta-programming-design.md
│       ├── plan: docs/superpowers/plans/2026-05-11-stone-server-meta-programming.md
│       ├── 后续微调：method 注册支持可选 \`knowledge(args) → text\`（同 command.match 设计，基于当前 args 动态派生知识文本）；缺省回退到由 description+params 自动生成的基线文本；form 渲染段为 \`<method_knowledge>\`
│       └── 工程沉淀：meta/engineering/integration-tests.doc.js 记录 11 个真 LLM 集成测试（含 multi-round-multitask long-horizon 压力测试）+ 5 个由真 LLM 触发并修复的 bug 历史
│
├── 阶段 6：observable debug + form 协议增强 — 让"为什么 Agent 走偏"可定位 + 让 Agent 不再走偏
│   └── [2026-05-11] observable-debug-and-form-protocol  observable 增加 debug mode + \`loop_NNN.{input,output,meta}.json\` 落盘；form 渲染加 \`<next_action>\` / \`<protocol_hint>\`；program 缺参时返回可操作纠偏提示；submit/refine/open 文档与 schema 明确"只在 refine/open 填业务参数，submit 不接受新参数"
│       ├── spec: docs/superpowers/specs/2026-05-11-observable-debug-and-form-protocol-design.md
│       ├── plan: docs/superpowers/plans/2026-05-11-observable-debug-and-form-protocol.md
│       └── 回归记录: meta/engineering/test/2026-05-11-meta-programming-regression-test.md
│
├── 阶段 7：app-server 控制面 — 把 OOC 内核暴露为 HTTP API + 可恢复 worker
│   └── [2026-05-11] app-server-elysia-control-plane  src/app/server 基于 Elysia 的控制面：health/runtime/stones/flows 4 模块 23 个 API；jobManager + pauseStore + worker + resumePausedThread；meta/app 文档树
│       ├── spec(主体): docs/superpowers/specs/2026-05-11-app-server-elysia-control-plane-design.md
│       ├── plan(主体): docs/superpowers/plans/2026-05-11-app-server-elysia-control-plane.md
│       ├── spec(测试+文档): docs/superpowers/specs/2026-05-11-app-server-testing-and-docs-design.md
│       ├── plan(测试+文档): docs/superpowers/plans/2026-05-11-app-server-testing-and-docs.md
│       ├── 工程沉淀: meta/engineering/test/2026-05-11-app-server-control-plane-result-and-todo.md
│       └── 已记录的 6 项 TODO（见上述报告）：执行 meta 循环引用修复 / 集成测试稳定性 / call_method 错误映射 / runtime debug 控制器测试 / worker 可恢复 / flows.resume 入队
│
└── 阶段 8：knowledge 模块 — 让 Object 能在 context 中按需看到自己的知识库
    └── [2026-05-12] knowledge-module  parser + loader(mtime cache 热重载) + activator(命令路径相交) + context 渲染(\`<active_knowledge>\`) + 手动 pin/unpin(open/close type=knowledge)
        ├── spec: docs/superpowers/specs/2026-05-12-knowledge-module-design.md
        ├── plan: docs/superpowers/plans/2026-05-12-knowledge-module.md
        └── 关键决策：懒求值（无 thread 派生状态字段）+ 单篇 8KB / 总数 20 项渲染上限 + 删 thread.activatedKnowledge 字段（违反 SSoT）+ js-yaml 依赖
\`\`\`

## 阶段划分判据

- **阶段 1 完成标志**：能写一行 prompt，看到 LLM 用 tool 调用回复，没有 mock
- **阶段 2 完成标志**：父子线程之间通过 inbox/outbox 协作，scheduler 公平选下一个 running thread
- **阶段 3 完成标志**：杀进程重启后能从磁盘恢复线程态；任意时刻能从 llm.input/output.json 复盘上一轮 LLM 视角
- **阶段 4 完成标志**：跑 \`bun --env-file=.env test tests/integration\` 9 个端到端场景全部 PASS（真 LLM 真 shell 真持久化）
- **阶段 5 完成标志**：Agent 能用 program.shell 写 \`<self.dir>/server/index.ts\` 注册新方法 → 立即用 program.function 调用 → 看到结果；stone 全套目录骨架可创建，5 个核心文件可读写
- **阶段 6 完成标志**：开 debug mode 后每轮 LLM 调用都有 \`loop_NNN.{input,output,meta}.json\` 落盘；Agent 的 program form 不再"把 language/code 写进 description"或"空 submit"
- **阶段 7 完成标志**：HTTP \`POST /api/stones\` 创建对象、\`PATCH /api/stones/:id/data\` 写数据、\`POST /api/flows/:sid/objects\` 起 session、\`POST /api/stones/:id/call_method\` 调方法全部端到端可用；\`RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts\` 通过
- **阶段 8 完成标志**：在 stone/{objectId}/knowledge/ 放一篇 .md 含 \`activates_on.show_content_when=[program.shell]\` → Agent 一旦 open program 含 program.shell 路径 → 下一轮 system context 中 \`<active_knowledge>\` 段含该篇全文；Agent 编辑 .md 后下一轮 think 立即生效

## 后续阶段（未启动）

- **阶段 9**：跨 object talk + 全 stone 数据合并（让多 object session 协作）
- **阶段 10**：reflectable + super flow（让 Object 通过 super flow 持续反思、沉淀 memory）
- **阶段 11**：跨线程 knowledge 继承 + kernel built-in knowledge + flow 第二来源
- **阶段 12**：UI / client / 与人协作（与 observable/pause 联动，做可视化 + 介入）

后续阶段都不在当前主分支范围。每启动一个新阶段，都先在本文件追加一个新节点，然后再写 spec → plan → 实施。
`,
};
