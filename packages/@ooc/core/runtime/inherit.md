# OOC class 继承范式 · cookbook

> 由 issue 2026-06-25-inheritance-via-source-import-spread.md 裁决产出。
> 权威设计见 `.ooc-world-meta/.../objects/supervisor/children/object/self.md` 核心 2。

OOC **协议层不内建任何继承 / dispatch chain 机制**。ClassRegistry 注册扁平的 class 定义，无 chain
元信息、无沿链 fallback。class 想复用另一个 class 的能力，由其 `index.ts` 用 TS 标准 `import` +
对象 `spread`（或 method 级 import 函数 + 显式调）在源码侧完成。

本文档列出三种合法范式 + super-call / lifecycle / 常见反例 / mixin / ESM live binding 边界，
供 class 作者选用。

## 三种合法范式 + 何时用哪种

### 范式 A：无 `index.ts`（默认）

当 object 只持身份 + knowledge、不需要写自己的程序面时，**完全不必写 index.ts**：

- 目录只有 `package.json` + `self.md`（agent）+ `readable.md` + `knowledge/`
- `package.json` 的 `ooc.class` 字段单跳 binding 一个父 class
- ServerLoader 看到无 `index.ts`，hydrate 时令 `OocObjectInstance.class = ooc.class`（=父 class id）
- 运行时所有 `resolveXxx` 直接命中父 class 字段
- 例：`.ooc-world-meta/.../objects/supervisor/` —— 完全继承 `agent` class 的程序面，只持身份与知识

**何时用**：object 不需要任何 override，只想换身份 + knowledge。

### 范式 B：手写 spread

当需要少量 override（如加一个 method）时：

```ts
import { Class as parentClass } from "@ooc/builtins/agent";
import { myNewMethod } from "./executable/method.my-new.js";

export const Class: OocClass<Data> = {
  ...parentClass,
  id: "child",
  executable: {
    methods: [...parentClass.executable!.methods, myNewMethod],
  },
};
```

注意 `{ ...parent, override }` 顺序（spread 在前，override 在后）。
反例：`{ id: "child", ...parent }` 错——id 被父覆盖回。

**何时用**：override 不多、想让代码完全自描述、不引外部 helper。

### 范式 C：`extendClass` helper（样板代码长时）

```ts
import { extendClass } from "@ooc/core/runtime/inherit.js";
import { Class as agentClass } from "@ooc/builtins/agent";
import { myNewMethod } from "./executable/method.my-new.js";

export const Class = extendClass(agentClass, {
  id: "coder",
  executable: { methods: [myNewMethod] }, // 自动与父 methods 按 name merge
});
```

**仅 executable.methods 一档**做 method-level merge（按 method name，子覆盖父，整 `ObjectMethod`
引用保留含 `route` / `intents` / `schema` / `description` 等所有字段）。其他 facet
（readable / persistable / visible / thinkable）整体替换或子手写 spread。

**何时用**：override 多条 method、想免写 `[...parent.methods, ...]` 数组并发处理重名时。

## super-call 完整模板（裁决 D6）

子 override 父 method 时，**必须 spread 整 method 对象**（不能只覆盖 `exec`），否则丢失父的
`route` / `intents` / `schema` / `description` / `permission` / `public` 等字段：

```ts
import { talkMethod as parentTalk } from "@ooc/builtins/agent/executable/method.talk.js";

export const talkMethod: ObjectMethod<Data> = {
  ...parentTalk,                       // route / intents / schema / description 全部继承
  exec: async (ctx, self, args) => {   // 仅 override exec
    observeLog("coder.talk.audit", args.target);
    return parentTalk.exec(ctx, self, args);
  },
};
```

`route` / `intents` 经 spread 自动继承——丢 `route` 会让 knowledge 激活（`method::class::method`
trigger）失效。

## lifecycle 父钩子串调（裁决 D10 → 落 `object/self.md` 核心 10）

`active` / `unactive` 钩子父子串调**不内建**——子 override 时由子代码控制顺序：

```ts
import { Class as parent } from "@ooc/builtins/agent";

export const Class = {
  ...parent,
  id: "child",
  active: {
    description: "child active hook",
    exec: async (ctx, self) => {
      await parent.active?.exec(ctx, self); // ← 显式调父（注意：parent 是 import 来的引用，不是 spread 后字段）
      // 自己加的逻辑
    },
  },
};
```

- 漏调父钩子由代码评审拦截。
- 父钩子可缺省（`parent.active?.exec`）—— 用 optional chaining 兼容父无该钩子的情形。
- 同理 `unactive`、`init`。

## 常见反例 / 陷阱

1. **spread 顺序反**

   ```ts
   { id: "child", ...parent }   // 错：id 被父的 id 覆盖回
   { ...parent, id: "child" }   // 对
   ```

2. **浅拷贝 + 共享 facet 引用**

   `{ ...parentClass }` 是**浅拷贝**——`executable` / `readable` 等 facet 仍指向父的同一对象。
   **不要**在运行时 `cls.executable.methods.push(...)`——会跨 class 泄露到父。`OocClass` 及其
   facet 注册后视为 immutable。要扩 methods 必须新建数组：`{ methods: [...parent.methods, my] }`。

3. **只 override `exec` 丢 `route`**

   见上方「super-call 完整模板」。错误写法：

   ```ts
   { name: "talk", exec: newExec }  // ← 丢了 parentTalk 的 route / intents / schema
   ```

   正确：`{ ...parentTalk, exec: newExec }`。

4. **子加 method 与父同名 + 漏掉父对应 entry**

   ```ts
   methods: [...parent.methods, myTalk]   // 父若已有 talk，运行时命中第一个（父的）
   ```

   `resolveObjectMethod` 不做去重——`assertNoMethodNameCollision` 已加内部自查重 fail-loud。
   想 override 父 method：
   - 用 `extendClass`（自动按 name merge）；或
   - 手写 spread + `filter`：`[...parent.methods.filter(m => m.name !== "talk"), myTalk]`。

## 多继承 / mixin

```ts
{ ...A, ...B, ...own }   // spread 顺序 = right-most wins，B 覆盖 A、own 覆盖 B
```

OOC **不内建** MRO（method resolution order）。多继承一致由 TS spread 顺序解决——作者自己负责
顺序合理。复杂场景建议拆成「composition over inheritance」：把 A / B 的能力提成 helper
函数，在 own 的 method 体内显式调，比 spread 链路更可读。

## ESM live binding 边界（澄清）

`{ ...parentClass }` spread 拿到的是**父 facet 对象的引用**（浅拷贝）。父 module 重新 import
（如 ServerLoader 监测父 stone 改动后 `invalidateStone` 重 import）后，父的 facet 对象**是新引用**
——要让子也拿新版本必须**重新注册子**（`serverLoader.invalidateStone(<child-stone>)` + 下次
hydrate 时子的 `index.ts` 重新 `import` 父并 spread）。这**不是** ESM live binding 透明同步。

issue 改动 3 原稿「ESM live binding 自动同步」措辞已被裁决 D2 / D7 修正：父 class 改动 →
`invalidateStone` + 重新 spread 注册。子 stone 的 watcher 由 hot-reload 路径触发。

## 进一步阅读

- 设计核心：`.ooc-world-meta/.../objects/supervisor/children/object/self.md` 核心 2 / 核心 10
- 引发本文档的 issue：`.ooc-world-meta/stones/main/docs/issues/2026-06-25-inheritance-via-source-import-spread.md`
- helper 源码：`packages/@ooc/core/runtime/inherit.ts`
- runtime 解析路径：`packages/@ooc/core/runtime/object-registry.ts` 的 `resolveXxx`
