# OOC Class —— 一等继承抽象设计（Spec A：继承统一重构）

> 状态：设计稿 v2（2026-06-07，Supervisor 自主推进；已纳入对抗式评审 C1-C3/H1-H3/M1-M3）。
> 本文是 **Spec A**——纯重构，把 class 提升为一等继承抽象、统一继承载体、修 builtin 源解析。
> 配套 **Spec B**（`docs/2026-06-07-ooc-class-instantiation-welcome-design.md`）依赖本 spec，
> 负责 builtin class 自动实例化 + welcome 闭环。断言锚定 `file:行号`；分歧时信任源代码。

## 0. 评审驱动的关键修订（相对 v1）

| 评审 | v1 缺陷 | v2 修订 |
|---|---|---|
| C1 | object id=class id → ObjectRegistry 单 Map 撞键 + `resolveParentClassChain` 自引用 break（`object-registry.ts:75,137`） | class 注册到**命名空间键** `class:<id>`，与 instance type id 分离 |
| C2 | 声称 knowledge/visible/readable「活继承」，但 knowledge loader 拼 `objects/<parent>/`、visible/readable 无沿链回退 | 收敛为**一个 class 链文件解析原语**；逐维度标注现成（method）/改造（knowledge）/新建（visible·readable·executable 文件回退） |
| C3 | 把实例化挂在 `BUILTIN_OBJECT_IDS` pool 循环（`index.ts:282`，不读 flag） | 实例化是新的「遍历 class registry by flag」循环——移到 **Spec B** |
| H1 | singleton（id=class id）收窄通用性，无法多实例 | instance id 独立于 class；多实例天然支持；singleton 仅 Spec B 的 bootstrap 便利 |
| H2 | 「无真实使用」是 grep 假设 | 已查：全仓 `.md` 零 self.md `prototype:` 使用；唯一真实点 `cli/init.ts:218` `ooc.prototype`→改 `ooc.class`；补漏 `synthesizer.ts:171` 内联回退 |
| H3 | classes/ 扫进单 map 撞键 | StoneDefinition 加 `kind:"class"\|"object"` 判别 + class 进独立解析路径 |
| M1 | self.md 快照 vs 方法活继承漂移无缓解 | 标注为已知 trade-off + 触发条件（§6） |
| M2 | seedSession 判 class 的数据源未定义 | 经 registry `kind` 判别（§5.3） |
| M3 | 重构与产品行为捆绑 | 拆 Spec A（本文，重构）/ Spec B（实例化体验） |

## 1. 动机

OOC 有**两条未统一的继承载体**（`packages/@ooc/meta/object.doc.ts:1629`）：`prototype`
（self.md frontmatter，stone 侧实例链）vs `parentClass`（registry 侧类链，method 解析，
`object.doc.ts:1596`）。两套并存、语义模糊，且 `prototype` 几乎无真实使用（§H2）。

同时 builtin 五件套从磁盘读永远落空：`readSelf → stoneDir(builtinRef)` 指向
`<world>/packages/@ooc/builtins/<id>`（`common.ts:86`），任何 world 该目录为空——builtin
靠 ObjectType module import（`world-runtime.ts:78`）才能跑，但 self.md 身份读不到。

**Spec A 目标**：把 `class` 提升为一等继承抽象，作为**唯一**继承机制（剔除 prototype），
统一到 registry 命名空间 + 一个 class 链文件解析原语，并修 builtin 源解析。**不改 welcome
行为**（c44a0042 的 `withBuiltinTalkTargets` 作为过渡保留，Spec B 再移除）。

## 2. 核心模型

### 2.1 class vs object
- **object**：可交互 Agent，持五件套（self.md / readable / executable / visible / knowledge），
  可 talk、跑 thinkloop。
- **class**：**不可交互**类定义，组成同五件套，仅供 object 继承（不能 talk、不跑 thinkloop）。
- **单继承**：object 至多一个 class；class 可继承另一 class（单链）。无多继承。
- `class` 是**唯一**继承机制，`prototype`/原型链全删（代码+文档+注释，无兼容）。

