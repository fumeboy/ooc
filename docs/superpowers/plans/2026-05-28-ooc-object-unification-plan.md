# OOC Object Unification Implementation Plan (ooc-6)

**日期：** 2026-05-28
**设计文档：** [2026-05-28-ooc-object-unification-design.md](../specs/2026-05-28-ooc-object-unification-design.md)
**基础分支：** ooc-2（当前 ooc-6 = ooc-2，干净起点）
**原则：** 小步迭代，每步可回滚；Alias first，migrate one at a time；tests green between steps

---

## Phase 0: Design & Meta Documentation Update

### P0.1 更新 meta/object.doc.ts 概念定义

**目标：** 把 Object Unification 的新概念写入权威文档，与代码保持同步。

**改动点：**

1. **root.content** - 更新 stone 五件套描述：
   - `self.md / readme.md / server / client / knowledge` → `self.md / readable.(md|ts) / executable / visible / knowledge`
   - 说明 `readable.md` 是原 `readme.md` 重命名，`readable.ts` 是新增动态渲染
   - 说明 `executable/` 是原 `server/` 重命名，`visible/` 是原 `client/` 重命名

2. **thinkable.children.context** - 更新 ContextWindow 定义：
   - 明确 "ContextWindow 是 OOC Object 出现在 context 中的形态"
   - 说明 context 中的每个 window 背后都对应一个 Object（builtin 或 user-defined）
   - 更新 named 词典中 `ContextWindow` 的定义

3. **thinkable.children.context.children.context_window_reference** - 更新 window 类型列表：
   - 每个 type 现在都是一个 builtin object（位于 `src/extendable/base/<type>/`）

4. **executable.children** - 更新 Command 概念：
   - 原 "Command" → "Method"（概念合并）
   - 说明 Method 有 `public` / `for_ui_access` 两个可见性标记
   - 更新 named 词典

5. **新增 patches** 在 root 节点下：
   - `patches.object_unification`：说明本次归一化的核心主张（window = object in context）
   - `patches.prototype_chain`：说明原型链继承机制
   - `patches.readable_concept`：说明 readable 概念
   - `patches.method_visibility`：说明 public/for_ui_access 标记语义
   - `patches.runtime_object_tree`：说明 `context/` 嵌套目录结构

6. **thinkable.children.knowledge** - 更新 trigger 格式：
   - 新增 `object::<type>` / `method::<type>::<method>` / `object_id::<id>` 格式
   - 说明 `window::` / `command::` 是旧格式，兼容到迁移完成

**验收：**
- `bun tsc --noEmit meta/object.doc.ts` 通过
- 所有新增术语在 `named` 词典中有定义
- 代码锚点正确指向真实文件

---

## Phase 1: Type System & Persistence Helpers

### P1.1 新增 ObjectMethod / ObjectDefinition 类型扩展

**目标：** 在不破坏现有类型的前提下，添加新字段和类型别名。

**改动点：**

1. **`src/executable/windows/_shared/command-types.ts`** - 扩展 `CommandTableEntry`：
   ```typescript
   export interface CommandTableEntry {
     // ... 现有字段 ...
     /** 是否对其他 Object 可见；默认 false = 仅自己 context 中展示 */
     public?: boolean;
     /** 是否可被前端 HTTP API 调用 */
     for_ui_access?: boolean;
   }
   ```
   添加类型别名（向后兼容）：
   ```typescript
   /** @deprecated Use ObjectMethod instead */
   export type CommandTableEntry = ObjectMethod;
   export type ObjectMethod = CommandTableEntry & {
     public?: boolean;
     for_ui_access?: boolean;
   };
   ```

2. **`src/executable/windows/_shared/registry.ts`** - 扩展 `WindowTypeDefinition`：
   ```typescript
   export interface WindowTypeDefinition {
     // ... 现有字段 ...
     /** 原型 object id；继承其 methods / visible / readable */
     prototype?: string;
     /** 动态上下文渲染函数 */
     readable?: (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;
   }
   ```
   添加类型别名：
   ```typescript
   /** @deprecated Use ObjectDefinition instead */
   export type WindowTypeDefinition = ObjectDefinition;
   export type ObjectDefinition = WindowTypeDefinition & {
     prototype?: string;
     readable?: (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;
   };
   ```

