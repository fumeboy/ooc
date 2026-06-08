# Plan: Object Constructor + Method 归一化（ooc-6 P6）

## Context

OOC Object Unification（ooc-6）已经把 `state.json` 作为运行时 object 的统一状态文件。但 ContextWindow（即 Object 在 context 中的呈现）的「创建路径」、「状态写盘路径」与「方法分派路径」还有几处与 OOP 哲学不吻合：

1. **「window」与「object」用词混乱**：当前 `commands / CommandTableEntry / CommandExecutionContext / CommandExecOutcome / ROOT_COMMANDS` 等命名还停留在「指令表」时代，而 OOC 的核心抽象是「Object 的 method」——method 在 context 里以 window 的形态呈现，但本质是 object 的方法。统一改名为 method 才符合 OOP 哲学。

2. **创建散落在 root.* command 里**：`root/executable/command.{do,todo,talk,plan,program,open-file,open-knowledge,write-file,glob,grep,metaprog}.ts` 都自己 `generateWindowId` + 构造对象字面量 + `manager.insertTypedWindow`。

3. **`command_exec` 被错放成独立 builtin object**：`packages/@ooc/builtins/command_exec/` 与 `todo/file/plan/...` 同级，但它是方法调用过程的视图层 wrapper（在 `manager.openCommandExec()` 里被自动开/关），不是用户/LLM 显式构造的 object。

4. **方法体里还写 self.type 校验**：`packages/@ooc/builtins/command_exec/executable/command.refine.ts:21-24` 自己 `if (!form || form.type !== "command_exec")`。这种「方法只能在所属 type 上执行」的不变量应当由系统保证——method 体不应 re-check 自己的 self。

5. **持久化层把「object 的内置特性」错当成独立 flow object 来落盘**：当前 `manager.writeContextObjectForWindow` 对**任意** ContextWindow（含 talk_window / do_window / method_exec form）都写一份 `flows/<sid>/<wid>/state.json`，每个 wid 都自成一个 flow object 目录。但 talk / do / form 是**Object 的内置特性**（任何 Object 都能 talk/do；form 只是某个 method 调用过程的临时载体），它们应该作为**所属 thread 的 context 的一部分**被持久化（thread 维度），而不是和 object 自身字段（state，object 维度）混在一起，更不该有独立目录。结果就是 `.ooc-world-test-fresh/flows/<sid>/f_mpw0lu0q_f3wf/` 这种 form 目录，既不属于哪个 user-facing object，也没有 `.flow.json`，破坏「目录 = object 实例」的不变量。**state（object 维度）和 context（thread 维度）必须分文件**。

6. **真正的 flow object 缺 `.flow.json`**：`writeRuntimeObjectState`（`flow-runtime-object.ts:34-44`）只写 `state.json`，从不调 `createFlowObject`（`flow-object.ts:52-62`）。`thread-query.ts:48 / 118` 把「目录直接含 `.flow.json`」当作 flow-object 判定标准，runtime objects 在该判定下不算 flow object。

7. **缺 class（继承）维度**：runtime 实例与 builtin/stone 类目录是「实例-类」关系，但盘上完全平行。`.flow.json` 没有指向类的字段，方法解析也没有「向父类回退」的链路。

8. **state 编辑→state.json 写盘是 fire-and-forget**：`manager.refine()` 只 mutate 内存，不写盘；只有上游 `submit / removeWindow / upsertWindow` 触发的 `.catch(() => {})` 才会刷新。Object 自己没法主动报告「我刚改了 state，请刷盘」。

**关键观点（来自 user feedback）**：
- **talk / do / method_exec form 不是独立 object，是 Object 的内置特性**，是 parent 线程上下文的一部分。它们 **不该** 有 `flows/<sid>/<wid>/` 目录、不该有 `.flow.json`、不该有独立 state.json。
- **state 和 context 是两个维度**：`state.json` 是 **object 维度** 的（object 自己的属性数据，跨线程共享），`context.json` 是 **thread 维度** 的（thread 看见的 contextWindows 列表，包含内置特性窗口 + 对独立 object 的 ref）。两者**不能混在一个文件里**。
- **真正的独立 flow object 是**：user、supervisor、stones/<id>、builtins 中的 plan / program / file / knowledge / search / skill_index / todo（runtime 实例化后落到 `flows/<sid>/<oid>/` 目录）。这些是 Object 实例，有 `flows/<sid>/<oid>/` 目录 + `.flow.json` + `state.json`（自身状态）+ `threads/<tid>/context.json`（每个 thread 的 contextWindows）。
- 因此持久化布局要重画：每个 flow object 的目录下，`state.json` 只存 object 自身字段（不含 contextWindows）；每个 thread 子目录下的 `context.json` 存该 thread 的 contextWindows 数组（含内置特性窗口的 inline 状态 + 独立 object 窗口的 ref）。