### 2.2 命名空间分离（解 C1/H1/H3）
ObjectRegistry 的 `store: Map<ObjectType, ObjectDefinition>`（`object-registry.ts:75`）中：
- **instance object** 仍按 objectId 注册（type id = objectId，如 `"supervisor"`）。
- **class** 注册到**前缀命名空间** `class:<id>`（如 `"class:supervisor"`）。
- object 的 `parentClass` 指向 `class:<className>`（如 instance `supervisor` →
  `parentClass="class:supervisor"`）——key 不同，`resolveParentClassChain` 的 `seen`
  不再自引用 break；class 链在 `class:` 命名空间内向上走（class 继承 class）最终回退 `root`。
- **多实例**天然支持：object `a`、`b` 都 `parentClass="class:supervisor"`，各自独立 type id。

> instance id 与 class「概念名」可同为 `supervisor`（用户心智模型不变），靠 `class:` 前缀
> 在 registry 层消歧。

### 2.3 持久化布局（解 H3）
```
stones/<branch>/
├── objects/<id>/     # 可交互 Agent（五件套；own-or-inherit）
└── classes/<id>/     # 不可交互类定义（五件套；仅被继承）          ← 新增
```
- `StoneDefinition` 加 `kind: "class" | "object"` 判别（现有 `oocMetadata.kind` 已有
  `builtin`/`object`/`stone`，新增 `class`，`stone-registry.ts:23`）。
- registry rescan 扫 `objects/`（现有 `STONE_OBJECTS_SUBDIR`）+ 新增扫 `classes/`，class 条目
  以 `kind:"class"` 入同一 map 但注册时映射到 `class:<id>` 命名空间键（§2.2）。
- 走同一 git worktree 版本化（main = canonical）。

### 2.4 两路 class 解析
class `X` 定义按优先级：① world `stones/<branch>/classes/X/` → ② 框架 builtin class
（从 `@ooc/builtins/X` 包解析，**不 vendor 进 world**）。world 覆盖框架，与 stone 现有
多根解析对称（`stone-registry.ts:164-188`）。builtin class 五件套从框架包读——即 §1 磁盘 bug 的修复。

## 3. class 链文件解析原语（解 C2）

新增**单一** persistable 原语，所有五件套读取与 executable 加载共用：

```
resolveObjectFileDir(ref, fileRelPath) -> 持有该文件的目录:
  1. object 自身 stoneDir(ref) 下有该文件 → 用 own
  2. 否则沿 class 链（ref.class → 父 class → ...）逐个 class 目录（world classes/ 或框架包）找
  3. 找不到 → undefined（caller 处理缺失）
```

各维度据此明确「现成/改造/新建」：

| 维度 | 继承机制 | 现状 |
|---|---|---|
| executable（方法） | registry `resolveMethod` 沿 `parentClass` 链（`registry.ts:503`） | **现成**（需改为 `class:` 命名空间）|
| executable（源码加载） | ObjectTypeRegistrar `loadObjectWindow` 读 stone executable | **改造**：instance 无 own executable 时经原语回退到 class 目录 |
| knowledge | loader 沿 `resolveParentClassChain` 拼 knowledge 目录（`loader.ts:69`） | **改造**：parentClass 现为 `class:<id>`，knowledge 目录解析映射到 `classes/<id>/knowledge` 或框架包 |
| visible / readable | 无 | **新建**：synthesizer 渲染 self window 时经原语沿 class 链回退 visible/readable（补 `synthesizer.ts:66,171` 两处）|
| self.md | 见 §6（Spec B 实例化时拷贝 own；Spec A 阶段 builtin object 暂经原语读框架 self.md）| 见 §6 |

> Spec A 落地全部五维度的 class 链回退（这是「继承真能工作」的前提）。视觉/可读维度的
> 新建回退是本 spec 显式工作项，不是假设的现成能力。

## 4. class 载体声明
- object `package.json` 的 `ooc.class = "<classId>"` 声明所属 class（与 `ooc.objectId`/
  `ooc.kind`/`ooc.type` 并列，`stone-registry.ts:23`）。**替代**被删的 self.md `prototype`
  frontmatter 与 `ooc.prototype`。
