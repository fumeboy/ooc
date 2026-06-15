# OOC 对象模型迁移（builtins → example.md 接口模式 + 反推 core）

> 设计权威：`.ooc-world-meta/.../children/class/knowledge/object-model.md`（对象模型单一权威）
> + 同目录 `example.md`（逐文件接口模板）。本文是把该设计落地到 `packages/@ooc/` 的**迁移工作文档**
> （契约决策 + 转换规则 + 测试债登记）。enduring 的接口决策稳定后回流 object-model.md「细节补充」。
>
> 授权：本轮允许破坏性变更、允许忽略存量设计、允许跳过测试（坏测试只登记不逐改）。

## 一、承重决策（example.md 自陈「示意骨架非逐字」，矛盾/留白处由 supervisor 裁决）

1. **`self` = Data 本体**（不是 `{data}` 包装）。executable/readable/window-method 的 `self` 都是该
   class `types.ts` 定义的纯业务数据。example.md executable 段的显式标注 `self: Data` 为准；readable 段
   的 `self.data.content` 归示例 looseness → 实为 `self.content`。对象信封（id/class/title/status/
   createdAt）由 runtime 管理、经 `ctx.object` 取。
2. **`types.ts` = 纯 Data**：只含业务字段，**无**窗信封字段、**无**展示态。
3. **投影态 `win`**：每个 class 在 readable 里自定义其投影态接口（如 `{viewport}` / `{line_start,line_end}`），
   与 Data 分离。window method `(ctx, self, before_win, args) => 新 win`（不可变，不碰 Data、不副作用）。