**目标**：
- 全局把 `command*` → `method*` 重命名（保留 @deprecated 别名）。
- ContextWindow（Object 在 context 中的呈现）的构造 = 调对应 type 的 `constructor` ObjectMethod；root.* method 只剩参数解析 + 调 constructor。
- `command_exec` 不再是独立 builtin object 目录，下放到 `core/executable/windows/method_exec/`。
- 方法分派由 manager 强保证 `self.type === method 所属 class`；method 体不再写 self.type 校验。
- **持久化重画**：仅真正的 flow object 拥有 `flows/<sid>/<oid>/` 目录 + `.flow.json` + `state.json`；talk_window / do_window / form 等内置特性归入**所属 thread 的 `context.json`**。state 是 object 维度（跨线程共享），context 是 thread 维度（每个 thread 一份）。
- `.flow.json` 新增 `class: <objectId>` 字段（继承的载体）；class 指向 stone/builtin 已有 object，方法按「实例 → class → 父 class」链路解析。
- 提供 `ctx.manager.reportStateEdit(ref)` / `ctx.manager.reportContextEdit(threadRef)`，让方法分别主动触发 object state.json / thread context.json 刷盘。

## Approach

### 1. 命名归一化：command* → method*

| 旧名（保留为 @deprecated alias） | 新名 |
|---|---|
| `CommandTableEntry`              | `ObjectMethod`（已存在；扩字段见 §2） |
| `commands` 字段                  | `methods` |
| `CommandExecutionContext`        | `MethodExecutionContext` |
| `CommandKnowledgeEntries`        | `MethodKnowledgeEntries` |
| `CommandExecOutcome`             | `MethodOutcome` |
| `lookupCommandEntry`             | `lookupMethod` |
| `ROOT_COMMANDS`                  | `ROOT_METHODS` |
| ContextWindow type `command_exec` | `method_exec`（旧 type 字符串读 path 兼容 1 个 release） |
| LLM 入口 `exec` tool 的 `command` 入参 | 推荐改 `method`，旧 `command` 保留一个 release 期 alias |

`registerObjectType(typeName, { methods, commands?, readable, basicKnowledge, constructor?, parentClass? })` —— 旧 `commands` 字段保留兼容。

### 2. ObjectMethod.kind + MethodOutcome 的 object 形态

```ts
export interface ObjectMethod extends CommandTableEntry {
  public?: boolean;
  for_ui_access?: boolean;
  /** P6: 标记此 method 是 Object 的构造函数。
   *  exec 必须返回 { ok:true, object: ContextWindow }；
   *  manager 接管挂载（写入 parent.state.contextWindows + 视情况落盘）。 */
  kind?: "constructor" | "method";
}

export type MethodOutcome =
  | { ok: true; result?: string }
  | { ok: true; object: ContextWindow }   // ← 用 object 不用 window；window 是 object 在 context 中的呈现
  | { ok: false; error: string };
```

manager.submit 见到 `{ ok:true, object }` 时：

```ts
this.insertTypedObject(raw.object, thread);                  // 进 in-memory map + thread.contextWindows
await this.persistObjectAfterChange(thread, raw.object);     // §6：内置特性 → thread.context.json；独立对象 → 自己 state.json + thread ref
// form 自动 success → 系统从 contextWindows 移除（已有）
```

### 3. 方法分派由系统保证 self 类型

`manager.submit` 在进入 `entry.exec` 之前已 narrow self：

```ts
export interface MethodExecutionContext<TSelf extends ContextWindow = ContextWindow> {
  thread?: ThreadContext;
  form?: MethodExecWindow;
  self: TSelf;                  // ← 替代 parentWindow；类型由 dispatch 保证
  manager?: WindowManager;
  args: Record<string, unknown>;
}
```

dispatch 阶段：
- `lookupMethod(parent, methodName)` 命中 → 该 method 在 parent.type 类（或父类，§7）上声明。
- 不命中 → manager 直接给 failed outcome `[method-error] method "X" not declared on object class "Y"`，不进入 exec。

method 实现侧（以现 `command_exec.refine` 为例，改造后）：

```ts
async function executeRefine(ctx: MethodExecutionContext<MethodExecWindow>) {
  const form = ctx.self;                       // 系统已保证 self.type === "method_exec"
  if (form.status !== "open" && form.status !== "failed") {
    return { ok: false, error: `[refine] form ${form.id} 不在 open/failed 状态` };
  }
  ...
}
```

