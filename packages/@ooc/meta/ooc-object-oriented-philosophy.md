# OOC 设计哲学：以面向对象为根

> 文档位置：`packages/@ooc/meta/ooc-object-oriented-philosophy.md`
> 关联：`object.doc.ts`（概念权威）、`2026-05-28-ooc-object-unification-plan.md`（ooc-6 归一化工程计划）、`2026-06-01-runtime-object-flat-persistence-plan.md`（运行时对象平铺持久化修订）

---

## 0. 一句话主张

**OOC = Object Oriented Context。它把「上下文工程」这件事，从 prompt 串接的手艺活，还原成一套面向对象的抽象体系：上下文里的每一段信息都是一个 Object，Agent 本身也是一个 Object，Object 之间按 OO 的经典法则（身份、封装、继承、多态、消息传递）协作。**

如果说传统 Agent 框架是在写一份不断变长的 prompt，OOC 是在写一个不断演化的对象图。

---

## 1. 为什么是面向对象？——从 Agent 工程的基本矛盾出发

当前 Agent 工程存在三重矛盾：

1. **上下文的"无限增长"与 LLM 的"有限窗口"**：传统 prompt 工程通过字符串拼接和截断处理上下文，本质是把信息当成无结构的 text blob。增长必然带来熵增，压缩必然带来信息损失——因为系统不知道"这段文字是什么"。
2. **工具调用的"扁平列表"与问题的"层次结构"**：function calling 暴露的是一串扁平函数名，LLM 需要从几十个同名函数中推理出正确调用。问题本身是分层的（用户 → 任务 → 子任务 → 资源），接口却是扁平的。
3. **Agent 的"一次性"与"自我演化"的需求**：当前绝大多数 Agent 是 prompt + tools 的静态快照；要让 Agent 积累经验、自我改进，需要它能像程序员改造代码一样改造"自己"。

面向对象天然是这三重矛盾的解药：

| 矛盾 | OO 的解药 |
|------|-----------|
| 上下文无结构 → 熵增 | 用 **Object** 给上下文做类型化。file、knowledge、todo、plan、do、talk 都是不同类，类知道自己如何压缩、如何展示、何时过期。 |
| 工具扁平列表 → 推理负担 | 用 **Method** 把工具绑定到 Object。"压缩一个 file"不是从 50 个 tool 里找 `compress_file`，而是在 file 对象上调 `compress()`。 |
| Agent 是静态快照 | 用 **元编程**：Agent 能修改自己的 `self.md`（身份）、`executable/`（方法）、`visible/`（界面）、`knowledge/`（知识库）。Object 可以在运行时改写自己的类定义。 |

OOC 并不是"给 Agent 套一层 OO 术语"，而是把 OO 作为第一性原理：**系统里存在的任何东西，要么是一个 Object，要么是 Object 之间的一条关系。**

---

## 2. OOC 对象模型的核心概念

### 2.1 Object = 身份 + 五件套

每个 OOC Object 都有：

- **身份**：一个稳定的 `objectId`（如 `supervisor`、`agent_of_think`、`file_w_123`）。身份跨 session、跨 thread 不变。
- **五件套**（见 `object.doc.ts` §stone 五件套，ooc-6 归一化后命名）：

  | 组件 | 语义 | 对应 OO 概念 |
  |------|------|-------------|
  | `self.md` | 我是谁（身份、职责、协作方式） | 类的 javadoc / comment + 类型声明 |
  | `readable.(md\|ts)` | 我如何在 LLM 的上下文中展示自己 | `toString()` / `inspect()` 的升级版——对象自定义如何序列化给"观察者（LLM）"看 |
  | `executable/` | 我能做什么（方法集合） | 类的方法表（vtable） |
  | `visible/` | 我如何在人类的 UI 中展示自己 | 类的 View / React 组件 |
  | `knowledge/` | 我知道什么（渐进激活的文档） | 类的静态知识字段（类级别的知识图谱） |

