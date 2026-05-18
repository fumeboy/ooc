# Object Client 元编程闭环 plan

> **状态**：drafting
> **范围**：让 Object 能自己写 React 前端组件（`<dir>/client/index.tsx` 或 `<dir>/client/pages/{name}.tsx`），并由 web app 动态加载渲染
> **参考实现**：旧系统 `~/x/ooc/kernel/web/src/features/DynamicUI.tsx`（Vite `/@fs/` + 动态 import + Error Boundary）
> **不参考**：旧系统 `views/{viewName}/frontend.tsx` 命名 —— 新系统已在 `meta/object/executable/client/index.doc.js` 重新定义为 `client/index.tsx`（stone）/ `client/pages/{name}.tsx`（flow）
> **明确不照搬**：老系统渲染失败自动 talk 通知 Object 的 "self-healing" 设计 —— 见 §3 末尾

---

## 1. 目标

打通 client 侧元编程：Agent → `program.shell` / `write_file` 写 tsx → web 端
`ObjectClientRenderer` 立即拉起组件渲染，呼应已经闭环的 server 侧
（`program.shell` 写 `server/index.ts` → `program.function` 调用）。

**不**做的事：

- 不引新写盘原语；client tsx 完全复用现有 `write_file` / `file_window.edit`
- 不引新调用原语；client → server 通道走已经接通的
  `POST /api/stones/:id/call_method` + `POST /api/flows/:sid/objects/:id/call_method`
- 不做生产 build 形态的转译流水线（依赖 Vite dev server 的 `/@fs/`；prod build 形态不在本轮）
- 不做沙箱隔离 / CSP；与 server 侧 in-process 同档
- 不做多文件 bundle（首版只支持单文件 + `react` import；`components/` `lib/`
  子目录留到下一轮证伪后再扩）
- 不做"渲染失败自动 talk 通知 Object"的自愈循环（见 §3 末尾理由）

---

## 2. 既有约束（不能破坏）

1. **`meta/object/executable/client/index.doc.js` 已写明的契约**：
   - Stone：`<dir>/client/index.tsx`（单页入口，必备 default export）
   - Flow：`<dir>/client/pages/{pageName}.tsx`（多页）
   - props：`{ sessionId?, objectName?, callMethod? }`
   - 失败模式：404 → "信息待产出..."；加载/渲染错 → 红色错误块；ErrorBoundary 兜底
   - **注**：doc 原文里写了 "自动通知对象（通过 talk）请求修复"，本 plan 不实现该项 —— 落地后需要同步修订 doc 删掉该承诺
2. **持久化目录结构**：`createStoneObject` 已 `mkdir(clientDir(ref))`；flow 对象的
   `client/` 目录在 `writeClientSource` 里 `mkdir({ recursive: true })` 兜底，
   不动 `flow-object.ts`
3. **现有 HTTP `call_method` 端点**：路径 / body schema 已稳定，前端 callMethod
   闭包必须命中现有端点，不另开
4. **Vite proxy `/api`**：dev 时前端通过 5173 端口访问 `/api/*` 转发到 server
   `:3000`；本 plan 不动 proxy 配置
5. **不破坏 `meta-concept-graph` 三件套**：`client.doc.js` 现有
   `sources: { serverUi }` 锚点要替换成真正的 client loader 源码模块

---

## 3. 老 DynamicUI 关键点回顾

老实现 167 行，可移植部分：

| 机制 | 老实现做法 | 新系统照搬 |
|---|---|---|
| 跨边界 import | `import(/* @vite-ignore */ '/@fs/' + absPath)` | 同 |
| 世界根路径注入 | `__OOC_ROOT__` 由 Vite `define` 注入 | 改名 `__OOC_WORLD_ROOT__` |
| React.lazy + Suspense | 是 | 是 |
| Error Boundary | `UIErrorBoundary` 兜底防止白屏 | 同 |
| 404 vs 其它错 | 判 errorMsg 含 `404` / `Not Found` / `Failed to fetch` | 同 |
| callMethod 自动注入 | 当 sessionId+objectName 存在则闭包 | 同（但去掉 traitId 维度） |