3. **`src/executable/windows/_shared/types.ts`** - 添加类型别名：
   ```typescript
   /** @deprecated Use ContextObject instead (window = object in context) */
   export type ContextWindow = ContextObject;
   export type ContextObject = ContextWindow;
   /** @deprecated Use ObjectType instead */
   export type WindowType = ObjectType;
   export type ObjectType = WindowType;
   ```

**验收：**
- `bun tsc --noEmit` 通过
- 所有现有代码无需修改即可编译
- 类型别名指向正确

### P1.2 新增 Persistence 目录辅助函数

**目标：** 添加新目录辅助函数，旧函数标记 deprecated 但保留实现。

**改动点：**

1. **`src/persistable/stone-object.ts`** - 新增：
   ```typescript
   /** @deprecated Use executableDir instead */
   export function serverDir(ref: StoneObjectRef): string;
   export function executableDir(ref: StoneObjectRef): string {
     return join(stoneDir(ref), "executable");
   }

   /** @deprecated Use executableIndexFile instead */
   export function serverIndexFile(ref: StoneObjectRef): string;
   export function executableIndexFile(ref: StoneObjectRef): string {
     return join(executableDir(ref), "index.ts");
   }

   /** @deprecated Use visibleDir instead */
   export function clientDir(ref: StoneObjectRef): string;
   export function visibleDir(ref: StoneObjectRef): string {
     return join(stoneDir(ref), "visible");
   }

   /** @deprecated Use visibleIndexFile instead */
   export function clientIndexFile(ref: StoneObjectRef): string;
   export function visibleIndexFile(ref: StoneObjectRef): string {
     return join(visibleDir(ref), "index.tsx");
   }

   /** readable.md 路径 */
   export function readableFile(ref: StoneObjectRef): string {
     return join(stoneDir(ref), "readable.md");
   }

   /** readable.ts 路径 */
   export function readableTsFile(ref: StoneObjectRef): string {
     return join(stoneDir(ref), "readable.ts");
   }

   /** @deprecated Use readReadable instead */
   export function readReadme(ref: StoneObjectRef): Promise<string>;
   export async function readReadable(ref: StoneObjectRef): Promise<string> {
     // 先试 readable.md，再回退 readme.md（兼容期）
     try { return await readFile(readableFile(ref), "utf8"); } catch { /* ignore */ }
     try { return await readFile(readmeFile(ref), "utf8"); } catch { return ""; }
   }
   ```

2. **`src/persistable/stone-object.ts`** - 更新 `createStoneObject`：
   - 创建 `readable.md` 而非 `readme.md`（空文件占位）
   - 保持 `server/` / `client/` lazy 创建，但新增 `executable/` / `visible/` lazy 创建

3. **`src/persistable/index.ts`** - 更新 barrel exports：
   - 导出新函数 `executableDir` / `executableIndexFile` / `visibleDir` / `visibleIndexFile` / `readableFile` / `readableTsFile` / `readReadable`
   - 旧函数继续导出（标记 deprecated）

**验收：**
- `bun tsc --noEmit` 通过
- 现有调用旧函数的代码继续工作
- 新函数返回正确路径

### P1.3 新增 Runtime Context Object 目录辅助函数

**目标：** 为 runtime object tree（`context/` 嵌套目录）添加路径辅助函数。

**改动点：**

