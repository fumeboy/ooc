# A2 —— visible/server 模块 实现 spec（小范围 review 后定稿）

> 设计权威 = issue `.ooc-world-meta/.../docs/issues/2026-06-21-control-plane-editing-model.md`（decided）。A1 已实现全绿。本 spec 经 3-reviewer 小范围 review 强收敛简化。分支 `feat/control-plane-editing-model`。

## 〇、review 裁决（定稿，取代旧 spec 的 thread.say 迁移设计）

3 reviewer（visible / collaborable·thread / executable·persistable）+ 代码实证强收敛：

- **visible/server = 纯 object data 编辑，仅 flow scope**。say **不迁** visible/server（它是 collaborable 会话派送、结构性依赖 live thread；HTTP 无 live thread）。
- **say 的 for_ui_access 是 vestigial**：前端聊天发送**不经 callMethod(say)**，走 flows 专路 `deliverTalkMessage({source:"user"})`（`flows/service.ts:426`，已存在）。退役 say 的 for_ui_access 对前端零影响；say 保留为 executable 方法（LLM 仍 exec say），仅删 for_ui_access 标记。
- ctx **删 runtime/resolveThreadInSession**（say 不迁则无用例）。
- 契约放 **`core/_shared/types/visible-server.ts`**（core 无 visible 目录；_shared 零依赖、ooc-class + app/server 双引无环）。
- 持久化**直调 `persistable.save`**（不复用依赖 thread/OocObjectInstance 的 saveObjectData）；HTTP 侧 eager（无 round-end）。
- **stone scope 延后**（stone object 多纯 self.md=A1，无 business state.json data；A2 v1 仅 flow scope）。

## 一、契约（新建 + 改）