不照搬：

- 老的 `@stones/` / `@flows/` 别名路径协议 → 新版直接收 `{ scope, sessionId?, objectId, page? }`
  结构化参数，内部拼绝对路径，不让上游构造字符串路径
- 老的 `views/{viewName}/frontend.tsx` 命名 → 改为 doc 已定义的 `client/index.tsx` / `client/pages/{name}.tsx`

### 关于"渲染失败自动 talk"为什么不照搬

老系统 Error Boundary 里调 `talkTo(objectName, "你的 View 加载失败...")`，把错误塞回 Object 的 inbox，想让 Object 自己 fix。看似自愈，实际有 4 个问题：

| 问题 | 说明 |
|---|---|
| 触发场景对不上 | Stone 没有 active session，talk 投进去没线程在跑，只会变成下次有人开 session 时撞见一堆旧堆栈 |
| 噪声放大 | 一个错误每次刷新都触发一次 talk —— 同样的堆栈被反复塞进 inbox |
| 责任错位 | 第一现场是浏览器里的人；Object 不一定是修这个 bug 的最佳主体 |
| 耦合非必要 | 渲染层不该知道 transport / talk 协议；它只需把错误显式地表现出来 |

**v1 决策**：只做"显式失败"。404 显示 "信息待产出..."；其它错显示红色块带完整堆栈和文件路径。用户看到后自行决定要不要把错误转发给 Object（cross-object talk 本来就是正常用法）。如后续真发现"手动转发太麻烦"，再加一个"通知 Object"按钮即可，不默认耦合。

---

## 4. 实施分层

### 层 1 — persistable（薄壳路径模块）

新增 `src/persistable/stone-client.ts`：

```ts
export function clientIndexFile(ref: StoneObjectRef): string  // <dir>/client/index.tsx
export function clientPagesDir(ref: StoneObjectRef): string   // <dir>/client/pages
export function clientPageFile(ref: StoneObjectRef, page: string): string
export async function readClientSource(ref, kind: "index" | { page: string }): Promise<string | undefined>
export async function writeClientSource(ref, kind, code: string): Promise<void>
```

约束：

- 平移 `stone-server.ts` 的写法（mkdir + writeFile + ENOENT 静默）
- `clientDir(ref)` 已在 `stone-object.ts:41` 存在，复用
- flow client 目录由 `writeClientSource` 内 `mkdir({ recursive: true })` 兜底，
  不动 `flow-object.ts`

`src/persistable/index.ts` 重新 export 上述函数。

**判据**：单测覆盖 read/write/ENOENT 路径；不引入新 ref 类型。

---

### 层 2 — backend：world 根路径暴露

backend 不需要做转译。但 web 要拿到 world 根的绝对路径才能拼 `/@fs/...`。

方案：

- 在启动 web dev server 之前由脚本读取 backend 的 `OOC_WORLD_DIR`（或同名 env），
  把它作为 `OOC_WORLD_ROOT` 环境变量传给 Vite
- `web/vite.config.ts` 在 `define` 里把它常量化为 `__OOC_WORLD_ROOT__`：

```ts
const worldRoot = process.env.OOC_WORLD_ROOT;
if (!worldRoot) throw new Error("OOC_WORLD_ROOT not set; required for dynamic client loading");
export default defineConfig({
  define: { __OOC_WORLD_ROOT__: JSON.stringify(resolve(worldRoot)) },
  ...
});
```

`web/src/shared/world-root.ts`（或类似）：

```ts
declare const __OOC_WORLD_ROOT__: string;
export const WORLD_ROOT = __OOC_WORLD_ROOT__;
```

**为什么 fail-loud 而非默认 `./.ooc-world-test`**：

- 默认指向某个目录会让"启动时静默指错"成为头号 debug 黑洞
- 启动期已知世界根；缺就直接报错，开发者立刻知道要补 env

