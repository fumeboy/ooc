# OOC Class —— 一等继承抽象设计

> 状态：设计稿（2026-06-07，Supervisor 自主推进）。本文件是权威设计来源；实现计划见
> 同期 plan 文档。断言锚定真实代码 `file:行号`；源代码与本文分歧时信任源代码。

## 1. 动机

两个观察暴露了同一个缺口——OOC 缺少显式的「类」抽象：

1. **全新 world 撞「需要先创建至少一个 stone」门槛**（welcome 体验）。根因：对话目标列表
   只取 `/api/stones`，而 builtin 的 supervisor 既不在 world 的 stones 也不在 world 的 packages
   里。临时修复 `withBuiltinTalkTargets`（commit c44a0042）把 supervisor 硬塞进 listStones，
   是特殊逻辑而非通用解。

2. **builtin 的 self.md/knowledge 从磁盘读永远落空**。`loadSelfInstructions → readSelf →
   stoneDir(builtinRef)` 把 builtin 解析到 `<world>/packages/@ooc/builtins/<id>/`
   （`packages/@ooc/core/persistable/common.ts:86`），而任何 world 的 `packages/` 都是空的
   （无 bootstrap 把 builtins vendor 进 world）。runtime 能跑 supervisor 是因为 ObjectType
   经 module import 注册（`builtinRegistry` seedFrom，`packages/@ooc/core/runtime/world-runtime.ts:78`），
   但 self.md 身份 instructions 走磁盘 readSelf 这条路返回 undefined——supervisor 一直靠 LLM
   从 objectId + root 知识即兴演「总管」，没真正加载到 self.md 写的角色/边界/知识索引。

OOC 当前已有**两条未统一的继承载体**（`packages/@ooc/meta/object.doc.ts:1629`）：
`prototype`（self.md frontmatter，stone 侧实例链）vs `parentClass`（registry 侧类链，
method 解析）。两套并存、语义模糊。

**本设计**：把 `class` 提升为与 `object` 平级的一等概念，作为**唯一**继承机制，
彻底剔除 `prototype`；并以 `instantiate_with_new_world` 让 builtin class 在新 world
自动实例化出可交互 object。这同时通用地解决上面两个缺口。

## 2. 核心模型

### 2.1 class vs object

- **object**：可交互 Agent。持有五件套（self.md / readable / executable / visible /
  knowledge），可被 talk、跑 thinkloop。
- **class**：**不可交互**的类定义。组成与 object 几乎一致（同样五件套），唯一区别是
  **不能被 talk、不跑 thinkloop**——只供 object 继承。
- **单继承**：一个 object 至多有一个 class；class 也可继承另一个 class（单链）。**不支持多继承**。
- **class 是唯一继承机制**：`prototype`/原型链相关设计全部删除（代码 + 文档 + 注释，
  不保留兼容层）。

### 2.2 持久化布局

```
stones/<branch>/
├── objects/<id>/     # 可交互 Agent（五件套；own-or-inherit）
└── classes/<id>/     # 不可交互类定义（五件套；仅被继承）          ← 新增
```

`objects/` 是现有布局（`packages/@ooc/core/persistable/common.ts` 的 `STONE_OBJECTS_SUBDIR`）。
`classes/` 是对称新增的同级子树，走同一套 git worktree 版本化（main = canonical）。

### 2.3 两路 class 解析

class `X` 的定义按优先级解析：

1. **world 级 class**：`stones/<branch>/classes/X/`（用户在 world 里建/覆盖）。
2. **框架 builtin class**：从 `@ooc/builtins/X` 包解析（node 模块解析，**不 vendor 进 world**）。

world 覆盖框架——与 stone 现有多根解析（stones/ > packages/ > builtins）对称
（`packages/@ooc/core/runtime/stone-registry.ts:164-188`）。

> **关键**：builtin class 的五件套文件（含 self.md）从**框架包**读，而非
> `<world>/packages/...`。这条解析路径的修正即第 1 节缺口 2 的结构性修复。

### 2.4 object 五件套的 own-or-inherit 解析

object 读任一五件套文件时：own 目录有该文件用 own，否则沿 `class` 链回退
（world class 目录 → 框架 builtin class），方法解析链最终回退 `root`
（沿用现有 `resolveMethod`，`packages/@ooc/core/executable/windows/_shared/registry.ts:503`）。

## 3. class 载体与声明