### 新建 `packages/@ooc/core/_shared/types/visible-server.ts`
```ts
import type { ObjectMethodSchema } from "../../executable/contract.js"; // 路径以实际为准

/** visible/server method 的 ctx —— 人类侧服务端 API；无 thinkloop thread。 */
export interface VisibleServerContext {
  baseDir: string;                                   // world
  session: { baseDir: string; sessionId: string };   // 目标 flow（A2 v1 仅 flow scope，必有）
  object: { id: string; class: string };
  reportDataEdit?: () => Promise<void>;              // 改 data 后报告 → dispatch 触发 persistable.save
  args: Record<string, unknown>;
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

### 改 `runtime/ooc-class.ts`（OocClass:48-56）
新增 `visibleServer?: VisibleServerModule<Data>`。

### 改 `executable/contract.ts`（ObjectMethod:119）
**删** `for_ui_access?: boolean` 字段 + JSDoc（人机分流移交 visibleServer）。

### 改 `_shared/types/registry.ts`（:59 filterMethodsByVisibility 的 `ui` case）
`ui` case 随 for_ui_access 退役变死代码——删该 case（或整函数若仅此用，grep 调用方确认）。

## 二、registry（`runtime/object-registry.ts`）
仿 `resolvePersistable`（:238-244）加 `resolveVisibleServer(classId): VisibleServerModule | undefined`（沿 selfThenChain）。register() 已 spread-merge。

## 三、callMethod dispatch 改造（flow scope 主）

抽公共 `dispatchVisibleServerMethod(registry, ref, method, args): Promise<ObjectMethodResult>`（放 app/server 共享处）：
1. `mod = registry.resolveVisibleServer(classId)`；`entry = mod?.methods.find(m=>m.name===method)`；无 → `METHOD_NOT_FOUND`。
2. load 当前 data：`data = await registry.resolvePersistable(classId)?.load(persistableCtx(flowRef)) ?? {}`（flowRef = `{baseDir, sessionId, objectId}`，直构、不依赖 thread）。
3. 构 ctx：`{baseDir, session:{baseDir,sessionId}, object:{id,class}, args, reportDataEdit: eager(()=>persistable.save(persistableCtx(flowRef), data))}`。
4. `result = await entry.exec(ctx, data, args)`；exec 改 data（pass-by-ref 或返回新 data）→ 经 reportDataEdit eager 落盘。
5. `normalizeMethodResult(result)`。

- **flows callMethod**（`flows/service.ts:878-931`）：有 sessionId → 直接用上面 dispatch（替换现 executable+for_ui_access；self 不再传空 `{}`，load 真实 data）。
- **stones callMethod**（`stones/service.ts:346-385`）：A2 v1 stone scope 无 visible/server 用例——改为 `resolveVisibleServer` 查找，无则 `METHOD_NOT_FOUND`（不再 executable+for_ui_access 过滤）。stone scope 的 data 落点（state.json）延后，reportDataEdit 暂不注入（无 flow ref）。

## 四、for_ui_access 全退役面（grep 清单）
1. 删 `executable/contract.ts:119` 字段 + JSDoc。
2. `session-methods.ts:120` say 删 `for_ui_access:true`（say 留 executable）。
3. `stones/service.ts:364,368` + `flows/service.ts:909,913` 过滤 → resolveVisibleServer dispatch。
4. `_shared/types/registry.ts:59` `ui` case 删（确认 filterMethodsByVisibility 调用方）。
5. storybook：`visible/programmable/executable/reflectable` + `L3/L7` story 的 for_ui_access 用例 → 改注册 visibleServer method 验证（见 demonstrator）。
6. `tests/e2e/frontend/*.pw.ts` 两处 for_ui_access → 迁。
7. `web/src/transport/endpoints.ts:65,68` 注释 + `ObjectClientRenderer.tsx` 注释更新。
8. 全树 grep `for_ui_access` 0 残留。

## 五、demonstrator（验证 visible/server 真能改 data）
say 不迁 → 无现成方法迁。建一个 demonstrator 验证机制端到端：
- 选项：给 builtin `todo`（`agent/children/todo`）加一个 visible/server 方法（如 `set_content`/`toggle_done` 改 todo data），由 todo 的 `index.ts` 装配 `visibleServer`。OR storybook 注册一个测试 class 的 visible/server method。
- 确定性测试：直调 `POST /api/flows/:sid/:objectId/call_method`（或 stones 对端）验 visible/server method 被 dispatch、data 经 persistable.save 落 state.json、再 load 读回改动。

## 六、builtin 静态注册
visibleServer 随 class `index.ts` 的 `export const Class` 装配（loader/register-builtins 已通用，无需改）。demonstrator class（如 todo）`index.ts` 补 `visibleServer`。

## 七、前端（延后，登记）
callMethod 通道已存在（`ObjectClientRenderer.tsx:84 callMethodFor`）；**延后的是**通用文件编辑器 UI（A1）+ class 自写 visible tsx 编辑界面。本 spec 只建后端机制 + demonstrator + 确定性测试（直调 HTTP，不依赖真实 tsx）。

## 八、测试 + 文档
- storybook visible story 加 visibleServer dispatch 用例（直调 call_method）；for_ui_access 用例迁 visibleServer。
- 对象树 visible/self.md 补 visible/server ctx 单一权威（baseDir/session/object-self/reportDataEdit，无 runtime）+ say 不迁的说明。
- 测试纪律：源码连贯、坏测试登记账本最后统一修、跑绿（CI gate test:storybook 0 fail）。

## 九、影响文件
**core**：新建 `_shared/types/visible-server.ts`；改 `runtime/ooc-class.ts`、`runtime/object-registry.ts`、`executable/contract.ts`、`_shared/types/registry.ts`、`app/server/modules/stones/service.ts`、`app/server/modules/flows/service.ts`、`persistable/object-data.ts`(若需 flowRef 直构 helper)。
**builtins**：`agent/children/thread/executable/session-methods.ts`(say 去标记)；demonstrator class（todo）`index.ts`+`visible/server/index.ts`。
**web**：注释（endpoints.ts / ObjectClientRenderer.tsx）。
**tests**：storybook 多 story + e2e（账本统一修）。
**对象树**：visible/self.md + index.md（ctx 权威 + say 不迁）。