**为什么不走 HTTP 拿 worldRoot**：

- 启动期已知，不必运行时拉
- Vite `/@fs/` 只在 dev 起作用，且要求绝对路径；常量化最稳

**判据**：`bun run web:dev` 缺 env 时给清晰报错；启动成功后浏览器 console 能
打印 `WORLD_ROOT`。

---

### 层 3 — frontend：`ObjectClientRenderer`

新增 `web/src/domains/clients/ObjectClientRenderer.tsx`，基于老 `DynamicUI.tsx`
重写。API 用结构化参数，不让调用方手拼路径：

```ts
type ClientTarget =
  | { scope: "stone"; objectId: string }
  | { scope: "flow"; sessionId: string; objectId: string; page: string };

export function ObjectClientRenderer(props: {
  target: ClientTarget;
  // 透传给被加载组件的 props；callMethod 自动合成
  extraProps?: Record<string, unknown>;
});
```

内部：

1. 由 `target` 计算 absPath：
   - stone → `${WORLD_ROOT}/stones/${objectId}/client/index.tsx`
   - flow  → `${WORLD_ROOT}/flows/${sessionId}/objects/${objectId}/client/pages/${page}.tsx`
2. `/@fs/${absPath}` 作为 dynamic import URL
3. `React.lazy(() => import(/* @vite-ignore */ url).catch(handleError))`
4. 自动合成 `callMethod`：根据 scope 选 `/api/stones/:id/call_method` 或
   `/api/flows/:sid/objects/:id/call_method`，签名 `(method: string, args: object) => Promise<unknown>`
   - 注意：老系统 `callMethod` 接 3 个参数（traitId/method/args）—— 新系统没有 trait 概念，去掉 traitId
5. 错误处理（**不通知 Object，只显式展示**）：
   - 404 / Failed to fetch → 渲染 "信息待产出..."
   - 其它加载错 → 红色块，内含错误堆栈 + 文件绝对路径
6. `UIErrorBoundary`：`getDerivedStateFromError` 标 hasError；渲染红色块带堆栈；
   `componentDidCatch` 仅 `console.error`，不发任何 talk

**判据**：

- `<ObjectClientRenderer target={{ scope: "stone", objectId: "demo" }} />` 在 demo
  stone 没写 client 时显示 "信息待产出..."；写完 `client/index.tsx` 后刷新立刻渲染
- 故意写一份会抛错的 tsx，触发 Error Boundary，看到红色块带堆栈，且**没有**任何
  HTTP 请求发出（验证不耦合 transport）
- callMethod 调用真能命中 server `ui_methods`，返回值在 client 里可用

---

### 层 4 — 路由 / 接入点

最小可见入口（一个，证明骨架成立即可）：

- 在 `web/src/domains/stones` 的对象详情页加一个 "Client" tab，渲染
  `<ObjectClientRenderer target={{ scope: "stone", objectId }} />`
- 不接入 `ooc://client/...` 链接协议（单独一轮的事；首版手工切 tab 验证）

**判据**：从 web app 的 stones 详情页能直接看到对象自写的 UI；不写时显示
fallback 文案。

---

### 层 5 — meta doc 锚点修正 + 删掉过时承诺

`meta/object/executable/client/index.doc.js`：

1. **修锚点**：`sources: { serverUi }` 是占位，改为指向真正的 client 实现模块：

   ```js
   import * as clientLoader from "@src/persistable/stone-client";
   // ObjectClientRenderer 是 web/src/ 下文件，不在 tsconfig include 范围；
   // 锚点选 backend 的 stone-client 模块（删/改它就破坏 client 持久化契约）作为
   // 最稳定的实现入口
   export const client_v20260506_1 = {
     ...
     sources: { clientLoader },
   };
   ```

2. **删过时承诺**：doc 中"失败降级"段写了"自动通知对象（通过 talk）请求修复"，
   按 §3 末尾决策不实现 —— 改为"显式展示错误堆栈，由用户决定是否转发给对象"。