method 体不再出现 `if (!form || form.type !== "command_exec")` 之类校验。

### 4. talk / do / form 是 Object 的内置特性，注册位下放到 core

`talk / do / todo / plan / program / open_file / open_knowledge / write_file / glob / grep / metaprog / open_feishu_chat / open_feishu_doc` 都是**任何 Object 都自带**的能力（"Object 内置基类" = root）。registerObjectType("root", { methods: ROOT_METHODS, ... }) 保留，所有 type 默认通过 §7 的继承链拿到这些方法。

ContextWindow type 注册位：

| type            | 注册位 | 说明 |
|-----------------|---|---|
| `talk`          | `core/executable/windows/talk/index.ts` | 内置特性，无独立 flow dir |
| `do`            | `core/executable/windows/do/index.ts`   | 内置特性，无独立 flow dir |
| `todo`          | `core/executable/windows/todo/index.ts`（从 builtins/todo 搬来）| 内置特性 |
| `method_exec`   | `core/executable/windows/method_exec/index.ts`（替换 builtins/command_exec）| 内置特性，无 LLM-visible constructor |
| `plan`          | `builtins/plan/executable/index.ts` | **独立 flow object**，有自己目录 + .flow.json + state.json |
| `program`       | `builtins/program/executable/index.ts` | **独立 flow object** |
| `file`          | `builtins/file/executable/index.ts` | **独立 flow object** |
| `knowledge`     | `builtins/knowledge/executable/index.ts` | **独立 flow object** |
| `search`        | `builtins/search/executable/index.ts` | **独立 flow object** |
| `skill_index`   | `builtins/skill_index/executable/index.ts` | **独立 flow object** |

每个 type 都通过 `registerObjectType(type, { ..., constructor })` 提供构造方法。constructor 形如：

```ts
const constructor: ObjectMethod = {
  kind: "constructor",
  paths: ["talk"],
  match: () => ["talk"],
  permission: () => "allow",
  exec: async (ctx) => {
    const target = String(ctx.args.target ?? "").trim();
    const title  = String(ctx.args.title  ?? "").trim();
    if (!target || !title) return { ok: false, error: "[talk] target/title 必填..." };
    const id = generateWindowId("talk");
    const win: TalkWindow = { id, type: "talk", parentWindowId: ROOT_WINDOW_ID, title,
                              status: "open", createdAt: Date.now(), target,
                              conversationId: id, transcriptViewport: { ... } };
    return { ok: true, object: win };
  },
};
```

> `do` 的副作用比较重（child thread 创建 + creator do_window + inbox/outbox 写消息）—— 全部搬进 `core/executable/windows/do/constructor.ts`。

### 5. Root method 退化为「调对应 type 的 constructor」

```ts
// builtins/root/executable/method.talk.ts（旧 command.talk.ts）
export const talkMethod: ObjectMethod = {
  paths: ["talk"],
  match: () => ["talk"],
  knowledge: ...,
  exec: async (ctx) => {
    const ctor = lookupConstructor("talk");
    if (!ctor) return { ok: false, error: "[talk] talk constructor 未注册" };
    return ctor.exec(ctx);
  },
};
```

`lookupConstructor(typeName)` 加在 `core/extendable/_shared/registry.ts`。

### 6. 持久化重画：state 是 object 维度，context 是 thread 维度

**核心区分**（在 type registry 里声明 —— 现有的 registry 实现是 `core/executable/windows/_shared/registry.ts` 内部的 `REGISTRY: Map<ObjectType, ObjectDefinition>`；旧名 `WINDOW_REGISTRY` 已下线，只剩注释里残留的引用，需要在 §10 一并清理）：

```ts
registerObjectType(typeName, {
  ...,
  /** P6: 该 type 是「Object 内置特性」（true）还是「独立 flow object」（false）。
   *  - true:  实例不写 flows/<sid>/<id>/ 目录；状态 inline 进所属 thread 的 context.json。
   *  - false: 实例写 flows/<sid>/<id>/.flow.json + state.json，与 stone/user 同形态；
   *           在所属 thread 的 context.json 里只放一个 ref 项（{ id, type, _ref: true }）。
   *  默认 false（独立）。 */
  isBuiltinFeature?: boolean,
})
```

| type | isBuiltinFeature |
|---|---|
| talk, do, todo, method_exec | true（inline 进 thread context.json） |
| plan, program, file, knowledge, search, skill_index | false（独立 flow dir） |