- object 用其 `package.json` 的 `ooc.class = "<classId>"` 声明所属 class
  （与现有 `ooc.objectId` / `ooc.kind` / `ooc.type` 并列，
  `packages/@ooc/core/runtime/stone-registry.ts:23` 的 `oocMetadata`）。
  **替代**被删除的 self.md `prototype` frontmatter。
- 运行时 flow object 实例化读 `ooc.class` → 写 `.flow.json:class`（复用现有机制，
  `packages/@ooc/core/persistable/flow-object.ts:82-94`；未注册 class 抛
  `ClassNotFoundError`，fail-loud）。
- class 自身的 `package.json`：`ooc.kind = "class"`（新 kind 值；现有为
  `builtin`/`object`/`stone`），可继续带 `ooc.class` 指向父 class（单链继承）。

## 4. 实例化：instantiate_with_new_world

- class 的 `package.json` 声明 `ooc.instantiate_with_new_world: true`。
- **world bootstrap**（现有 builtin 循环处 `packages/@ooc/core/app/server/index.ts:282`）：
  对每个带此 flag 的（框架 + world）class，**幂等**创建 object：
  - 落 `stones/main/objects/<classId>/`，写 `package.json`（`ooc.objectId=<classId>`,
    `ooc.class=<classId>`）；
  - **拷贝 class 的 self.md** 进 object（own 身份）；
  - commit on main（走现有 stone-versioning worktree → ff merge）。
  - **object 已存在则跳过**（保住用户后续对 self.md 的改动）。
- `supervisor` class 设 `instantiate_with_new_world: true` → 每个新 world 自动有一个
  可交互的 supervisor object。

## 5. 升级传播语义

- **仅 self.md 在实例化时拷贝快照**：每个 world 的实例拥有独立、可编辑的身份；框架后续
  改 class 的 self.md **不回灌**已存在实例。
- **executable / visible / readable / knowledge 活继承**：框架升级 class 的方法/UI/展示/
  知识，自动对所有未覆盖的实例生效；object 写了 own 文件即覆盖（copy-on-write 语义）。
- 一句话：**own 身份、共享行为**。这与 session-worktree（fork main → 改 → evolve_self
  merge）的「fork 点拥有、未改部分跟随」语义同构。

## 6. 非交互约束与收尾

- **talk 目标列表 = 仅 objects**：`listStones`（或其替代）只返回
  `stones/<branch>/objects/`（含自动实例化的 supervisor）。classes 永不出现在对话目标里。
- **seedSession 拒绝以 class 为 target**（fail-loud，`INVALID_INPUT`，
  `packages/@ooc/core/app/server/modules/flows/service.ts:388`）。
- **移除 `withBuiltinTalkTargets`**（commit c44a0042 的 listStones 合入逻辑）——supervisor
  现在是真 object，正常加载，特殊逻辑退场。前端 `defaultObjectId` 仍可优先 supervisor
  （现在指向真 object，无害；保留）。
- **`BUILTIN_OBJECT_IDS` 重构**：supervisor 从「解析到 packages 路径的 builtin object id」
  退场，改为「框架 builtin **class** + 自动实例化 object」。`user` 仍作 caller 保留
  （被动、ephemeral、非 stone、非实例化、`seedSession` 已拒绝其为 target）。
- **`meta/object.doc.ts`**：新增 class 一等概念节点（classes/ 持久化、非交互、单继承、
  instantiate_with_new_world、两路解析、own-or-inherit）；删除 `prototype` 相关表述与
  `parent_class_inheritance` 节点里「prototype 与 parentClass 尚未统一」的旧注（现已统一于 class）。

## 7. prototype 剔除范围

以下文件含 `prototype` 触点，需删除相关代码/注释（无兼容层）：

- `packages/@ooc/core/executable/object/object-types.ts`
- `packages/@ooc/core/runtime/object-type-registrar.ts`（`resolveParentClass` 中读 self.md
  `prototype:` frontmatter 的分支删除，改为读 `ooc.class`）
- `packages/@ooc/core/runtime/stone-registry.ts`（`oocMetadata.prototype` 字段删除）
- `packages/@ooc/core/runtime/object-registry.ts`
- `packages/@ooc/core/_shared/types/registry.ts`
- `packages/@ooc/core/thinkable/knowledge/synthesizer.ts`（`readSelfPrototype` 删除）
- `packages/@ooc/meta/object.doc.ts`（文档表述）
- `packages/@ooc/cli/src/commands/init.ts`