1. **`src/persistable/flow-object.ts`** - 新增：
   ```typescript
   /** flows/<sid>/objects/<oid>/context/<childId>/ */
   export function contextObjectDir(ref: FlowObjectRef, childId: string): string {
     return join(objectDir(ref), "context", childId);
   }

   /** flows/<sid>/objects/<oid>/context/<childId>/state.json */
   export function contextObjectStateFile(ref: FlowObjectRef, childId: string): string {
     return join(contextObjectDir(ref, childId), "state.json");
   }

   /** flows/<sid>/objects/<oid>/context/<childId>/.flow.json */
   export function contextObjectMetadataFile(ref: FlowObjectRef, childId: string): string {
     return join(contextObjectDir(ref, childId), ".flow.json");
   }

   /** 创建 context object 目录并写入元数据 */
   export async function createContextObject(
     parentRef: FlowObjectRef,
     childId: string,
     objectType: string
   ): Promise<FlowObjectRef> {
     const childRef: FlowObjectRef = {
       ...parentRef,
       // objectId 扩展以支持嵌套查找
       objectId: `${parentRef.objectId}/context/${childId}`,
     };
     await mkdir(contextObjectDir(parentRef, childId), { recursive: true });
     const metadata: FlowObjectMetadata = {
       type: "flow-object",
       sessionId: parentRef.sessionId,
       objectId: childRef.objectId,
       objectType,
     };
     await writeFile(contextObjectMetadataFile(parentRef, childId), toJson(metadata), "utf8");
     return childRef;
   }

   /** 列出某 object 的所有 context children */
   export async function listContextObjects(ref: FlowObjectRef): Promise<string[]> {
     try {
       const entries = await readdir(join(objectDir(ref), "context"), { withFileTypes: true });
       return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
     } catch {
       return [];
     }
   }
   ```

2. **`src/persistable/index.ts`** - 导出新函数

**验收：**
- `bun tsc --noEmit` 通过
- 路径生成符合设计 spec
- 创建/读取操作正确

### P1.4 目录移动：windows/_shared → extendable/base/_shared

**目标：** 移动共享类型目录到新位置，保留旧路径作为 re-export alias。

**改动点：**

1. 复制 `src/executable/windows/_shared/` → `src/extendable/base/_shared/`
2. 更新 `src/extendable/base/_shared/` 中的 imports 指向新路径
3. 修改 `src/executable/windows/_shared/` 中的所有文件为 barrel re-exports：
   ```typescript
   // src/executable/windows/_shared/types.ts
   export * from "../../../extendable/base/_shared/types.js";
   export type * from "../../../extendable/base/_shared/types.js";
   ```
4. 更新 `src/executable/windows/index.ts` 中的 imports 先尝试新路径，fallback 旧路径

**验收：**
- `bun tsc --noEmit` 通过
- `bun test` 全通过
- 旧 import 路径继续工作
- 新 import 路径也工作

---

## Phase 2: Registry & Method Visibility

### P2.1 WindowRegistry → ObjectRegistry 名称迁移

**目标：** 重命名 registry，保持旧名称作为 alias。

**改动点：**

1. **`src/extendable/base/_shared/registry.ts`** - 添加：
   ```typescript
   /** @deprecated Use ObjectRegistry instead */
   export const WindowRegistry = ObjectRegistry;
   export const ObjectRegistry = new (class {
     // 现有实现不变
   })();
   ```

2. 更新所有 `registerWindowType` → 添加 `registerObjectType` alias：
   ```typescript
   export function registerObjectType(type: ObjectType, def: ObjectDefinition) {
     return registerWindowType(type, def);
   }
   /** @deprecated Use registerObjectType instead */
   export function registerWindowType(...) { ... }
   ```

3. 同理更新 `getWindowTypeDefinition` → `getObjectTypeDefinition` 等

4. **`src/executable/windows/index.ts`** - 更新 barrel exports

**验收：**
- `bun tsc --noEmit` 通过
- `bun test` 全通过

### P2.2 Prototype Chain 方法查找

**目标：** 实现 prototype chain 方法解析逻辑。

**改动点：**