**两种维度的盘上布局**（关键：state ≠ context）：

```
.ooc-world-test/flows/<sid>/
├── <objectId>/                       # 独立 flow object 目录
│   ├── .flow.json                    # 类元数据：{ type, sessionId, objectId, class }
│   ├── state.json                    # ← Object 维度：object 自身字段（跨线程共享）
│   │                                 #    ❌ 不含 contextWindows
│   └── threads/
│       └── <threadId>/
│           └── context.json          # ← Thread 维度：该 thread 的 contextWindows 数组
│                                     #    含内置特性 inline + 独立 object ref
```

`state.json` schema（object 自身字段）：
```ts
{
  id: "supervisor",
  type: "supervisor",
  // ...其他 self 字段（class 特定数据）
  // ❌ 不放 contextWindows
}
```

`threads/<tid>/context.json` schema（thread 维度的 contextWindows）：
```ts
{
  threadId: "t_user_xxx",
  contextWindows: [
    // 内置特性：完整 inline，因为没有独立 state.json
    { id: "w_talk_xxx", type: "talk", title: "...", status: "open", transcriptViewport: {...}, ... },
    { id: "f_xxx",     type: "method_exec", form_state: "open", accumulatedArgs: {...}, commandPaths: [...] },
    // 独立 flow object：只放 ref；hydrate 时另读 ../../<refId>/state.json
    { id: "w_plan_xxx", type: "plan", _ref: true, refObjectId: "w_plan_xxx" }
  ]
}
```

manager 写盘路径分两条：

```ts
private async persistObjectAfterChange(thread, obj) {
  const def = getObjectDefinition(obj.type);    // 取代旧 WINDOW_REGISTRY[obj.type]
  if (def?.isBuiltinFeature) {
    // 路径 A: 内置特性 —— 重写所属 thread 的 context.json（含本 contextWindow 的 inline 状态）
    await this.writeThreadContext(thread);
    return;
  }
  // 路径 B: 独立 flow object —— 自己一份 .flow.json + state.json，并把 ref 加到 thread.context.json
  const ref = this.runtimeObjectRefForObject(thread, obj);
  if (!ref) return;
  await createFlowObject(ref, { class: obj.type });   // 写 .flow.json（含 class）
  await writeRuntimeObjectState(ref, obj);            // 写 state.json（不含 contextWindows）
  await this.writeThreadContext(thread);              // ref 进 thread.context.json
  await updateThreadContextRegistry(thread, obj);     // 已有逻辑
}
```

> 现存 `flows/<sid>/<wid>/state.json`（含 talk/do/form 那一坨）在 P6 落地时一次性 migrate：把内置特性数据 inline 进所属 thread 的 `context.json`，删除多余目录；并把现存 state.json 中可能存在的 contextWindows 字段拆出来搬到对应 thread 的 context.json。Migration 脚本 `scripts/migrate-state-context-split.ts`。

### 7. .flow.json 的 `class` 字段 + 方法继承链

扩 `FlowObjectMetadata`（`flow-object.ts:16-23`）：

```ts
export interface FlowObjectMetadata {
  type: "flow-object";
  sessionId: string;
  objectId: string;
  /** P6: 实例所属的 Class（也是一个 objectId，必须存在于 stones/、builtins/ 或 core 内置 type）。
   *  方法解析链：instance → stones/<class>/server/index.ts → builtins/<class>/executable
   *           → core/executable/windows/<class>/ → 父 class（递归）。 */
  class?: string;
}

export async function createFlowObject(
  ref: FlowObjectRef,
  opts?: { class?: string },
): Promise<FlowObjectRef> { /* class 存在性校验，否则抛 ClassNotFoundError */ }
```

`core/extendable/_shared/registry.ts` 新增：

```ts
/** 沿 class.parentClass 链向上找 method。 */
export function resolveMethod(classId: string, methodName: string): ObjectMethod | undefined {
  let cur: string | undefined = classId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const def = getObjectDefinition(cur);   // 走当前 registry 的 getter
    if (def?.methods?.[methodName]) return def.methods[methodName];
    cur = def?.parentClass ?? "root";   // 默认所有非 root class 继承 root（除非显式 parentClass: null）
  }
  return undefined;
}
```

`registerObjectType` 增加 `parentClass?: string | null`：
- 不声明 → 默认继承 `root`（拿到 talk/do/todo/plan/... 等所有通用方法）。
- 显式 `null` → 不继承（仅 root + method_exec 这种 lifecycle 内部 type）。

`manager.lookupMethod / submit` 改走 `resolveMethod(parent.type, methodName)`。