这五件套不是随意的设计，而是严格对应 OO 系统的四个经典面向：**声明（self）、序列化（readable）、行为（executable）、呈现（visible）、知识（knowledge）**。传统 OO 只显式建模了行为（方法）和声明（类定义）；序列化（`toString`）和呈现（UI）通常是系统外的、ad-hoc 的；知识更是完全缺失。OOC 把它们全部提升为一等公民。

### 2.2 Context = Object 的视角

> 对应 `2026-06-01-runtime-object-flat-persistence-plan.md` §1.2 的关键纠偏。

OOC 的第一个重要洞见：**Context 不是一个归属（belongs-to），而是一个视角（point-of-view）。**

- 同一个 Object（如 `talk_w_abc`，一场跨 Agent 的对话）可以同时出现在 `supervisor` 和 `agent_of_x` 两个 thread 的 context 中。
- 每个 thread 对这个 Object 有自己的视角参数（`compressLevel`、`order`、`decayMeta`），但 Object 本身的状态只存一份。
- 工程落地：`flows/<sid>/<oid>/` 平铺存放所有运行时对象，每个 thread 有自己的 `threads/<tid>/context.json` 记录"我当前持有哪些 object 以及视角参数"。

这对应 OO 世界中的**引用语义**：对象有独立的 identity 和存储，context 只是对对象的一组引用。`context.json` 就是 OOC 的"指针表"。

反过来理解，**LLM 在每一轮思考看到的输入，其实是它当前 thread 的对象引用表 + 每个被引用对象的 `readable()` 输出的拼接**。上下文工程 = 管理对象引用表。

### 2.3 Method = 绑定在 Object 上的可调用能力

ooc-6 归一化之前，系统有 Command 和 Window 两套概念（Command 是动作，Window 是上下文单元），导致出现"window 上挂 command"这种奇怪的组合。归一化之后：

- 所有可调用能力统一叫 **Method**，绑定在 Object 上。
- Method 有两个可见性标记（不是传统 OO 的 public/private，而是更贴合 Agent 场景的两轴）：
  - `public`：该方法是否对**其他 Object** 的 context 可见（默认 `false`——一个 Object 默认只能调自己的私有方法；需要对外暴露协作接口时显式标 `public`）。
  - `for_ui_access`：该方法是否允许被**人类用户**通过前端 HTTP API 调用（默认 `false`——Agent 的内部方法不允许人类绕过 Agent 直接触发）。

这是 OO "封装"原则在双消费方（Agent / Human）下的特化。传统 OO 只有一个"外部世界"；OOC 有两个外部世界：**其他 Agent** 和 **人类用户**，两者的权限模型不同。

### 2.4 parentClass Chain = 统一的代码复用机制（2026-06 P6.§7 修订）

OOC 采用**类继承链（parentClass）**而非原型链作为统一的代码复用机制。链的每一环是 ObjectType（类定义），作用于 Stone/Builtin 层的全部五件套：

- 每个 ObjectDefinition（注册在 `registry.ts`）持有 `parentClass?: string | null` 字段。
  - `undefined`（缺省）→ 隐式继承 `"root"`，所有对象自动获得 root 的通用方法（talk / do / plan / program / ...）。
  - `null`（显式不继承）→ 链终止，用于 `root` 自身和 `method_exec` 等 form lifecycle 内部 type。
  - `string`（具名父类）→ 沿注册的 class 继续向上回退。
- **四类能力统一走同一条继承链**（closest parent first，命中即停）：
  1. **methods**（`executable/`）— 热路径 dispatch 走同步 registry lookup。
  2. **readable**（`readable.ts` / `readable.md` / readme fallback）— 自身缺则沿链找祖先。
  3. **knowledge**（`knowledge/` 目录中 `inheritable: true` 的条目）— 类级 seed knowledge 沿链下传。
  4. **visible**（`visible/index.tsx`）— 前端 ContextSnapshotViewer 用后端 enrichment 的 `effectiveVisibleType` 选择渲染组件，沿链找首个可渲染的祖先 type。