1. **`src/extendable/base/_shared/registry.ts`** - 新增：
   ```typescript
   /**
    * 解析 object 的完整方法列表（含原型继承）
    * 自身方法覆盖原型方法
    */
   export function resolveObjectMethods(objectType: ObjectType): Record<string, ObjectMethod> {
     const visited = new Set<string>();
     let current: ObjectType | undefined = objectType;
     const result: Record<string, ObjectMethod> = {};

     while (current && !visited.has(current)) {
       visited.add(current);
       const def = getObjectTypeDefinition(current);
       if (!def) break;

       // 原型方法靠后（自身在前，原型在后 = 自身覆盖原型）
       for (const [name, method] of Object.entries(def.commands ?? {})) {
         if (!(name in result)) {
           result[name] = method;
         }
       }

       current = def.prototype as ObjectType | undefined;
     }

     return result;
   }
   ```

2. **`src/extendable/base/_shared/registry.ts`** - 添加 prototype 验证：
   - 在 `registerObjectType` 中检测循环引用（A.prototype = B, B.prototype = A）
   - 循环引用时抛错

3. 初始化 prototype 关系（builtin 之间）：
   - 为简单起见，Phase 2 暂不设置具体 prototype 关系，仅实现机制
   - Phase 4 迁移具体 builtin 时再设置

**验收：**
- 单元测试：prototype 方法被正确继承
- 单元测试：自身方法覆盖原型方法
- 单元测试：循环引用被检测并抛错
- `bun test` 全通过

### P2.3 Method 可见性过滤

**目标：** 实现 `public` / `for_ui_access` 可见性过滤。

**改动点：**

1. **`src/extendable/base/_shared/registry.ts`** - 新增：
   ```typescript
   /** 过滤出 public 方法（供其他 object 的 context 展示） */
   export function filterPublicMethods(
     methods: Record<string, ObjectMethod>
   ): Record<string, ObjectMethod> {
     return Object.fromEntries(
       Object.entries(methods).filter(([_, m]) => m.public === true)
     );
   }

   /** 过滤出可被前端调用的方法 */
   export function filterUiAccessibleMethods(
     methods: Record<string, ObjectMethod>
   ): Record<string, ObjectMethod> {
     return Object.fromEntries(
       Object.entries(methods).filter(([_, m]) => m.for_ui_access === true)
     );
   }
   ```

2. **`src/thinkable/context/render.ts`** - 更新 window 渲染：
   - 渲染其他 object（非自身）的方法列表时，调用 `filterPublicMethods`
   - 自身 object 的方法列表不过滤

3. **`src/app/server/index.ts`** - 更新 `/api/objects/:id/exec` 路由：
   - 调用前检查 `for_ui_access === true`
   - 不满足返回 403

**验收：**
- 单元测试：public: false 的方法不出现在其他 object 的 context 中
- 单元测试：for_ui_access: false 的方法不能通过 API 调用
- `bun test` 全通过

---

## Phase 3: Readable Concept Implementation

### P3.1 Readable 加载逻辑

**目标：** 实现 readable.md / readable.ts 加载和渲染。

**改动点：**

1. **`src/persistable/stone-object.ts`** - 新增：
   ```typescript
   export type ReadableFn = (ctx: {
     self: ProgramSelf;
     thread?: ThreadContext;
     window?: ContextObject;
   }) => XmlNode[] | Promise<XmlNode[]>;

   /**
    * 加载 object 的 readable 函数
    * 优先级：readable.ts > readable.md > 无
    */
   export async function loadReadable(
     ref: StoneObjectRef
   ): Promise<{ kind: "ts" | "md" | "none"; content: string | ReadableFn | undefined }> {
     // 1. 尝试加载 readable.ts
     try {
       const stats = await stat(readableTsFile(ref));
       const mod = await import(`${readableTsFile(ref)}?t=${stats.mtimeMs}`);
       if (mod.default && typeof mod.default === "function") {
         return { kind: "ts", content: mod.default as ReadableFn };
       }
     } catch { /* ignore */ }

     // 2. 尝试加载 readable.md
     try {
       const content = await readReadable(ref);
       if (content.trim()) {
         return { kind: "md", content };
       }
     } catch { /* ignore */ }

     return { kind: "none", content: undefined };
   }
   ```