stones 侧 hydrator（导出 ObjectMethod 表 + 可选 parentClass）本期不实装，仅打通 builtin/core-to-core 这一层 + 在 `.flow.json` 把 class 字段持久化好。

### 8. `reportStateEdit` / `reportContextEdit` —— Object / Thread 两个维度的主动通知

由于 §6 把 state（object 维度）与 context（thread 维度）拆成两个文件，主动刷盘也分两个 API：

- `reportStateEdit(ref)` —— 通知系统某个 **flow object 的 state 改了**，请同步到它的 `state.json`。**不接 thread 参数**——state 是 object 维度的，跨线程共享。
- `reportContextEdit(threadRef)` —— 通知系统某个 **thread 的 context 改了**（比如 talk_window 累加了一条 transcript、form 累积了 args），请同步到 `<oid>/threads/<tid>/context.json`。

```ts
// core/executable/windows/_shared/manager.ts

/** 通知系统：某个 flow object 的 state 改变了，把内存里的最新值同步到它的 state.json。
 *  与 thread 无关；仅作用于 ref 指向的那个 object 的 state.json。
 *  对「内置特性」（isBuiltinFeature=true）调用是 no-op：内置特性没有自己的 state.json，
 *  调用方应该改而 reportContextEdit 自己所属的 thread。 */
public reportStateEdit(ref: FlowObjectRef): Promise<void> {
  const obj = this.objectRegistry.get(ref.objectId);
  if (!obj) return Promise.resolve();
  const def = getObjectDefinition(obj.type);
  if (def?.isBuiltinFeature) return Promise.resolve();    // no-op，调用方应改用 reportContextEdit
  return writeRuntimeObjectState(ref, obj);               // 串行队列保证一致性
}

/** 通知系统：某个 thread 的 contextWindows 改变了（包括内置特性 inline 状态变化或独立 object ref 增删），
 *  把内存里的最新 thread.contextWindows 同步到 <oid>/threads/<tid>/context.json。 */
public reportContextEdit(threadRef: ThreadRef): Promise<void> {
  return writeThreadContext(threadRef, this.collectThreadContextWindows(threadRef));
}
```

method 在 mutate 后的调用形态：

```ts
// 1) 自己就是独立 flow object，改 self 字段（如 plan_window 改 steps）：
await ctx.reportStateEdit!();   // 内部 → manager.reportStateEdit(ctx.ownerFlowObjectRef)

// 2) 自己是内置特性（如 talk_window.say 改 transcript、method_exec.refine 累积 args）：
//    内置特性的状态在所属 thread 的 context.json 里：
await ctx.reportContextEdit!();   // 内部 → manager.reportContextEdit(ctx.ownerThreadRef)
```

`MethodExecutionContext` 提供两组 helper（避免每次 method 自己拼 ref）：

```ts
export interface MethodExecutionContext<TSelf extends ContextWindow = ContextWindow> {
  thread?: ThreadContext;
  form?: MethodExecWindow;
  self: TSelf;
  manager?: WindowManager;
  args: Record<string, unknown>;

  /** P6: method 操作的 flow object 的 ref（仅独立 flow object 有意义）。 */
  ownerFlowObjectRef?: FlowObjectRef;
  /** P6: method 所在 thread 的 ref（任何 method 都有，因为 method 总是在某个 thread 里跑）。 */
  ownerThreadRef?: ThreadRef;

  /** P6: 通知系统「object 的 self 字段改了，同步到 state.json」。
   *  内部就是 ctx.manager.reportStateEdit(ctx.ownerFlowObjectRef)。
   *  内置特性请改用 reportContextEdit。 */
  reportStateEdit?: () => Promise<void>;
  /** P6: 通知系统「thread 的 contextWindows 改了（包括内置特性的 inline 状态），同步到 context.json」。
   *  内部就是 ctx.manager.reportContextEdit(ctx.ownerThreadRef)。 */
  reportContextEdit?: () => Promise<void>;
}
```

`refine` 侧打补丁解决 user 提的「refine 不写盘」问题（refine 改的是 form 累积参数，form 是内置特性 → 走 context）：

```ts
// method_exec/refine.ts
async function executeRefine(ctx) {
  const form = ctx.self;
  if (form.status !== "open" && form.status !== "failed") {
    return { ok: false, error: `[refine] form ${form.id} 不在 open/failed 状态` };
  }
  ctx.manager!.refine(form.id, ctx.args);
  await ctx.reportContextEdit!();   // ← form 是内置特性 → 落到所属 thread 的 context.json
  return { ok: true, result: `Form ${form.id} 已累积参数。当前路径：${...}` };
}
```