4. **constructor 返回 Data**：`Class.constructor.exec(ctx, args) => Data`（**非**窗）。runtime 据此把 Data
   包成对象信封。仅**非单例** class 有 constructor；单例 class 省略，数据来自 persistable/self.md/缺省空。
   - constructor 取 `ConstructorContext`（无 `object`，实例尚未存在）。trivial class（note/example）忽略 ctx；
     需要 thread/worktree/spawn 的 class（file/search/*_process）从 ctx 取运行时环境、在 exec 体内行使副作用，
     失败 **throw**（runtime 捕获、不建窗）。这是对 example.md `(args)=>Data` trivial 骨架的精炼——让每个
     builtin 自包含、可纯并行（不必把构造前置逻辑跨 builtin 搬迁）。
   - 委托类 tool-object（filesystem/interpreter/terminal/knowledge_base）经 `ctx.runtime.instantiate(classId, args)`
     （`RuntimeHandle`）造子对象——子 class 各自保留 constructor，委托方只调 instantiate。
5. **package.json `ooc`**：只留 `objectId` + `kind`("class"|"object") + 可选 `class`(父类 id，单链继承)。
   **去掉** `type` / `instantiate_with_new_world` / `members`（组合经 thread-as-object，不在 package.json 声明）。
6. **readable content** 类型 = `XmlNode[] | string`（保留现有结构化渲染，同时允许纯文本）。
7. **文件布局**：`readable/index.ts`（非 `readable.ts`）、`persistable/index.ts`，与 example.md「文件布局」
   逐文件对齐。executable 维度 `executable/index.ts` default export `{methods:[...]}`。

## 二、core 契约落字（keystone，已落 + typecheck 干净）

- `packages/@ooc/core/executable/contract.ts` —— `ExecutableContext` / `ObjectMethod` / `ObjectConstructor` / `ExecutableModule`
- `packages/@ooc/core/readable/contract.ts` —— `ReadableContext` / `WindowMethod` / `ReadableProjection` / `WindowClassDecl` / `ReadableModule`
- `packages/@ooc/core/persistable/contract.ts` —— `PersistableContext` / `PersistableModule`
- `packages/@ooc/core/runtime/ooc-class.ts` —— `OocClass`（index.ts 的 `export const Class` 形状）/ `OocPackageMeta` / `OocObjectInstance`（runtime 实例信封：信封 + `data` + `win` 分离）

## 三、参照实现（已落 + 验证自洽）：`packages/@ooc/builtins/example`

逐文件即 example.md 模板的可编译落字。**所有 builtin 迁移以 example 为准照抄结构**。

## 四、逐 builtin 转换规则

每个 builtin 把以下旧形态映射到新契约：

| 旧 | 新 |
|---|---|
| `*Window extends BaseContextWindow {class, status, ...业务字段}` (types.ts) | `interface Data {...纯业务字段}` (types.ts) |
| `executable/index.ts` 调 `builtinRegistry.registerWindowClass({...})` (side-effect) | `executable/index.ts` `export default {methods:[...]}`；装配挪到 `index.ts` 的 `export const Class` |
| `ObjectMethod {description, exec:(ctx)=>...}` 用 `ctx.self`/`ctx.args` | `ObjectMethod {name, description, schema?, exec:(ctx, self, args)=>string}`；`self`=Data，`ctx.object`/`ctx.thread`/`ctx.runtime` |
| `kind:"constructor"` 的 method 返回 `{ok, window}` | `Class.constructor {description, schema?, exec:(args)=>Data}` |
| `readable.ts` `export function readable(ctx):XmlNode[]` + window method (WindowMethodOutcome) | `readable/index.ts` `export default {readable:(ctx,self,win)=>{class,content}, window:[{class,object_methods,window_methods}]}`；window method `(ctx,self,before_win,args)=>新win` |
| `index.ts` barrel `export * from ./executable` | `index.ts` `export const Class = {constructor?, executable, readable, persistable?}` + `export type {Data}` |
| package.json `kind:"builtin"/type:"object"` | `kind:"class"`（无 type / instantiate_with_new_world） |
| import `@ooc/core/extendable/_shared/{method-types,registry,types}` | import `@ooc/core/{executable,readable,persistable}/contract.js` + `runtime/ooc-class.js` |

**约束**：只改自己 builtin 目录；不动 core；不改/不修测试（坏的登记到第六节）；产物不得残留旧 import
（`extendable/_shared/method-types`、`registerWindowClass`、`BaseContextWindow`、`MethodExecutionContext`、
`WindowMethodExecutionContext`、`RenderContext`）。

## 五、builtin 分波

- **Wave 1（独立窗类，可纯并行）**：`file` `plan` `search` `todo` `knowledge` `skill_index` `runtime`
  `interpreter_process` `terminal_process`
- **Wave 2（已 fan-out）**：`file` `todo`（重做）+ 进程窗 `interpreter_process` `terminal_process`（用新 `_shared/executable/process-readable`）+ 委托 tool-object `filesystem` `interpreter` `terminal` `knowledge_base`（改用 `ctx.runtime.instantiate('_builtin/<child>')`，不再 import delegator）
- **Wave 3（最难，agency/talk/reflectable/单例）具体映射**：
  - `agent`：kind=class；agency(talk/plan/todo/end) 当前由 root 注册到 `_builtin/agent`，**搬进 `agent/executable/index.ts`**（方法体从 `root/executable/method.{talk,plan,todo,end}.ts` 迁来）；去 package.json 的 `members`/`type`。talk 创建 thread+thinkloop 的深层行为需 core（Wave 4），本轮迁签名+保留体、core 依赖处 deferred。
  - `root`：kind=class；executable=ROOT_METHODS(example/feishu misc)+readable；去 side-effect `import "@ooc/builtins/file"` 等（builtin 加载由 Wave 4 core 统一做）。
  - `thread`：kind=class，`ooc.class:"talk"`；Data 最小（继承 talk）；Class 几乎全继承（说 method 留空）。
  - `reflect_request`：kind=class，`ooc.class:"_builtin/thread"`；executable=reflectable 沉淀方法(new_feat_branch/create_pr_and_invite_reviewers, for_reflectable)；会话行为继承 talk。
  - `pr`：kind=class；Data={issueId,reviewerObjectId,authorObjectId,authorThreadId?}；methods approve/reject/request_changes；readable 读 getPrIssue(issueId) 的 DetailView。approval-flow/delivery 保留。
  - `supervisor`：**kind=object**（实例，非 class——按本文迁移映射 instantiate_with_new_world 废弃），`ooc.class:"_builtin/agent"`，去 instantiate_with_new_world/type；Data 最小；readable.md 保留。
  - `user`：**kind=object**；无 executable；Data 最小；readable.md 保留。
  - 注：builtin class id 键名 short vs `_builtin/<id>` 当前不一致（registry 用 short「thread/plan」，objectId 用 `_builtin/<id>`，`_builtin/agent` 又是 `_builtin/` 形）——Wave 4 core 反推时统一，本轮 `ooc.class` 按现 parentClass 值填。

## 六、反推 core（Wave 3，builtins 定形后）

- `runtime/object-registry.ts`：`ObjectDefinition`(Record methods) → 存 `OocClass`，按 class id + 单链继承解析
- `runtime/server-loader.ts`：从 stone `index.ts` 的 `export const Class` 加载（替副作用 barrel）
- dispatch：object method `exec(ctx, self, args)`；window method `exec(ctx, self, before_win, args)`
- 投影：`thinkable/context/renderers/xml.ts` 调 `readable(ctx, self, win)` 渲染 `{class, content}`
- constructor：`exec(args)=>Data` → runtime 包信封
- persistable：default save/load + per-class override
- `app/server/bootstrap/instantiate-classes.ts`：移除 `instantiate_with_new_world`
- core 自有窗 `executable/windows/{talk,method_exec}`：一并迁到新契约
- package.json 字段读取点（`stone-object.ts` 等）：写 `kind`/`class`，去 `type`/`instantiate_with_new_world`

## 七、测试债登记（坏测试，统一在 core 反推完成后修）

- `packages/@ooc/builtins/example/__tests__/example.test.ts` —— 引用旧 `ExampleWindow` 类型 + 旧
  `@ooc/builtins/example/readable.js` 路径；example 已迁新契约（Data + readable/index.ts），此测试待重写。
- （后续各 builtin / core 迁移产生的坏测试在此续登。）