2. **`src/thinkable/context/render.ts`** - 更新渲染流程：
   ```
   renderWindow(ctx):
     1. 尝试加载 object 的 readable.ts
     2. 若有 → 调用它获取 XmlNode[]
     3. 否则若有 readable.md → 渲染为 <readable> 节点
     4. 否则 → 走 type 默认 renderXml（保持现状）
   ```

3. 在 `render.ts` 中添加 readable 缓存（按 mtime）

**验收：**
- 单元测试：readable.ts 被正确调用
- 单元测试：readable.md 被正确渲染
- 单元测试：无 readable 时 fallback 到默认渲染
- `bun test` 全通过

### P3.2 createStoneObject 默认文件更新

**目标：** 新创建的 stone object 使用 readable.md 而非 readme.md。

**改动点：**

1. **`src/persistable/stone-object.ts`** - 更新 `createStoneObject`：
   - 创建 `readable.md`（空文件）而非 `readme.md`
   - 不再预创建 `readme.md`

2. **`src/persistable/stone-object.ts`** - 更新 `readReadable` 兼容逻辑：
   - 先读 `readable.md`，不存在再读 `readme.md`
   - 两个都不存在返回空字符串

**验收：**
- 新创建的 object 有 readable.md，无 readme.md
- 旧 object 有 readme.md 仍能正常读取
- `bun test` 全通过

### P3.3 现有 stone object 双读兼容

**目标：** 确保现有 stone objects（.ooc-world/stones/）在迁移期能正常工作。

**改动点：**

1. 检查 `.ooc-world/stones/_builtin/objects/` 下的 builtin objects：
   - 将 `readable.md` 保留（已经存在）
   - 确认没有 `readme.md` 冲突

2. 检查 `.ooc-world/stones/main/objects/user/`：
   - 将 `readable.md` 保留（已经存在）
   - 确认没有 `readme.md` 冲突

3. 添加一个测试 stone object 同时有 readable.md 和 readme.md，验证 readable.md 优先

**验收：**
- 现有 stone objects 正常加载
- readable.md 优先级高于 readme.md
- `bun test` 全通过

---

## Phase 4: Builtin Objects Migration（逐个迁移）

**重要澄清（2026-06-01）**：`do` 和 `talk` **不**作为独立 builtin object 迁移。
它们是所有 OOC Object 的基础属性/能力（每个 Object 天然具备"执行任务"和"通信"的能力），
代码逻辑保留在 `src/executable/windows/do/` 和 `src/executable/windows/talk/` 作为通用能力层，
不迁移到 `src/extendable/base/`。它们仍会以 context window 形式出现在 context 中（表示 Object 的执行/对话状态）。

**原则：** 每次只迁移一个 window type，迁移完成后测试全绿再继续。

### 迁移通用模板（每个 type 都走这个流程）

对于每个 `<type>`（knowledge → file → todo → search → skill_index → plan → command_exec → program → root → custom）：

#### Step 4.X.1 移动目录
```bash
cp -R src/executable/windows/<type>/ src/extendable/base/<type>/
```

#### Step 4.X.2 按新结构拆分
```
src/extendable/base/<type>/
├── executable/
│   └── index.ts       # 原 command.*.ts 的内容，整理成 methods
├── visible/
│   └── index.tsx      # 从 web/src/.../<Type>Diff.tsx 迁移来的 UI 组件
├── readable.ts        # 原 renderXml 函数移到这里
├── types.ts           # 原类型定义
└── index.ts           # barrel + registerObjectType 调用
```

#### Step 4.X.3 更新 imports
- 所有内部 import 指向新路径
- 旧路径 `src/executable/windows/<type>/` 改为 barrel re-export

#### Step 4.X.4 设置 prototype（如有需要）
- 在 `registerObjectType` 调用中添加 `prototype` 字段（如需要）

#### Step 4.X.5 标记 method 可见性
- 为每个 method 添加 `public` / `for_ui_access` 标记（基于原设计意图）

#### Step 4.X.6 跑测试
- `bun test` 必须全通过
- 相关 e2e 测试必须通过

---

### P4.1 迁移 knowledge window → knowledge builtin object