> 关键点：`reportStateEdit` 不接 thread —— state 是 object 维度，跨线程共享；`reportContextEdit` 是 thread 维度，每个 thread 一份 context.json。method 体根据自己改的是 object 自身字段还是 thread 的 contextWindows 选用对应 helper。Manager 内部串行写。

### 9. 移除 `builtins/command_exec/`，下放到 core 改名 `method_exec`

- `command.refine.ts / command.submit.ts / executable/index.ts` 搬到 `packages/@ooc/core/executable/windows/method_exec/{refine.ts, submit.ts, index.ts, readable.ts}`。
- 注册：`registerObjectType("method_exec", { methods: { refine, submit }, readable, basicKnowledge, parentClass: null, isBuiltinFeature: true })`。
- 不给 `method_exec` 注册 `constructor` —— 它的实例由 `manager.openMethodExec` 内部建出，LLM 不能 `exec(method="method_exec", ...)`。
- 删除 `packages/@ooc/builtins/command_exec/` 整个目录；server 侧 import 列表去掉相应引用。

### 10. 清理系统中已废弃的概念（cleanup obsolete concepts）

ooc-6 之前留下的旧名 / 旧抽象在源码里只剩注释或 `@deprecated` alias，但 grep 仍能搜到、概念文档里也还能见到——构成噪音。最直接的信号：user 已经在源码里看不到 `WINDOW_REGISTRY` 的真实定义但仍能搜到对它的引用。本期一并清掉：

| 旧符号 | 现状（grep 验证） | 处理 |
|---|---|---|
| `WINDOW_REGISTRY` | 已下线；运行时是 `REGISTRY: Map<ObjectType, ObjectDefinition>` + getter `getObjectDefinition`。仅在注释中残留：`packages/@ooc/core/executable/windows/_shared/{manager.ts:89, types.ts:19, types.ts:174, registry.ts:111}` 与 `packages/@ooc/core/executable/windows/index.ts:79` | 删除所有注释引用，必要处改用「current registry」「`REGISTRY` Map」描述 |
| `registerWindowType` | `_shared/registry.ts:226-246` 已 `@deprecated`，alias 指向 `registerObjectType` | 删除 alias 函数；migrate 任何剩余 import 到 `registerObjectType` |
| `getWindowTypeDefinition` | `_shared/registry.ts:295+` 已 `@deprecated`，alias 指向 `getObjectDefinition` | 删除 alias；migrate 到 `getObjectDefinition` |
| `WindowTypeDefinition` | 已 `@deprecated` type alias → `ObjectDefinition` | 删除 type；migrate 所有引用 |
| `CommandTableEntry` | 已被 `ObjectMethod`（`command-types.ts:91-104`）取代；旧名仍 export | 与 §1 重命名同步推进；保留一个 release 期 `@deprecated` re-export，下版本去掉 |
| `@ooc/builtins/command_exec/` package | §9 已搬到 `core/executable/windows/method_exec/` | 整个 package 目录从 monorepo 移除；改 `package.json` workspaces / tsconfig paths / `apps/*` 与 `web/` 的 import |
| `exec` tool 的 `command` 入参 | §1 表格已规划改 `method` | 本次保留 alias 一个 release，下次 release 删 |
| `meta/object.doc.ts` 等概念文档里的旧名（grep `WINDOW_REGISTRY` / `command_exec` / `commands 字段`） | 与代码不一致 | 同步替换为「method」「`REGISTRY` Map」「method_exec」 |

操作纪律（受 [Doc work verify each link] 影响）：
- **每删除一个 deprecated 符号，立刻**：
  ```bash
  bun tsc --noEmit
  bun test packages/@ooc/core/
  bun test packages/@ooc/builtins/
  ```
  全绿后再删下一个，绝不一次性批量删。
- 注释里描述运行时机制时不再提 `WINDOW_REGISTRY`；统一称 "object type registry"（变量名 `REGISTRY`，公共 API `registerObjectType` / `getObjectDefinition`）。
- 删除每个 alias 时检查 `apps/server` / `web/` / `meta/*.doc.ts` / `tests/` / `scripts/` 全树调用方，避免遗漏。
- **顺序**：先把 §1（重命名）完成、所有调用方迁到新名，再做 §10 的 alias 删除最稳——§1 让所有内部调用方都用上新名，§10 再砍旧名 export，避免一边改 alias 一边改 caller 的并发风险。

## Files to modify

代表路径（同种 pattern 重复多次）：