- stone `self.md` frontmatter 的 `prototype:` 字段已降级为 `parentClass` 的配置别名。动态注册时优先级：`executable/index.ts` 的 `window.parentClass` > `window.prototype`（@deprecated）> `self.md frontmatter.prototype`。
- 环检测 + 链长上限（64）防御误配置。

从"原型链"迁移到"父类链"的理由：

1. **与 Stone/Pool/Flow 三层模型对齐**：Stone = 类定义，Flow = 实例。父类链是 class 级的静态概念（"my_custom_plan IS A plan"），与三层模型的语义严格匹配；原型链容易混淆"实例链"与"类链"。
2. **同步热路径**：方法 dispatch 是每轮 LLM think 的 hot path，同步 registry walk（内存 Map）比异步读 self.md frontmatter 性能与可预测性都更好。
3. **统一覆盖四类能力**：继承不该只复用方法——readable/knowledge/visible 同样是类级 contract，子类可以只覆写部分维度而沿链复用其余。
4. **三态语义（undefined / null / string）**：让"隐式继承 root"成为默认（降低 boilerplate），同时保留"完全不继承"的显式出口。

这对应 OO 的**继承与多态**——一个类可以 is-a 另一个类并沿多个维度复用其 contract。

### 2.5 Object Relations = 协作的三种权力语义

`object.doc.ts` §patches.object_relations 定义了 OOC 对象图的三条边：

| 关系 | 语义 | 例子 |
|------|------|------|
| **super**（自我-上级） | 我是谁的一部分。上级决定我的身份边界。 | `agent_of_x` → `supervisor` |
| **talk**（peer 平等） | 我们在同一层级协作。平等对话。 | `agent_of_think` ↔ `agent_of_experience` |
| **parent-child**（层级派生） | 我派生出你。父对象拥有子对象的生命周期。 | `do_w_abc` 派生的 `method_exec` form |

这三种关系不是装饰，而是决定了：

- context 自动注入哪些 peer / children（Phase 6）。
- method 调用的权限边界（super 可以调 child 的 `public` 方法，反之受限）。
- 持久化时的 reference counting（child 被 close 时，只有 parent 不再引用才真删）。

---

## 3. 与传统面向对象的关键差异

OOC 虽然以 OO 为根，但它服务的是 **LLM Agent** 而非传统进程，因此有四处本质不同：

### 3.1 Observer 是 LLM，不是 CPU

传统 OO 中，对象的"观察者"是程序员（读代码）和运行时（调方法）。OOC 中，对象的第一观察者是 **LLM**：

- `readable.ts` 控制对象如何把自己序列化为 LLM 可理解的 XML——这相当于对象自定义了"给 AI 看的 toString()"。
- `readable.md` 是静态版本，`readable.ts` 是动态版本（可根据当前 thread 状态决定展示多少信息）。
- compressLevel 是 OOC 的"清晰度档位"：一个 file object 在 `compressLevel=0` 展示全部内容，在 `compressLevel=3` 只展示路径和摘要。

**这意味着 OOC Object 的"接口"不仅是方法签名（给执行器看的），还包括 readable 输出（给推理器看的）。** 两者同样重要。

### 3.2 两个"外部世界"：其他 Agent 和人类用户

传统 OO 的"外部"是一个统一的概念（其他对象）。OOC 有两个外部：

| 外部 | 消费接口 | 权限控制 |
|------|---------|---------|
| 其他 Agent（Agent 面） | `readable`（LLM 可见）+ `public` methods（可调用） | `public: true` |
| 人类用户（人类面） | `visible`（React 组件可见）+ `for_ui_access` methods（HTTP API 可调用） | `for_ui_access: true` |

这就是 `agent-native parity` 公理的设计来源：任何能力都必须回答"人类怎么用"和"Agent 怎么用"两个问题。

### 3.3 Object 可以在运行时改写自己的类

传统 OO 中，类定义是编译时确定的（或至少是加载时确定的）。OOC 中，一个 Agent Object 可以：