**说明：** 最简单的 window type，无 command exec 副作用，作为第一个迁移验证流程。

**结构：**
- `executable/index.ts`：close / reload 方法
- `readable.ts`：原 `renderXml`（展示 path + content）
- `visible/index.tsx`：从 `KnowledgeWindowDiff.tsx` 迁移
- `types.ts`：`KnowledgeWindow` → `KnowledgeObject` 类型别名

**Method 可见性：**
- `close`: `public: false, for_ui_access: true`
- `reload`: `public: false, for_ui_access: true`

**验收：**
- `bun test` 全通过
- knowledge 相关测试通过
- Web UI 中 knowledge object 正确渲染

### P4.2 迁移 file window → file builtin object

**结构：**
- `executable/index.ts`：set_viewport / set_range / reload / edit / close 方法
- `readable.ts`：原 `renderXml` + `compressFileWindow`
- `visible/index.tsx`：从 `FileWindowDiff.tsx` 迁移
- `types.ts`：`FileWindow` → `FileObject` 类型别名

**Method 可见性：**
- `set_viewport`: `public: false, for_ui_access: true`
- `edit`: `public: false, for_ui_access: false`（需权限控制）
- `close`: `public: false, for_ui_access: true`

### P4.3 迁移 todo window → todo builtin object
### P4.4 迁移 search window → search builtin object
### P4.5 迁移 skill_index window → skill_index builtin object
### P4.6 迁移 plan window → plan builtin object
### P4.7 迁移 command_exec window → command_exec builtin object
### P4.8 迁移 program window → program builtin object
### P4.9 迁移 root window → root builtin object
### P4.10 迁移 custom window → custom builtin object

每个迁移都遵循通用模板，细节在执行时确定。

**do/talk 说明**：do 和 talk 作为所有 Object 的固有能力，不单独迁移为 builtin object。
它们的代码保留在 `src/executable/windows/do/` 和 `src/executable/windows/talk/`，作为通用能力层。

---

## Phase 5: Runtime Object Persistence

### P5.1 WindowManager 同步写入 context/ 目录

**目标：** 创建/更新 window 时同步写入 `context/<id>/state.json`。

**改动点：**

1. **`src/extendable/base/_shared/manager.ts`** - 更新 `WindowManager.addWindow`：
   - 创建 window 时调用 `createContextObject`
   - 写入 `state.json`（window 的完整序列化状态）

2. **`src/extendable/base/_shared/manager.ts`** - 更新 `WindowManager.updateWindow`：
   - 更新 window 时同步更新 `state.json`

3. **`src/extendable/base/_shared/manager.ts`** - 更新 `WindowManager.removeWindow`：
   - 移除 window 时删除 `context/<id>/` 目录（或标记 archived）

4. 写入走 `enqueueSessionWrite` 队列，不阻塞 thinkloop

**验收：**
- 单元测试：window 创建后 context/ 目录下有对应子目录和 state.json
- 单元测试：window 更新后 state.json 同步更新
- `bun test` 全通过

### P5.2 buildContext 双源读取

**目标：** buildContext 同时从 `thread.contextWindows[]` 和 `context/` 目录读取。

**改动点：**

1. **`src/thinkable/context/index.ts`** - 更新 `buildContext`：
   - 从 `thread.contextWindows[]` 读取（兼容旧数据）
   - 从 `context/` 目录扫描 runtime objects
   - 合并两个来源（去重：以 id 为 key，context/ 优先）

2. 添加缓存：`context/` 目录扫描结果按 mtime 缓存

**验收：**
- 单元测试：双源读取正确合并
- 单元测试：旧 thread.json（只有 contextWindows）仍能正常加载
- `bun test` 全通过

### P5.3 停止写入 thread.contextWindows[]

**目标：** 新数据只写入 `context/` 目录，`thread.contextWindows[]` 只读。

**改动点：**

1. **`src/extendable/base/_shared/manager.ts`** - 修改：
   - `addWindow` 不再 push 到 `thread.contextWindows[]`
   - `updateWindow` 不再更新 `thread.contextWindows[]`
   - `removeWindow` 不再从 `thread.contextWindows[]` 删除

