# OOC Class —— 一等继承抽象（横切变更记录）

> 跨维度变更（2026-06-07）：把 `class` 提升为与 `object` 平级的一等概念，作为**唯一**继承机制
> （彻底剔除 prototype），并以 `instantiate_with_new_world` 让 builtin class 在新 world 自动实例化
> 出可交互 object。横切 persistable / thinkable / executable·collaborable / visible。
> 维护：断言锚定真实代码 `file:行号` 与 commit；分歧时信任源代码。
> 上游：`packages/@ooc/meta/object.doc.ts:1596`（parent_class_inheritance.children.class_object，概念权威）；
> 设计稿 `docs/2026-06-07-ooc-class-first-class-inheritance-design.md`（Spec A，含 as-built 纪要）+
> `docs/2026-06-07-ooc-class-instantiation-welcome-design.md`（Spec B）+ `docs/2026-06-07-ooc-class-spec-a-plan.md`。

## 1. 动机（两个体验缺口收敛到同一根因）

1. **全新 world 撞「需要先创建至少一个 stone」**：welcome 的对话目标只取 `/api/stones`，而 builtin
   supervisor 既不在 world stones、也不在 world packages。
2. **builtin 的 self.md/knowledge 从磁盘读永远落空**：`readSelf → stoneDir(builtinRef)` 指向
   `<world>/packages/@ooc/builtins/<id>`（`packages/@ooc/core/persistable/common.ts:82`），而任何
   world 该目录为空——supervisor 一直靠 LLM 从 objectId + root 知识**即兴演**「总管」，没加载到
   self.md 写的角色/边界、也没加载 `knowledge/` 里的 8 维度等 seed knowledge。

同一根因：OOC 缺少显式的「类」抽象。builtin 应是**类**（随框架发布、被继承），world 里应有它的
**实例**（可交互、拥有自己的身份磁盘副本）。

## 2. 设计

### 2.1 class vs object（`object.doc.ts:class_object` 节点）
- **object**：可交互 Agent，五件套（self.md / readable / executable / visible / knowledge），可 talk、跑 thinkloop。
- **class**：**不可交互**类定义，组成相同，仅供 object 继承（不能 talk、不跑 thinkloop）。单继承。
- `class` 是**唯一**继承机制，`prototype`/原型链全删（代码 + 文档 + 注释，无兼容）。

### 2.2 寻址与解析（as-built：复用 `_builtin/` 前缀）
- 框架 builtin class 以 `_builtin/<id>` 寻址：磁盘读（`readSelf`/`readReadable`/`stoneKnowledgeDir`）经
  `resolveBuiltinReadDir` 指向框架包 `@ooc/builtins/<id>`（`persistable/builtin-dir.ts`）。
- instance 是 `objects/<id>` 普通 stone：`stoneDir` 移除 bare builtin id 特殊解析（`common.ts`），
  bare id → `objects/`；`resolveBuiltinReadDir` 收窄为 `_builtin/` 前缀专用——避免 class 遮蔽同名 instance 磁盘。
- registry：ObjectRegistry 的 `store` 原生支持任意字符串键，`_builtin/<id>` 直接作 class 键注册（空
  methods 隐式继承 root，`ensureBuiltinClassRegistered`，`thinkable/knowledge/synthesizer.ts`）。
  instance 经 `ooc.class="_builtin/<id>"` → parentClass 链 `instance → _builtin/<id> → root`，
  无自引用 break（解对抗式评审 C1：键不同名）。

### 2.3 实例化（instantiate_with_new_world）
- class 的 `package.json` 声明 `ooc.kind="class"` + `ooc.instantiate_with_new_world=true`
  （`packages/@ooc/builtins/supervisor/package.json`）。
- world bootstrap 幂等实例化（`app/server/bootstrap/instantiate-classes.ts`，wired 进 `app/server/index.ts`）：
  对带 flag 的框架 class，若 `objects/<id>/` 不存在则建 object——拷贝 class self.md（own 身份）、
  `ooc.class="_builtin/<id>"`、commit on main；已存在则跳过（保用户改动）。

### 2.4 own 身份 / 共享行为
- 仅 self.md 实例化时拷贝快照（own 身份、不跟框架升级）。
- 方法经 parentClass 链活继承 class（→root）。
- knowledge：class seed knowledge **无条件**继承给 instance——`stoneKnowledgeDir` 对 `_builtin/<id>`
  走框架包 knowledge/，loader Step 1b 去除 inheritable 门控（`thinkable/knowledge/loader.ts`）。
  （class 存在即为被继承，区别于 B-tree 域祖先继承的 opt-in。）
- class 不可作 talk 目标：`seedSession` 拒绝 `_builtin/` 前缀目标（`app/server/modules/flows/service.ts`）。

## 3. 实现（commit 链，每步绿）

| commit | 内容 |
|---|---|
| `de958a1d` `a55674b5` | P0：`resolveBuiltinDir`/`resolveBuiltinReadDir` 框架包解析；readSelf/readReadable 修磁盘空读 |
| `7a97e230` | 剔除 prototype（8 处触点）；`ooc.class` 成唯一继承声明；`readStoneClass` |
| `aa219a35` | Spec B 核心：supervisor→class；bootstrap 实例化；stoneDir/resolveBuiltinReadDir 改造；移除 withBuiltinTalkTargets |
| `363b0fa3` | object.doc class_object 节点 + class_inheritance（替 prototype_chain）；seedSession 拒绝 class |
| `2efa7bb8` | knowledge 经 class 链继承（stoneKnowledgeDir builtin-aware + loader 去门控） |
| `d2ad65ce` | 设计稿 as-built 纪要 |

## 4. 验证（端到端实证）

全新 world → 后端 bootstrap 日志 `instantiated builtin class object(s): supervisor` →
`objects/supervisor/`（`ooc.kind=object`, `ooc.class=_builtin/supervisor`）真实落盘 →
`/api/stones` 返回 supervisor（无特殊逻辑）→ welcome 默认 supervisor、零门槛 → 对话回复含完整身份
+ 8 个能力维度 / world-vocabulary / 治理操作（rollback、审阅 PR-Issue）等**全部 5 篇继承的 seed
knowledge** + root 命令（class 链解析）。全 core 测试 871 pass / 0 fail；tsc + silent-swallow +
deprecated-symbols 全绿。

## 5. 维度落点

- **persistable**：`_builtin/` class 框架包解析 + `objects/` 实例 + `ooc.class` 载体 + bootstrap 实例化。
- **thinkable**：knowledge 经 parentClass(class) 链无条件继承；self.md 实例加载。
- **executable / collaborable**：方法经 class 链解析；class 不可交互（seedSession 拒绝）。
- **visible**：welcome 默认 supervisor 真 object，移除 `withBuiltinTalkTargets` 过渡逻辑。

## 6. 边界与未决（generality，无当前 consumer，未阻塞 supervisor 目标）

- **world 级用户自定义 `classes/` 子树**：设计稿 Spec A §2.3 的 `stones/<branch>/classes/<id>/` 持久层
  与扫描/注册尚未落地——supervisor 走框架 `_builtin/`，不需要；用户要自定义 class 时再补。
- **visible/readable 沿 class 链回退**：supervisor 无自定义 visible，未实现该回退。
- **self.md 快照漂移**（设计稿 M1）：框架升级 class 的 method 语义后，实例旧 self.md 快照可能描述旧
  行为契约——已知 trade-off，缓解（自我认知/行为契约分离 / 过期检测）未做。