**判据**：`meta/__tests__/concept-links.test.ts`（三件套断言）继续通过；doc 内不
再含"自动通知"字样。

---

## 5. 执行顺序（建议）

| 步骤 | 模块 | 大小 | 依赖前置 |
|---|---|---|---|
| 1 | `src/persistable/stone-client.ts` + 单测 | 小 | 无 |
| 2 | `web/vite.config.ts` + `__OOC_WORLD_ROOT__` define | 小 | 无 |
| 3 | `web/src/domains/clients/ObjectClientRenderer.tsx` | 中 | 1, 2 |
| 4 | `web/src/transport/endpoints.ts` 增 callMethod 路由（如缺）| 小 | 无 |
| 5 | 接入 stones 详情页 + 手工 demo 验证 | 小 | 3 |
| 6 | 更新 `client/index.doc.js`（修 sources + 删自动通知段）| 小 | 1 |

每步独立可 commit；step 5 是 e2e 验证关。

---

## 6. 已敲定的设计选择

| # | 问题 | 选择 |
|---|---|---|
| D1 | 渲染失败如何通知 Object | **不自动通知**；只显式展示错误堆栈，由用户决定是否转发（§3 末尾） |
| D2 | flow client 目录何时 mkdir | `writeClientSource` 兜底 `mkdir({ recursive: true })`，不动 `flow-object.ts` |
| D3 | `ooc://client/...` 链接协议本轮接入？ | 不接；首版只做能跑通的最小路径 |
| D4 | Vite 缺 `OOC_WORLD_ROOT` 时行为 | fail-loud；避免静默指错目录 |
| D5 | 多文件 / 子目录 import 首版是否支持 | 不支持；首版只承诺单文件 + `react` import |
| D6 | 是否给 `program` 新增 `program.write_client` paths | 不加；写 client 用 `write_file` + 模板字符串即可，由 stone 的 knowledge 文档教 Agent 写法 |

---

## 7. 完成判据

最小 e2e 路径全绿即视为 plan 完成：

1. 起 backend + web dev server，访问 stones 详情页的 Client tab
2. 在该 stone 下用 `program(shell)` 写一个最小 `client/index.tsx`（按钮 + 点击调 `callMethod("ping", {})`）
3. 在同一 stone 下用 `program(shell)` 写 `server/index.ts` 注册 `ui_methods.ping`
4. 浏览器手动刷新（或 Vite HMR）后看到组件，点击按钮命中 server 方法，返回值显示
5. 故意把 `client/index.tsx` 改成会抛错的代码，刷新看到红色错误块带堆栈
   （**不**应有任何额外 HTTP 请求发出）
6. 删除 `client/index.tsx`，看到 "信息待产出..."
7. `meta/__tests__/concept-links.test.ts` 通过
8. `meta/object/executable/client/index.doc.js` 内已无"自动通知对象"字样

---

## 8. 相对老系统取舍说明

| 维度 | 老系统 | 新系统 | 原因 |
|---|---|---|---|
| 命名 | `views/{viewName}/frontend.tsx`（多 view + 子目录） | `client/index.tsx`（单页）/ `client/pages/{name}.tsx`（多页） | 新 doc 已重新定义；更贴近 web 心智模型 |
| 路径协议 | 调用方传 `@stones/.../views/...` 字符串 | 调用方传结构化 `{ scope, objectId, ... }` | 不让上游担心路径构造；改 dir 结构只需改 renderer 一处 |
| trait 维度 | callMethod 接 traitId | 去掉 traitId | 新系统无 trait 概念 |
| 渲染失败处理 | Error Boundary 自动 talk 通知 Object | 仅显式展示错误堆栈，不发任何请求 | 渲染层不耦合 transport；避免 stone 无 session、噪声放大等 4 类问题（§3 末尾） |
| world 根 | `__OOC_ROOT__` define | `__OOC_WORLD_ROOT__` define + fail-loud | 命名更准确；缺 env 直接报错 |