- 通过 `reflectable` 修改 `knowledge/`（增加自己的知识）。
- 通过 `programmable` 修改 `executable/index.ts`（增加/修改自己的方法）。
- 通过 `visible` 修改 `visible/index.tsx`（修改自己的 UI）。
- 通过修改 `self.md` 重定义自己是谁。

这不是 hack——这是 OOC 的核心设计目标：**Agent 自我迭代**。stone 层的五件套就是 Agent 的"源代码"，Agent 本身就是自己的维护者。

### 3.4 对象图是动态涌现的，不是静态编译的

传统 OO 系统的对象图在设计时确定（或至少有清晰的工厂模式）。OOC 中：

- Runtime Object 由 thread 在运行时按需创建（`do_window` 派生 `method_exec`、`open_file` 创建 `file` object）。
- Object 的生命周期由 reference counting 管理（多个 thread 可以共享同一个 talk object）。
- Peer / Children 通过自动注入出现在 context 中（Phase 6）。

这更像一个操作系统的进程树 + 共享内存模型，而不是一个类图。

---

## 4. 三层持久化：Stone / Pool / Flow 的 OO 解释（+ 第四类：Builtin）

Stone / Pool / Flow 不是随意的三层划分，它们严格对应对象的三种时态。2026-06 之后又
增加了 **Builtin** 作为"系统自带的 Stone"。

| 层 | 语义 | OO 类比 | 数据 | 位置 |
|----|------|--------|------|------|
| **Builtin**（根） | 运行时自带的 Object 定义，随代码版本发布，不可被 Agent 改写 | JDK / 标准库类 | self.md / readable / executable / visible / seed knowledge | `packages/@ooc/builtins/<id>/`（源码仓内） |
| **Stone**（静） | 用户 / Agent 创建的 Object "类定义 + 静态初始化数据" | 用户态源代码 + 编译产物 | self.md / readable / executable / visible / seed knowledge | `packages/<id>/`（world 内，进 git） |
| **Pool**（积） | Object 的"跨实例静态字段" | 类级别的 static 字段（跨所有实例共享） | data.csv / sediment knowledge / files | `pools/<id>/`（world 内，不进 git） |
| **Flow**（动） | Object 的"运行时实例状态" | 对象实例的 heap 数据 | state.json / threads/<tid>/ / context.json | `flows/<sid>/<oid>/`（world 内，不进 git） |

### 4.1 Builtin 与 Stone 的关系

Builtin 和 Stone 在结构上同构（都有 self.md / readable / executable / visible / knowledge），
区别在于：

- **所有权**：Builtin 归 OOC 运行时维护，随 `@ooc/builtins` 包版本演进；Stone 归 user / Agent 维护，通过 `metaprog` 版本化。
- **可写性**：Agent 不能通过 `metaprog` 修改 Builtin（尝试写 Builtin stone 会被拒绝）；Stone 走正常 stone-versioning 流程。
- **发现方式**：Builtin 通过 `packageDir` 的 `_builtin/<id>` 前缀路由（以及 `supervisor`、`user` 这两个历史保留 id 的硬编码映射）直接定位到 `packages/@ooc/builtins/`；Stone 位于 `packages/<id>/`。
- **Pool / Flow**：Builtin Object 和 Stone Object 一样有自己的 Pool（跨 session 沉淀）和 Flow（运行时实例）。即"定义是 builtin，状态是 world"。

### 4.2 为什么要引入 Builtin

把 `supervisor` 和 `user` 从"首次启动写入 world 的 bootstrap invariant"升格为 Builtin，解决了两个问题：

1. **世界纯净**：空 OOC world 启动时不需要写任何 stone 文件——supervisor 和 user 的定义随代码发布，world 只存运行时数据（pool + flow）。bootstrap 不再执行文件拷贝式的"伪创建"。
2. **版本一致**：supervisor 的 self.md、seed knowledge、user 的 inline UI 协议随代码 release 演进，不会因为老 world 在 2026-05 初始化过一份旧 supervisor 定义而和新 runtime 产生 drift。

