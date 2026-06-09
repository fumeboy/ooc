# Test Case: Object Visible Capability

**ID**: TC-VIS-001
**Capability**: Visible — Object 自定义 UI 组件
**Doc**: `meta/object.doc.ts` > visible 维度
**Design**: `world-core-interface-and-hot-reload.md` §2 (stone visible/index.tsx) + §6.1 (view 热更新) + §7.3 (前端不泄露 executable)

## Objective

验证 OOC Object 能通过 `visible/index.tsx` 定义自己的 UI 组件：
- 前端通过 API 发现组件入口
- Vite dev server 能正确 serve + HMR 组件
- 组件能通过 props.callMethod 调自己的 executable 方法（UI↔行为闭环）
- executable/ 等非 visible 路径不能被前端访问（安全边界）

## Preconditions

1. 运行中的 OOC World（backend port B, Vite dev server port V）
2. 已创建的 target stone

## Test Cases

### TC-VIS-01: client-source-url API 返回正确路径

| Step | Action | Expected |
|------|--------|----------|
| 1 | 创建 stone `ui_demo` | 200 |
| 2 | 写入 `stones/main/objects/ui_demo/visible/index.tsx` 内容 `"export default () => null"` | 文件存在 |
| 3 | `GET /api/objects/stone/ui_demo/client-source-url` | 200, `{ absPath: ".../stones/main/objects/ui_demo/visible/index.tsx", fsUrl: "/@fs.../visible/index.tsx" }` |
| 4 | absPath 指向真实存在的文件 | `fs.stat` 成功 |

### TC-VIS-02: Vite 能 serve /@fs/ 路径下的 stone visible 组件

| Step | Action | Expected |
|------|--------|----------|
| 1 | Vite server `GET /@fs/<absPath>`，absPath 是 visible/index.tsx 的绝对路径 | HTTP 200 |
| 2 | 响应 body 包含 `"export default"` 或等价的 Vite-transformed module code | 非空、可解析 |

### TC-VIS-03: Vite 拒绝 serve stone 的 executable 路径（§7.3 安全边界）

| Step | Action | Expected |
|------|--------|----------|
| 1 | stone 存在 executable/index.ts | — |
| 2 | Vite server `GET /@fs/<absPath>`，absPath 是 executable/index.ts 的绝对路径 | HTTP 403，body 含 "Forbidden" |
| 3 | stone 的 knowledge 文件同样被拒 | HTTP 403 |

### TC-VIS-04: Vite HMR — 修改 visible/index.tsx 后模块内容更新

| Step | Action | Expected |
|------|--------|----------|
| 1 | visible/index.tsx 初始为 `"export default () => 'v1'"` | Vite GET 返回含 v1 的模块 |
| 2 | 修改文件为 `"export default () => 'v2'"` | 保存成功 |
| 3 | 等 500ms 后 Vite 再次 GET | 返回含 v2 的模块（HMR 已使缓存失效） |

### TC-VIS-05: UI↔行为闭环 — visible 组件能通过 callMethod 调自己的 executable

| Step | Action | Expected |
|------|--------|----------|
| 1 | stone 定义 executable 方法 `greet: { fn: (ctx, args) => ({ hello: args.name }) }` | — |
| 2 | stone 定义 visible 组件导出，接受 props `{ callMethod }` | — |
| 3 | 前端 ObjectClientRenderer 加载组件并渲染 | 组件被渲染（不抛错） |
| 4 | 组件内部调 `props.callMethod("greet", { name: "ooc" })` | 返回 `{ hello: "ooc" }`（通过 HTTP call_method 实际执行）|

注：TC-VIS-05 是浏览器端场景，当前验证环境下用"props 结构正确 + callMethod 端点单独验证"替代真实渲染。