**核心类型 + 重命名**
- `packages/@ooc/core/executable/windows/_shared/command-types.ts`（新建 `method-types.ts`，旧文件 re-export + @deprecated）—— 加 `kind`；扩 `MethodOutcome`；改名 `CommandExecutionContext → MethodExecutionContext`，字段 `parentWindow → self`，加 `ownerFlowObjectRef / ownerThreadRef / reportStateEdit / reportContextEdit`
- `packages/@ooc/core/executable/windows/_shared/registry.ts` —— `lookupConstructor / resolveMethod / parentClass / isBuiltinFeature`；`commands` 字段读写双兼容
- `packages/@ooc/core/executable/windows/_shared/manager.ts` —— submit 走 constructor 分支；新增 `persistObjectAfterChange / writeThreadContext / reportStateEdit / reportContextEdit`；refine 后写盘；改名 `openMethodExec`；删除「每个 ContextWindow 写独立 state.json」；**state.json 不再含 contextWindows**
- `packages/@ooc/core/persistable/flow-object.ts` —— `FlowObjectMetadata.class`、`createFlowObject(ref, opts?)` + class 校验
- `packages/@ooc/core/persistable/flow-runtime-object.ts` —— `createRuntimeObject` 仅在 `isBuiltinFeature=false` 时调用；`writeRuntimeObjectState` schema **从 state.json 移除 contextWindows**（仅 object 自身字段）
- 新建 `packages/@ooc/core/persistable/flow-thread-context.ts` —— `writeThreadContext(threadRef, contextWindows)` / `readThreadContext(threadRef)`，落盘 `<oid>/threads/<tid>/context.json`

**core 内置 window types 加 constructor / talk + do 全程下放**
- 新建 `packages/@ooc/core/executable/windows/talk/{index.ts, constructor.ts, say.ts, wait.ts, close.ts, readable.ts}`
- 新建 `packages/@ooc/core/executable/windows/do/{index.ts, constructor.ts, continue.ts, move.ts, close.ts, readable.ts}`（含 child thread + creator do_window 副作用）
- 新建 `packages/@ooc/core/executable/windows/todo/index.ts` 加 constructor（从 builtins/todo 搬来）
- 新建 `packages/@ooc/core/executable/windows/method_exec/{index.ts, refine.ts, submit.ts, readable.ts}`（替换 builtins/command_exec）

**builtin 拓展 object 加 constructor**
- `packages/@ooc/builtins/{plan,program,file,knowledge,search,skill_index}/executable/index.ts`（皆 isBuiltinFeature=false）

**root methods 退化为 constructor 调度**
- `packages/@ooc/builtins/root/executable/{method.talk,method.do,method.todo,method.plan,method.program,method.open-file,method.open-knowledge,method.write-file,method.glob,method.grep,method.metaprog}.ts`（亦改名 `command.* → method.*`）
- lark 同样退化

**migration**
- 新建 `scripts/migrate-state-context-split.ts` —— 双重 migration：
  (1) 把现存 `flows/<sid>/<wid>/state.json` 中 type ∈ {talk, do, method_exec, todo} 的目录的内容 inline 进所属 thread 的 `<parentOid>/threads/<tid>/context.json`，然后 rm -rf 这些目录；
  (2) 把现存独立 flow object 的 state.json 中可能存在的 contextWindows 字段抽出来，搬进对应 thread 的 context.json，让 state.json 只剩 object 自身字段。
  在 server 启动时 idempotent 跑一次（也支持 CLI 手动）。

**测试**
- 新增 `packages/@ooc/core/executable/windows/_shared/__tests__/constructor-pathway.test.ts`：
  (1) 内置特性 type constructor 返回 `{ok,object}` → **所属 thread 的 `<oid>/threads/<tid>/context.json`** 含新 contextWindow inline，**没有**独立 dir，**parent state.json 不含 contextWindows**；
  (2) 独立 type constructor → 自己 dir 含 `.flow.json:class === object.type` + state.json（仅自身字段，无 contextWindows），所属 thread 的 context.json 多一项 ref；
  (3) `reportStateEdit` 后对应 state.json 立即更新；`reportContextEdit` 后对应 context.json 立即更新；
  (4) class 不存在时 createFlowObject 抛错；
  (5) `lookupMethod` 顺继承链找到 root 方法；
  (6) self.type 不匹配 method 所属 class 时 manager 拒绝 dispatch。
- 现有 `talk-delivery.test.ts / step2-windows.test.ts / refine-failed.test.ts` 等：fixture 改 schema（state vs context 分文件）；method 实现里删除旧 self.type 校验。
- 新增 `migrate-state-context-split.test.ts`。

