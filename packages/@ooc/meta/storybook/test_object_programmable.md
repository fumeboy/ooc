# Test Case: Object Programmable Capability

**ID**: TC-PROG-001
**Capability**: Programmable — Object 自定义方法
**Doc**: `meta/object.doc.ts` > executable 维度
**Design**: `world-core-interface-and-hot-reload.md` §2 (stone executable/index.ts) + §3 (StoneDevelopment API)

## Objective

验证 OOC Object 能通过 `executable/index.ts` 定义自定义方法，方法通过 HTTP API 被外部调用，且方法执行时能拿到自己的 stone 目录路径（ctx.self.dir）和 thread 上下文。

这是 Object "programmable" 能力的核心：Object 不是框架写死的，它的行为由它自己的源码定义。

## Preconditions

1. 一个运行中的 OOC World（backend + HTTP server）
2. World 内 stones/ 下有一个待测试的 Object（通过 `POST /api/stones` 动态创建）

## Test Cases

### TC-PROG-01: 定义 ui_methods 并通过 HTTP 调用

| Step | Action | Expected |
|------|--------|----------|
| 1 | `POST /api/stones` 创建 Object `echo_agent` | 200, `{ created: true }` |
| 2 | 写入 `stones/main/objects/echo_agent/executable/index.ts`，导出 `ui_methods: { echo: { fn: (ctx, args) => ({ youSaid: args.text }) } }` | 文件写入成功 |
| 3 | `POST /api/stones/echo_agent/call_method` body `{ method: "echo", args: { text: "hello" } }` | 200, `{ returnValue: { youSaid: "hello" } }` |

### TC-PROG-02: 方法能拿到 ctx.self.dir（自己的 stone 目录路径）

| Step | Action | Expected |
|------|--------|----------|
| 1 | Object `dir_checker` 的 executable 导出方法：`fn: (ctx) => ({ myDir: ctx.self.dir })` | — |
| 2 | `POST /api/stones/dir_checker/call_method` body `{ method: "getMyDir" }` | `returnValue.myDir` 结尾于 `stones/main/objects/dir_checker`（versioning 布局）或 `stones/dir_checker`（flat 布局）|
| 3 | 验证返回路径是真实存在的目录 | `fs.stat` 返回 isDirectory=true |

### TC-PROG-03: window.commands（LLM 路径下的自定义命令）在 loader 中可被加载

| Step | Action | Expected |
|------|--------|----------|
| 1 | Object 导出 `window: { commands: { greet: { paths: ["greet"], match: () => ["greet"], exec: async (ctx) => ({ reply: "hi" }) } } }` | — |
| 2 | 通过 `loadObjectWindow(stoneRef)` 加载 | 返回值包含 `commands.greet` 定义 |
| 3 | `commands.greet.paths` 包含 `"greet"` | true |

### TC-PROG-04: 热更新 — 修改 executable 代码后新方法立即生效

| Step | Action | Expected |
|------|--------|----------|
| 1 | Object `hot_prog` 初始导出方法 `ping: { fn: () => "v1" }` | `call_method("ping")` → `"v1"` |
| 2 | 修改 executable/index.ts，改为 `ping: { fn: () => "v2" }`，新增 `pong: { fn: () => "pong" }` | 文件保存成功 |
| 3 | 等待 hot-reload debounce（≥100ms）后，再次 `call_method("ping")` | 返回 `"v2"` |
| 4 | `call_method("pong")` | 返回 `"pong"`（新方法已注册） |