2. 保持 `thread.contextWindows[]` 字段存在，用于读取旧数据

**验收：**
- 新创建的 window 只出现在 context/ 目录，不在 thread.contextWindows[]
- 旧 thread.json（有 contextWindows）仍能正常工作
- `bun test` 全通过

### P5.4 移除 thread.contextWindows[] 字段

**目标：** 最终移除字段，只保留 context/ 目录读取。

**改动点：**

1. **`src/thinkable/context/index.ts`** - 从 `ThreadContext` 类型中移除 `contextWindows` 字段
2. 更新所有引用 `thread.contextWindows` 的代码
3. 添加迁移兼容：读取旧 thread.json 时自动将 contextWindows 转存到 context/ 目录

**验收：**
- `bun tsc --noEmit` 通过
- `bun test` 全通过
- 旧数据自动迁移

---

## Phase 6: Relation Window → Peer/Children Auto-Entry

### P6.1 移除 relation window type

**目标：** 取消 relation window，改为 peer/children 自动注入。

**改动点：**

1. 从 `src/extendable/base/` 移除 `relation/` 目录
2. 从 `WindowType` 枚举中移除 `"relation"`
3. 从 `listRegisteredWindowTypes` 中排除
4. 移除 relation 相关的 knowledge triggers

### P6.2 Peer/Children 引用注入

**目标：** 每轮 buildContext 自动注入 peer 和 children object 引用。

**改动点：**

1. **`src/thinkable/context/index.ts`** - 在 `buildContext` 末尾添加：
   ```typescript
   async function injectPeerChildrenRefs(thread: ThreadContext, objectRef: StoneObjectRef) {
     const { siblings, children } = await discoverStoneHierarchicalPeers(objectRef);
     // 为每个 peer 创建轻量引用
     // 为每个 child 创建轻量引用
     // 注入到 context 中（压缩态，仅 id + title + public methods）
   }
   ```

2. 渲染格式：
   ```xml
   <context_peers>
     <object_ref id="sentry/sentry_event" title="事件因子分析"
                 public_methods="query,analyze" status="idle"/>
   </context_peers>
   <context_children>
     <object_ref id="sentry/children/sentry_event_factor" title="单因子计算"
                 public_methods="run" status="idle"/>
   </context_children>
   ```

### P6.3 添加 enter 方法

**目标：** LLM 可以通过 `exec(<id>, "enter")` 将引用转为全量 window。

**改动点：**

1. 在 `root` builtin object 上添加 `enter` method：
   - `exec(root, "enter", args={ object_id: "<id>" })`
   - 将对应 object 以全量形式加入当前 context
   - 创建对应的 context object 目录

**验收：**
- 单元测试：peer/children 引用正确注入
- 单元测试：enter 方法将引用转为全量 window
- relation 相关的 e2e 测试更新后通过
- `bun test` 全通过

---

## Phase 7: Web UI Migration

### P7.1 API 路由更新

**目标：** `/api/windows/*` → `/api/objects/*`，旧路由保留 alias。

**改动点：**

1. **`src/app/server/index.ts`** - 新增路由：
   - `GET /api/objects/types` → 调用 `listRegisteredObjectTypes`
   - `GET /api/objects/catalog` → 返回 object catalog（含 methods）
   - `POST /api/objects/:id/exec` → 调用 method（检查 `for_ui_access`）
   - `GET /api/objects/:id/visible` → 返回 visible 模块源码（供前端动态加载）

2. 旧路由 `/api/windows/*` 保留为 301 重定向或 proxy 到新路由

### P7.2 前端 Hook 更新

**目标：** `useWindowTypes` → `useObjectTypes`。

**改动点：**

1. **`web/src/domains/objects/window-types.ts`** → 重命名为 `object-types.ts`
2. 更新 hook 调用新 API
3. 保留旧 hook 作为 alias（标记 deprecated）

### P7.3 Window Diff Registry 动态加载