这也把 OO 的"类定义"进一步分层：runtime 自带类（Builtin）= JDK，用户创建类（Stone）= 用户代码。

**这是把 OO 的"类 / 静态字段 / 实例"映射到了持久层，并在"类"里再分出"标准库类"与"用户类"。** 一个 Object 完整存在 = 它在 builtin 或 stone 中有定义 + 在 pool 中有累积 + 在 flow 中有当次运行的实例。

这也解释了为什么 ooc-6 要把 runtime object 从嵌套 `context/` 目录改成平铺 `flows/<sid>/<oid>/`：**实例就是实例，它不该嵌在另一个实例的 context 里**——否则相当于 Java 里把一个对象的 heap 分配在另一个对象的字段空间中，这破坏了引用语义。

---

## 5. 设计中的问题与优化方向

### 5.1 readable / visible 的耦合度尚需验证

**现状**：`readable.ts`（LLM 展示）和 `visible/index.tsx`（人类 UI 展示）是两个独立文件，但它们往往展示的是同一个对象状态的两种视图。

**潜在问题**：
- 同一个对象的"展示逻辑"会被实现两次，容易漂移（例如 file 的 viewport 在 readable 中用 `<line_range>` 表达，在 visible 中用 React 组件表达）。
- 未来 Object 修改自己的 visible 时，readable 是否需要同步改？可编程性会变得复杂。

**优化方向**：
- 探索"一个表示层，两个后端"的抽象：对象的展示状态先产出一个中间 AST，readable 把 AST 渲染成 XML，visible 把 AST 渲染成 React。
- 短期可以不加抽象，但应建立 convention：readable 和 visible 使用同一份 type-specific 状态类型，单元测试中对齐展示内容。

### 5.2 parentClass Chain vs. Composition 的取舍

**现状**：ooc-6 P6.§7 选择了统一的 parentClass 单继承链，覆盖 methods / readable / knowledge / visible 四类能力。

**潜在问题**：
- 单继承，但 Agent 能力的组合往往是多源的（一个 Object 可能同时需要 file 的读写能力 + plan 的任务拆解能力）。
- parentClass 链过长后，debug 会很困难（"这个方法/可读内容到底从哪来的？"）。

**优化方向**：
- 引入 Mixin / Trait 机制：Object 可以声明多个 `mixins: ["file_ops", "task_tree"]`，注册时将 mixin 的四类能力（methods/readable/knowledge/visible）全部合并到自身。Mixin 不参与 identity，只提供能力。
- 保留 parentClass 用于 identity 继承（is-a），mixin 用于能力组合（has-a）。
- 在 observable 维度加入"能力来源追踪"：LLM 调一个 method 或读一段 readable 时，context 中能看到它是从哪个 mixin / parentClass 来的。

### 5.3 Reference Counting 的正确性和性能

**现状**：Phase 5' 计划每次 `removeWindow` 扫描 `flows/<sid>/*/threads/*/context.json` 做 reference counting。

**潜在问题**：
- **正确性**：扫描 + 删除之间存在 TOCTOU 窗口——T1 close A 时扫描发现只有 T2 引用，于是不删；但 T2 可能在同一时刻也在 close A，两个都不删（leak）或两个都删（double-free 风险）。
- **性能**：session 有 100 个 thread、每个 thread 有 50 个 object 时，一次 close 需要读 100 个文件。

**优化方向**：
- **正确性**：引入单写者原则——reference counting 的写操作由一个中心化的 `FlowObjectLifecycleManager` 串行处理，所有 close 请求走同一个 async queue。
- **性能**：维护一个 in-memory 的 `Map<objectId, Set<threadId>>` 反向引用表，write-through 到一个 session 级的 `_refs.json` 文件。close 时查内存表，不读盘。
- **兜底**：定期运行一个 GC pass（session 关闭时或定时），扫描孤儿 object 并清理，容忍极端 corner case。

