# A2 —— visible/server 模块 实现 spec

> 设计权威 = issue `.ooc-world-meta/.../docs/issues/2026-06-21-control-plane-editing-model.md`（decided）。A1 已实现全绿。本 spec 实现 **A2**：`for_ui_access` 从 executable 退役 → visible 维度新增「给 UI 用的服务端 API」模块。分支 `feat/control-plane-editing-model`。

## 一、设计要点（来自 issue 裁决）

- OOC class 新增可选模块 `visibleServer`，编程路径 `<ObjectDir>/visible/server/index.ts`，由 `<ObjectDir>/index.ts` 的 `export const Class` 与 executable/readable/persistable **一并装配**。
- visible/server method 的 **ctx 有 world(baseDir) / session(目标 flow: baseDir+sessionId) / object-self(data)，无 current thinkloop thread**——与 executable ObjectMethod 不同签名。
- 改 object data → 经 persistable.save 持久化（**非版本化**，flow 层）。
- HTTP `/call_method`（stones + flows 两路）dispatch 到 visibleServer.methods（不再读 executable + for_ui_access 过滤）。
- `ObjectMethod.for_ui_access` 字段**退役**。

## 二、契约（新建 + 改）

### 新建 `packages/@ooc/core/visible/contract.ts`
```ts
/** visible/server method 的 ctx —— 人类侧服务端 API，无 thinkloop thread。 */
export interface VisibleServerContext {
  /** world 根目录。 */
  baseDir: string;
  /** 目标 flow（session）；stone scope 调用时缺省。 */
  session?: { baseDir: string; sessionId: string };
  /** 被调 object 身份信封。 */
  object: { id: string; class: string };
  /** 改 object data 后报告（HTTP 侧由 dispatch 注入，触发 persistable.save）。 */
  reportDataEdit?: () => Promise<void>;
  /** 解析目标 session 内某 object 的 thread（thread.say 等会话操作用；HTTP 无 live thread）。 */
  runtime?: VisibleServerRuntime;
  args: Record<string, unknown>;
}
export interface VisibleServerRuntime {
  /** 按 session 解析目标 object 的活动 thread（派送会话消息用）。 */
  resolveThreadInSession(sessionId: string, targetObjectId: string): Promise<...>;
}
export interface VisibleServerMethod<Data = any> {
  name: string;
  description?: string;
  schema?: ObjectMethodSchema;
  exec: (ctx: VisibleServerContext, self: Data, args: Record<string, unknown>) => unknown | Promise<unknown>;
}
export interface VisibleServerModule<Data = any> {
  methods: VisibleServerMethod<Data>[];
}
```
> ctx 字段单一权威落此（issue 后续待钉项之一）。`ObjectMethodSchema`/`ObjectMethodResult` 复用 executable/contract。

### 改 `runtime/ooc-class.ts`（OocClass:48-56）
新增 `visibleServer?: VisibleServerModule<Data>` 字段。

### 改 `executable/contract.ts`（ObjectMethod:119）
**删** `for_ui_access?: boolean` 字段 + 其 JSDoc（人机分流移交 visibleServer）。

## 三、registry（`runtime/object-registry.ts`）
仿 `resolvePersistable`（:238-244）加 `resolveVisibleServer(classId): VisibleServerModule | undefined`（沿 selfThenChain 解析）。register() 已 spread-merge，visibleServer 自动纳入。

## 四、callMethod dispatch 改造（两路）

### `app/server/modules/stones/service.ts` callMethod（:346-385）
- 取 method：`registry.resolveVisibleServer(objectId)?.methods.find(m => m.name === method)`（不再 resolveObjectMethods + for_ui_access 过滤）。无则 `METHOD_NOT_FOUND`。
- 构 ctx：`{ baseDir, object:{id,class:objectId}, args, reportDataEdit, runtime? }`（stone scope 无 session）。
- load object data 作 self：`registry.resolvePersistable(objectId)?.load(persistableCtx(stoneObjectRef))`（无 persistable→默认 state.json 或空）。
- exec → 若改了 data，经注入的 reportDataEdit 触发 `saveObjectData`/persistable.save 落盘（非版本化）。

### `app/server/modules/flows/service.ts` callMethod（:878-931）
- 同上，但 ctx 带 `session:{baseDir, sessionId}`；data load/save 走 flow 层（`flows/<sid>/objects/<id>/state.json` 或自定义）。
- self 不再传空 `{}`——load 真实 data。

> 抽公共 `buildVisibleServerCtx` + dispatch helper，两路复用，避免 stones/flows 漂移。

## 五、thread.say 迁移（最 thorny —— 见待裁决）

现状 `session-methods.ts:57-85` sayMethod（for_ui_access:true）依赖 `ctx.thread`（live thread）派送。迁 thread 的 visibleServer：
- ctx 无 live thread → 经 `ctx.session.sessionId` + 目标 objectId，用 `ctx.runtime.resolveThreadInSession` 解析目标 thread，再走既有 `deliverTalkMessage` 派送。
- reportDataEdit：HTTP 侧注入 → persistable.save。

## 六、for_ui_access 全退役面
1. 删 `executable/contract.ts:119` 字段。
2. thread.say 迁 thread visibleServer（say 离开 executable）。
3. stones/flows callMethod 的 for_ui_access 过滤 → resolveVisibleServer。
4. storybook：visible/programmable/executable/reflectable story 的 for_ui_access 用例 → 改 visibleServer method（注册一个测试 class 的 visible/server）。
5. 前端 `ObjectClientRenderer.tsx` 注释更新（callMethod 现 dispatch visibleServer）。
6. 全树 grep `for_ui_access` 0 残留。

## 七、前端
- `ObjectClientRenderer` 的 callMethod 入口不变（仍 POST /call_method）——dispatch 改在后端。
- 通用文件编辑器（A1 的 UI）+ class 自写 visible 编辑界面：本 spec **不建**（additive，登记后续）。

## 八、待裁决点（小范围 review 重点）
1. **thread.say 的 session→thread 解析**：新增 `VisibleServerRuntime.resolveThreadInSession` 是否合理？还是 say 这类会话操作**不属 visible/server**（visible/server 只管「改 object data」），thread.say 另留 flows 专路？——这是 A2 最关键分叉：visible/server 的边界是「纯 data 编辑」还是「含会话派送」。
2. **stone scope 无 session 时能调哪些 visibleServer method**：stones callMethod 无 sessionId——纯 stone-data 编辑（如改身份…但 self.md=A1 only）可，会话类不可。stone scope 的 visibleServer 用例是什么？
3. **data load/save 在 HTTP 无 thread 时的 ref 构造**：`persistableCtx`/`runtimeObjectRef` 现依赖 thread——HTTP 侧怎么构（flows 用 sessionId，stones 用 main ref）。
4. **builtin visible/server 静态注册**：thread 的 say 迁 visibleServer 后，register-builtins 怎么带上。

## 九、测试 + 文档
- storybook visible story 加 visibleServer 能力用例（TC-VIS）；programmable/executable/reflectable 的 for_ui_access 用例迁。
- 对象树 visible/self.md 已回流 visible/server 设计——实现后补 ctx 字段单一权威 + 锚点。