**目标：** 前端渲染器从静态 switch-case 改为动态加载 object visible 模块。

**改动点：**

1. **`web/src/domains/sessions/components/window-diff-renderers/registry.ts`** - 重写：
   ```typescript
   async function getRenderer(objectType: string, objectId?: string) {
     // 1. 尝试加载 /api/objects/:objectId/visible
     // 2. 尝试加载 builtin object 的 visible 模块（预打包）
     // 3. fallback 到 FallbackJsonDiff
   }
   ```

2. 常用 builtin object 的 visible 模块预打包，避免运行时加载闪屏

### P7.4 逐个迁移 *Diff.tsx 到 visible/

按 P4 的迁移顺序，逐个将 `*Diff.tsx` 移动到对应 builtin object 的 `visible/` 目录。

**验收：**
- Web UI 能正常渲染所有 object type
- 动态加载无闪屏
- E2E frontend 测试通过

---

## Phase 8: Knowledge Trigger Migration

### P8.1 新旧格式自动映射

**目标：** 系统内部自动将旧 trigger 格式映射到新格式。

**改动点：**

1. **`src/thinkable/knowledge/triggers.ts`** - 在 trigger 评估时：
   - 遇到 `window::<type>` → 同时匹配 `object::<type>`
   - 遇到 `command::<type>::<cmd>` → 同时匹配 `method::<type>::<cmd>`
   - 新格式 `object_id::<id>` 直接匹配

### P8.2 更新 builtin knowledge 到新格式

逐个更新 `.ooc-world/stones/_builtin/objects/<type>/knowledge/` 下的 knowledge 文件，将 `activates_on` 改为新格式。

### P8.3 添加 lint 规则禁止旧格式

在 CI 中添加检查：新的 knowledge 文件不得使用 `window::` / `command::` 格式。

**验收：**
- 旧 knowledge 文件继续工作（自动映射）
- 新 knowledge 使用新格式
- `bun test` 全通过

---

## Phase 9: Cleanup

### P9.1 移除 deprecated 旧函数
### P9.2 移除 thread.contextWindows[] 字段（如 P5.4 未完成）
### P9.3 移除旧 API 路由 alias
### P9.4 移除旧 trigger 格式兼容代码
### P9.5 移除 `src/executable/windows/` 目录（全部迁移完成后）

---

## 测试与验收总览

### 测试回归（每阶段后必须）
```bash
# 类型检查
bun tsc --noEmit
bun tsc --noEmit meta/object.doc.ts

# 单元测试 + 集成测试
bun test

# E2E 测试
cd tests/e2e/backend && bun test
cd tests/e2e/frontend && bun test

# 特定 e2e 场景
# R1: basic session flow
# R2: routing and client tree
# R3: multi-object collaboration
```

### Harness 真实体验（所有阶段完成后）
1. 启动 app server：`bun run src/app/server/index.ts --world ./.ooc-world-test`
2. 启动 web dev：`cd web && bun dev`
3. 通过 harness 循环执行典型场景：
   - 创建新 session
   - 打开 file object
   - 编辑文件
   - fork do 子线程
   - talk to user
   - 元编程：修改 object 的 executable/visible/readable
4. 记录体验报告，沉淀 Issue

---

## 风险与回滚计划

### 回滚策略
每个阶段都是独立的 commit，可以独立回滚：
- Phase 0: `git revert <phase0-commit>`
- Phase 1: `git revert <phase1-commits>`
- ... 以此类推

### 关键检查点
- P1 完成后：所有类型兼容，测试全绿
- P4.1 完成后：第一个 builtin object 迁移成功，流程验证
- P5.3 完成后：持久化切换到新路径，双读验证
- P9 完成后：全系统迁移完成，清理完毕

### 中止条件
- 任一阶段 `bun test` 失败且 1 小时内无法修复 → 回滚到上一阶段
- 性能下降超过 20%（thinkloop 耗时）→ 回滚调查
- E2E 场景评分下降（Good→OK 或 OK→Bad）→ 回滚修复