### 5.4 Context Registry 的一致性窗口

**现状**：`context.json`、`thread.json`、`state.json` 三者在写操作时分步写入。

**潜在问题**：
- 崩溃可能导致三者不一致（state.json 写了但 context.json 没写 → object 泄漏；反之 → dangling reference）。
- 目前的写顺序是 state → thread → context，但缺少 crash recovery 逻辑。

**优化方向**：
- 采用 write-ahead log（WAL）模式：所有变更先 append 到 `threads/<tid>/oplog.jsonl`，再异步 apply 到三个文件。崩溃恢复时重放 oplog。
- 或者更简单：`context.json` 作为唯一真相源，`thread.json` 中不再重复 `contextWindows[]`（已在 P5'.4 计划删除），`state.json` 的存在性由 context.json 的引用 + GC 兜底。

### 5.5 Method 可见性的两轴是否足够

**现状**：`public`（对其他 Agent）和 `for_ui_access`（对人类 HTTP）两个布尔字段。

**潜在问题**：
- 缺少"对 super 可见但对 peer 不可见"这种细粒度控制（父对象派发给子对象的内部方法，peer 不该能调）。
- 缺少"对特定 objectId 可见"的 ACL（A 能调 B 的 `foo()` 但 C 不能）。
- 未来 cross-world collaboration（跨项目的 Agent 协作）需要更细的权限模型。

**优化方向**：
- 把可见性从两个布尔值升级为一个结构化字段：

```typescript
visibility: {
  peers: boolean;           // 同层 peer 可调
  super: boolean;           // 上级可调
  children: boolean;        // 下级可调
  ui: boolean;              // 人类 HTTP 可调
  whitelist?: string[];     // 显式 objectId 白名单
}
```

- 短期先用两布尔跑通主场景，等真实需求出现（预计在 Phase 6 peer/children auto-entry 之后）再升级。

### 5.6 Readable 的"展示多少"是一个开放问题

**现状**：`readable.ts` 由 Object 作者手写，决定给 LLM 看多少信息。`compressLevel` 是一个粗粒度的 0-3 档位。

**潜在问题**：
- compressLevel 的语义由每个 Object 自己解释，没有统一标准——file 的 level 2 和 plan 的 level 2 可能展示比例完全不同。
- LLM 无法精确控制"给我看这个 object 的 X 字段但不要 Y"——它只能通过 `compress()` 工具做粗粒度调整，或重新 exec 一个 method。
- readable 输出的 token 数不可控，可能超出 context window（虽然有全局压缩兜底）。

**优化方向**：
- 为 readable 定义一个标准化的"内容预算协议"：
  - 每个 Object 声明自己在各 compressLevel 的**大致 token 预算**（如 L0=500, L1=200, L2=80, L3=30）。
  - `buildContext` 汇总所有对象的预算，超过窗口时自动按策略降级（LRU + decayMeta + priority）。
- 引入"字段级可读"协议：Object 在 readable 中声明可独立请求的字段（如 `<readable_fields name="file"><field name="path"/><field name="content" tokenBudget="unbounded"/></readable_fields>`），LLM 可以通过 `exec(objectId, "focus", {fields: ["content"]})` 精准请求。

### 5.7 Knowledge 与 Object Identity 的边界

**现状**：`knowledge/` 是 Object 五件套之一，通过 trigger（`object::`/`method::`/`object_id::`）渐进激活。

**潜在问题**：
- Object 的"身份描述"散落在 `self.md`（一句话身份）、`readable.md`（展示介绍）、`knowledge/*.md`（详细知识）三个地方。维护时容易漂移。
- trigger 机制目前是字符串匹配，没有利用 Object 的类型系统——`object::file` 和 `object::knowledge` 的触发逻辑是同一套 if-else。

**优化方向**：
- **身份文档三合一**：`self.md` 作为唯一的身份真相源，包含 short_description（给 readable 用）和 full_description（给 knowledge 用）。readable 和 knowledge 从 self.md 派生，不手写重复内容。
- **Trigger 类型化**：把 trigger 从字符串格式升级为类型化的 matcher，与 ObjectType / MethodName 的注册表联动，注册时验证 trigger 引用的 type 和 method 是否存在。