- class 自身 `package.json`：`ooc.kind="class"`，可带 `ooc.class` 指向父 class（单链）。
- 运行时 flow object 读 `ooc.class` → 写 `.flow.json:class`（现成机制
  `flow-object.ts:82-94`；映射到 `class:<id>` 注册键校验，未注册抛 `ClassNotFoundError`）。

## 5. prototype 剔除（解 H2）

### 5.1 实证清查结果
- 全仓 `.md`（含 `.ooc-world*`）**零** self.md `prototype:` frontmatter 使用 → self.md
  prototype 解析路径可直接删，无实例受影响。
- 唯一真实使用：`packages/@ooc/cli/src/commands/init.ts:218` 脚手架示例
  `ooc:{... prototype:"supervisor"}` → 改为 `ooc.class:"supervisor"`。

### 5.2 触点（删代码/注释，无兼容层）
- `executable/object/object-types.ts`（`StoneObjectDeclaration.prototype` @deprecated alias 删）
- `runtime/object-type-registrar.ts:140-162`（`resolveParentClass` 三级链中 prototype 两级删，
  改为读 `ooc.class`）
- `runtime/stone-registry.ts:27`（`oocMetadata.prototype` 字段删）
- `runtime/object-registry.ts` / `_shared/types/registry.ts`（prototype 残留）
- `thinkable/knowledge/synthesizer.ts`：`readSelfPrototype` 删 + **`derivePeerObjectWindows`
  内联 prototype 回退删（`:171`，H2 补漏）**
- `meta/object.doc.ts`（文档表述 + parent_class_inheritance 节点的「prototype 未统一」旧注）
- `cli/src/commands/init.ts:218`（`ooc.prototype`→`ooc.class`）
- `scripts/check-no-deprecated-symbols.sh` 加 `prototype`（限定相关上下文）守门防回流

### 5.3 class 非交互判别（解 M2）
seedSession（`flows/service.ts:388`）拿到 target id 后，经 registry 判 `kind`：命中
`kind:"class"`（或注册键带 `class:` 前缀）→ 抛 `INVALID_INPUT`（class 不可 talk）。
`user` 仍作 caller 单独保留拒绝。

## 6. self.md 与升级传播（解 M1）
- Spec A 阶段不引入实例化；builtin object 的 self.md 暂经 §3 原语从框架包读（修磁盘 bug）。
- **升级传播语义**（Spec B 实例化后生效）：self.md 实例化时拷贝快照（own 身份，不回灌）；
  其余四维活继承（框架升级自动生效，除非 own 覆盖）。即「own 身份、共享行为」。
- **已知 trade-off（M1）**：框架升级 class 的 method 语义后，实例旧 self.md 快照可能描述旧
  行为契约 → 身份-行为漂移。触发条件：框架改 method 签名/语义且实例未同步 self.md。Spec A
  暂记录此 trade-off；缓解（自我认知与行为契约分离 / 过期检测）留待 Spec B 或后续。

## 7. 分期与验证（Spec A 内部）

### P0：builtin 源解析改指框架包 + class 链文件原语骨架
- 实现 §3 `resolveObjectFileDir`，先服务 builtin 五件套：从框架包（`require.resolve
  ("@ooc/builtins/<id>")` 或等价）解析，替代空的 `<world>/packages/...`。
- **验证**：单测——`readSelf({objectId:"supervisor"})` 读到框架 self.md（非空）；
  builtin **class** 路径与 builtin object 路径分别覆盖（C3：两条独立验证）。

### P1a：class 一等化 + 命名空间
- `classes/` 持久层（stoneDir/resolveStoneDir 支持 classes/ 子树）+ StoneDefinition `kind`。
- ObjectRegistry class 注册到 `class:<id>` 命名空间；`resolveMethod`/`resolveParentClassChain`
  跨命名空间起步（instance type → `class:<className>` → 链）。