`scripts/check-no-deprecated-symbols.sh` 可加 `prototype` 为禁用符号守门（防回流）。

## 8. 分期与验证

每期独立可验证（tsc 干净 + 本期单测 + 关键 e2e）。

### P0 前置：builtin 源解析改指框架包
- 修 builtin 五件套的磁盘解析：从 `<world>/packages/@ooc/builtins/<id>`（空）改为框架包
  （`require.resolve("@ooc/builtins/<id>")` 或等价）。
- **验证**：`GET /api/stones/supervisor/self`（暂仍走 builtin 路径）能读到框架 self.md；
  单测覆盖 builtin self 解析。

### P1：class 一等化
- `classes/` 持久层（`stoneDir`/`resolveStoneDir`/registry scan 支持 `classes/` 子树）。
- 两路 class 解析（world classes/ > 框架 builtin class）。
- ObjectRegistry 从框架 `@ooc/builtins/` 按 id 注册 builtin class（registrar scanTree 指向框架包）。
- object `ooc.class` 载体（package.json）；删 self.md `prototype` 读取，改读 `ooc.class`。
- **剔除 prototype**（第 7 节全部触点）+ check-no-deprecated-symbols 守门。
- **验证**：单测——object `ooc.class=X` 的方法沿 class 链解析；prototype 符号全消失；tsc 干净。

### P2：实例化
- class `package.json` 支持 `ooc.kind="class"` + `ooc.instantiate_with_new_world`。
- supervisor 改为 class（`packages/@ooc/builtins/supervisor` 的 package.json：
  `kind="class"`, `instantiate_with_new_world=true`）。
- bootstrap 实例化循环：幂等建 object + 拷贝 self.md + commit；object 已存在跳过。
- talk 目标仅 objects；seedSession 拒绝 class target；**移除 withBuiltinTalkTargets**。
- **验证**：单测——bootstrap 后 `objects/supervisor/` 存在且含 self.md 拷贝、`ooc.class=supervisor`；
  幂等（二次 bootstrap 不覆盖改动）；listStones 含 supervisor object、不含任何 class；
  seedSession target=某 class → 422/INVALID_INPUT。

### P3：收口
- `meta/object.doc.ts` 更新（class 一等节点 + 删 prototype），`bun tsc --noEmit` 验证 doc。
- e2e：全新 world → 自动有 supervisor object → 对话时 thinkloop **真正加载到 supervisor
  的 self.md 身份**（context snapshot 含 self instructions）。
- 清理 `withBuiltinTalkTargets` 留下的测试；前端 policy 默认 supervisor 测试保留。

## 9. 风险与边界

- **同名 object 与 class**（object `supervisor` : class `supervisor`）：不同子树
  （objects/ vs classes/）+ ObjectRegistry 中 class 与 object-instance 的 type 注册需明确
  区分键空间。**约定**：实例化 object 的 id 默认 = class id；object 的 `ooc.class` 指向同名 class，
  解析按「先 objects/ 子树定位实例、其 class 字段再去 classes/ 子树（或框架）定位类」两步走，
  不在同一 Map 里用同一 key 同时存实例与类。
- **既有 world 迁移**：下次 boot 幂等建出 supervisor object（自动）；旧 session 里
  objectId="supervisor" 解析从 builtin 路径切到新实例 object——行为等价或更好（实例 self.md
  现在能加载）。无破坏性数据迁移。
- **prototype 无兼容**：若 world 里有 stone 靠 self.md `prototype:` 继承，剔除后将失效。
  当前仓库与 `.ooc-world*` 均未使用 self.md prototype 继承（仅机制存在、无实例），风险低；
  P1 实施时 grep 确认无真实使用再删。
- **class 循环继承**：单链 + 现有 `resolveMethod` 的 `seen` 环检测兜底
  （`object.doc.ts:1621`）。

## 10. 测试策略

- **单元**（bun:test）：class 解析两路优先级、object own-or-inherit、bootstrap 实例化幂等、
  seedSession 拒绝 class、listStones 仅 objects、prototype 符号清除。
- **e2e backend**（`app.handle` 直调）：全新 world bootstrap → supervisor object 自动存在 →
  seedSession(supervisor) → thinkloop 加载 self.md 身份。
- **gate**：`bun run check:tsc` + `bun run check:deprecated-symbols`（加 prototype）+
  `bun run check:silent-swallow`。