### 5.8 Agent 元编程的安全边界

**现状**：Agent 可以修改自己的 `executable/`、`visible/`、`knowledge/`，这是设计目标。

**潜在问题**：
- Agent 修改自己的 executable 后可能引入 bug，导致后续 thinkloop 无法运行——自我迭代变成自我破坏。
- Agent 修改自己的 `self.md` 可能造成身份漂移（一个 debug agent 把自己改写成 code execution agent），破坏 Supervisor 的调度假设。
- 恶意 Agent（或被 prompt injection 的 Agent）可能通过元编程扩大权限（把一个内部方法标成 `for_ui_access: true`）。

**优化方向**：
- **元编程沙箱**：Agent 对自身的修改不直接落地到 stone，而是先写入一个 `proposed_changes/` 目录，由一个独立的 validation pass（可以是另一个 AgentOfReview）检查后才 promote。
- **身份不可变性**：`self.md` 中的 `type`、`parent`、`responsibility` 核心字段标记为 frozen，元编程不可修改；只能改 `capabilities`、`notes` 等外围字段。
- **方法权限升级需要人类批准**：任何把 `for_ui_access` 或 `public` 从 `false` 改为 `true` 的变更，自动提一个 PR 等待人类 review。
- **回滚机制**：每次元编程变更都在 stone 层打一个可回滚的快照（git commit 或等价机制），出问题时可一键还原。

### 5.9 Context 作为"引用表"的表达力上限

**现状**：`context.json` 是一个扁平列表 `[{objectId, params}]`。

**潜在问题**：
- 扁平列表无法表达 context 内部的结构关系（"这几个 file object 属于同一个 plan step"）。LLM 只能靠阅读 object 内容推理结构，增加了推理负担。
- 无法表达 context 的"逻辑分组"——例如把一组相关的 todo 折叠成一个 `<task_group>` 节点。
- 多维度排序（按时间、按相关性、按类型）只能选一种 order。

**优化方向**：
- 在 `context.json` 中引入可选的 `groups: [{id, memberIds, compressLevel}]` 字段，允许 context 形成两层结构。
- `buildContext` 渲染时，如果 object 属于一个 group，外层包 `<context_group>` 标签，group 有自己的 readable。
- 这与 Phase 6 的 peer/children 自动注入天然配合：`<context_peers>` 和 `<context_children>` 就是两个内置 group。

---

## 6. 总结：OOC 的设计象限

把上面的讨论浓缩为一个设计象限图：

```
                    静态（设计时）            动态（运行时）
                 ┌──────────────────────┬──────────────────────┐
                 │                      │                      │
  身份与结构     │  Stone（self.md,      │  Flow Object         │
                 │   parentClass chain,  │  （identity + state）│
                 │   mixin）              │                      │
                 ├──────────────────────┼──────────────────────┤
                 │                      │                      │
  行为与展示     │  executable/visible/  │  context.json        │
                 │  readable（类级接口） │  （实例级引用表 +     │
                 │                      │   视角参数）          │
                 │                      │                      │
                 └──────────────────────┴──────────────────────┘
```

四个象限之间的 API 边界就是 OOC 的骨架：

- Stone → Flow Object：parentClass 链 + mixin 决定实例继承哪些方法、readable、knowledge、visible。
- executable → context.json：方法调用改变实例状态，也改变 context 引用表（open/close window）。
- context.json → readable：context 引用表决定哪些 readable 被拼进 LLM 输入。
- readable → LLM → executable：LLM 根据 readable 输出决定下一步调什么方法。

这是一个闭环：**Object 定义自己 → Object 展示自己 → LLM 阅读 Object → LLM 操作 Object → Object 被修改后重新展示自己。**

这个闭环能跑通、能演化，OOC 的设计目标就达成了。