- object `ooc.class` 载体；registrar 读 `ooc.class` 注册 parentClass。
- **验证**：单测——object `ooc.class=X` 方法沿 `class:X` 链解析；instance 与同名 class
  不撞键、不自引用（直接覆盖 C1 回归）。

### P1b：五维 class 链回退 + 剔除 prototype
- knowledge loader 改走 `class:<id>` → classes/ 或框架包 knowledge 目录。
- visible/readable/executable 文件加载经原语沿 class 链回退（新建，补 synthesizer 两处）。
- 剔除 prototype（§5.2 全触点）+ check-no-deprecated-symbols 守门。
- **验证**：单测——instance 无 own knowledge/visible/readable/executable 时继承 class 的；
  prototype 符号全消失；tsc 干净。

### P2：收口
- `meta/object.doc.ts` 更新（class 一等节点 + 删 prototype），`bun tsc --noEmit` 验证 doc。
- gate：`bun run check:tsc` + `check:deprecated-symbols`（加 prototype）+ `check:silent-swallow`。

## 8. 风险与边界
- **registry 命名空间迁移**：现有 `getDef`/`lookupMethod` 调用方需审计是否区分 instance/class
  键（P1a 列为审计项）。
- **knowledge 路径改造**：loader 当前对 parentClass 一律拼 `objects/`；改为按 `class:` 前缀
  分流到 classes/ 或框架包，需保证非 class 父类（若有）仍走旧路径——但单继承下 object 的
  parent 恒为 class，简化此分流。
- **既有 world**：Spec A 不动 welcome/不实例化，行为不变；仅 builtin self.md 现在能读到。
- **环检测**：单链 + `resolveParentClassChain` 的 `seen`/`MAX_DEPTH=64` 兜底
  （`object-registry.ts:137`）。

## 9. 测试策略
- **单元**（bun:test）：class 链文件原语两路优先级、命名空间无撞键（C1 回归）、五维继承、
  builtin self 框架包解析、prototype 符号清除。
- **gate**：tsc + deprecated-symbols(+prototype) + silent-swallow。
- e2e（含真正加载 self.md 身份）放 Spec B（依赖实例化）。

---

## 实现纪要（as-built，2026-06-07）

实现时相对本设计稿有若干务实调整，**以代码为准**：

- **class 寻址用既有 `_builtin/<id>` 前缀**，而非新引入 `class:<id>`。复用 `_builtin/` 已有的
  builtin 分类语义；磁盘读（`readSelf`/`readReadable`/`stoneKnowledgeDir`）对 `_builtin/` 走框架包
  （`resolveBuiltinReadDir`/`resolveBuiltinDir`），registry 把 `_builtin/<id>` 注册为空 methods 隐式
  继承 root（`ensureBuiltinClassRegistered`）。ObjectRegistry 的 store 原生支持任意字符串键，无需改数据结构（C1 解法）。
- **instance/class 磁盘解析分离**：`stoneDir` 移除 bare builtin id 特殊解析（bare → `objects/`）；
  `resolveBuiltinReadDir` 收窄为 `_builtin/` 前缀专用——避免 class 遮蔽同名 instance 磁盘。
- **knowledge 继承**：`stoneKnowledgeDir` 对 `_builtin/<id>` 走框架包 knowledge/；loader Step 1b
  （parentClass 链 seed）**移除 inheritable 门控**——class 存在即为被继承，其 seed knowledge 无条件
  流向 instance（区别于 B-tree 域祖先继承的 opt-in）。
- **prototype 彻底剔除**，`ooc.class`（package.json）成唯一继承声明。

**已落地（每步绿，commit c44a0042→2efa7bb8）**：P0 builtin 源解析、prototype 剔除、class 实例化
（Spec B）、ensureBuiltinClassRegistered、seedSession 拒绝 class、P2 meta doc、knowledge 链继承。
实证：全新 world → supervisor 自动实例化为真 object → welcome 默认无门槛 → 对话加载完整身份+全部
seed knowledge+root 命令。

**剩余（generality，无当前 consumer，未阻塞 supervisor 目标）**：world 级用户自定义 `classes/`
子树扫描/注册；visible/readable 沿 class 链回退。