**meta 文档**
- `meta/object.doc.ts` —— executable.children.command 改名为 executable.children.method；新增 `kind: constructor / class 继承链 / isBuiltinFeature` 子节点（DocTreeNode 叶节点形态，锚定到 method-types.ts 行号）。
- `meta/cookbook.add-new-agent.doc.ts` —— 示例从「写 commands」改为「写 methods」+ 演示 constructor + parentClass 继承 root 的 talk/do。
- 写完每个 doc.ts 立刻 `bun tsc --noEmit meta/<file>.doc.ts` 验证。

**§10 清理：废弃概念**（在 §1–§9 落地完成、所有 caller 迁到新名后执行）
- 删除 `packages/@ooc/core/executable/windows/_shared/registry.ts` 中的 `registerWindowType` / `getWindowTypeDefinition` / `WindowTypeDefinition` alias
- 删除 `command-types.ts` 中 `CommandTableEntry` 的 `@deprecated` re-export（保留实际定义改名为 `ObjectMethod`）
- 删除 `packages/@ooc/builtins/command_exec/` 整个 package 目录；改 `package.json`、`tsconfig*.json`、`apps/server/**` 与 `web/**` 与 `tests/**` 的 import
- grep `WINDOW_REGISTRY` 全树清注释引用：`packages/@ooc/core/executable/windows/_shared/{manager.ts:89,types.ts:19,types.ts:174,registry.ts:111}`、`packages/@ooc/core/executable/windows/index.ts:79`
- `meta/*.doc.ts` 全树替换 `WINDOW_REGISTRY` / `command_exec` / 「commands 字段」 为新名
- `tests/` 全树搜旧名替换

## Verification

```bash
# 1. 类型 + 单测
bun tsc --noEmit
bun test packages/@ooc/core/executable/windows/_shared/__tests__/
bun test packages/@ooc/builtins/

# 2. migration 干净跑
bun run scripts/migrate-state-context-split.ts --world ./.ooc-world-test
ls .ooc-world-test/flows/_test_*/   # 应只剩独立 flow object 目录（user/supervisor/plan/program/file/...），无 form/talk/do 目录

# 3. e2e: 真实 OOC world 跑两轮对话
bun run scripts/experience-harness.ts --world ./.ooc-world-test
ls .ooc-world-test/flows/_test_*/<oid>/.flow.json   # 仅独立 object 有
jq '.class' .ooc-world-test/flows/_test_*/<oid>/.flow.json  # 应为 supervisor / plan / file / ...

# 4. 验证 state vs context 分文件不变量
jq 'has("contextWindows")' .ooc-world-test/flows/_test_*/supervisor/state.json   # 期望: false（不含）
jq '.contextWindows | length' .ooc-world-test/flows/_test_*/supervisor/threads/*/context.json   # ≥ 1（含 talk_window 等内置特性）
```

**手动验收**：体验官在前端跑 supervisor 二轮对话；watch `.ooc-world-test/flows/<sid>/`：
- 仅独立 flow object（user / supervisor / plan / program / file / knowledge / search / skill_index）有 `.flow.json` + `state.json`；talk_window / do_window / form **没有独立目录**
- supervisor/`state.json` 只含 supervisor 自身字段（**不含 contextWindows**）；supervisor/threads/<tid>/`context.json` 中 contextWindows 数组实时反映当前 talk transcript / form 状态
- LLM 一次 `refine` 后 30s 内 supervisor/threads/<tid>/context.json 中对应 form 项的 `accumulatedArgs` 已刷新
- session 重启（删除 manager 内存重 hydrate）后，UI 上的 form 状态 / talk transcript 都从 thread context.json 正确恢复；object 自身字段从 state.json 恢复
- 故意把 `.flow.json:class` 改成不存在 objectId，server 启动应报清晰的 `ClassNotFoundError`
- 自定义 stone object（class: "todo"，parentClass 默认）应能继承 root 的 talk/do 方法

**§10 清理验收**：
```bash
# 旧名彻底消失（除了 §1 表中明确保留一个 release 的 alias，比如 exec tool 的 command 入参）
git grep -n "WINDOW_REGISTRY"           # 期望: 0 hit
git grep -n "registerWindowType\|getWindowTypeDefinition\|WindowTypeDefinition"   # 0
git grep -n "CommandTableEntry"         # 0
git grep -n "command_exec"              # 仅留 §1 表里 1 个 release 的 alias 注释
ls packages/@ooc/builtins/command_exec  # No such file or directory
bun tsc --noEmit                        # 全绿
bun test                                # 全绿
```
