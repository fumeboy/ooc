# OOC Object 归一化重构 design

**Date**: 2026-05-28
**Author**: Supervisor (Claude Code 主会话)
**Status**: Spec — pending implementation plan
**Branch target**: 远端 `ooc-3`（local worktree 同名）
**Replaces**: 当前 ooc-2 仓库中"OOC Agent ↔ Context Window 二分"的设计

## 摘要

把 OOC Agent 与 Context Window 这两个概念合并为同一个 **OOC Object**。Context Window 不再独立存在，只是 OOC Object 出现在 LLM context 中的一种形式。归一后系统获得：

- **概念简化**：一个 Object 即"LLM + 身份信息 + 方法 + 可选 UI"，再无 Agent / Window 二分
- **原型链继承**：Object 之间通过 JS-prototype-style 的 `extends` 链共享方法库与默认 UI，root 原型是终点兜底
- **塌缩"关系/状态"类型**：原 talk / do / todo / plan / relation 五个 window 类型不再是独立实体，退化为 owner Object 自身的字段 + root 原型上的方法 + defaultContext 切片
- **凡 Object 必持 LLM（lazy）**：8 个能力维度成为所有 Object 的内禀属性而非可选特性，符合"维度=构成自我的能力"判据
- **统一 ooc:// URI**：URI 1:1 镜像文件系统路径，runtime 与 web 共用同一解析器
- **物理重构同步**：原 `src/executable/windows/*` 内置类型搬迁为 `stones/_builtin/objects/<proto>/` 的出厂 Object 目录

执行路径：**from-scratch worktree（branch `ooc-3`）重建**，不在 ooc-2 上做渐进 refactor。完成后推送 `ooc-3` 至远端，ooc-2 作为 legacy reference 保留。

---

## §1 概念基底

### 1.1 单一概念 OOC Object

每个 Object 由 4 件东西组成：

1. **identity**：`self.md`（frontmatter + 身份描述）+ `readme.md`（外部说明）
2. **state**：`thread.json`（LLM thread，lazy 创建）+ 各类字段文件
3. **methods**：`server/index.ts` 显式导出 `{ public: {...}, private: {...} }`
4. **UI**：`client/index.tsx`（可选，缺则沿原型链 fallback）

"OOC Agent" 与 "ContextWindow" 退化为称谓——前者是"被 supervisor 派遣承担角色的 persistent Object"的角色名，后者是"Object 在 LLM context 里的呈现形式"的渲染名。底层都是 Object。

### 1.2 四条正交关系轴

| 轴 | 表达载体 | 语义 |
|---|---|---|
| 自我（super） | super flow / reflectable | Object 修改自己的 `self.md` / `server` / `client` |
| peer（talk） | talk 方法 | 给对方 LLM 发消息，唤起对方思考 |
| parent-child（修改权） | 目录层级 `children/` | 外层 owner 有权修改内层 child 的身份 |
| **prototype（继承）** | `self.md` frontmatter `extends:` | 方法库与默认 UI 沿链向上 fallback |

前三条沿用现有三轴关系模型；第四条 prototype 轴是本次新增的"类型继承"维度，与前三条完全正交。

### 1.3 Object 实例的三类生命期（位置即类别）

| 类别 | 路径 | 命运 |
|---|---|---|
| **builtin prototype** | `stones/_builtin/objects/<proto>/` | 出厂代码，与发行版同步；用户通过 `extends:` 继承；进 git |
| **persistent** | `stones/<branch>/objects/<name>/[children/<sub>/]*` | 跨 session 存活；进 git |
| **ephemeral** | `flows/<sessionId>/objects/<objectId>/` | session 期间创建；**永久保留**（不自动清理）；升格至 persistent 必须经 super flow 显式决策（fork snapshot 模式，原 ephemeral 不动） |

### 1.4 核心不变量

- **凡 Object 必持 LLM**：每个 Object 自带 `thread.json` 框架（默认从 prototype 继承 LLM 配置），但**仅在被 talk 时**真正消耗 token（lazy）
- **talk 是 root 原型 public 方法**：默认实现 = "塞消息进自己 context 并唤起 LLM"；子原型可 override
- **relations 内置进 root.defaultContext**：siblings + children URI 切片，不再是独立 Object 类型

---

## §2 物理结构

### 2.1 每个 Object 目录的标准内容

```
<object_dir>/
├── self.md                          # frontmatter (含 extends:) + 身份描述
├── readme.md                        # 对外说明（可选）
├── server/
│   └── index.ts                     # 显式导出 { public: {...}, private: {...} }
├── client/
│   └── index.tsx                    # 自定义 UI（可选，缺则原型链 fallback）
├── thread.json                      # 主 thread LLM state（首次被 talk 时按需创建）
├── plan.md                          # 主 thread 引导 plan（可选；常驻 context 顶部）
├── todos.json                       # 主 thread todo 列表（结构化，可选）
├── talks/                           # 对外通道（每 peer 一文件，append-only）
│   └── <peer_uri_slug>.jsonl
├── threads/                         # 对内 sub-thread（每子线程一目录）
│   └── <thread_id>/
│       ├── intent.md                # 子线程要做什么；含 parent_thread_id 字段
│       ├── thread.json              # 子线程独立 LLM
│       ├── actions.jsonl            # 子线程行动日志
│       ├── plan.md                  # 子线程自己的 plan（可选）
│       └── todos.json               # 子线程自己的 todos（可选）
└── children/                        # parent-child 修改权下挂的子 Object
    └── <child>/                     # 递归同形态
```

子目录均**按需创建**——一个 Object 可能从未 talk 任何 peer，`talks/` 就不存在。

### 2.2 三类位置详表

| 类别 | 路径模板 | id 规则 |
|---|---|---|
| builtin | `stones/_builtin/objects/<proto>/` | `<proto>` = 类型名（root / search / ...） |
| persistent | `stones/<branch>/objects/<name>/` | `<name>` 人类可读 slug |
| ephemeral | `flows/<sessionId>/objects/<objectId>/` | `<objectId>` = `<proto>_<short_hash>` |

### 2.3 8 个内置原型

由现有 14 个 window 类型按"实体 vs 关系/状态"重新分类后收敛：

| prototype | extends | 角色 |
|---|---|---|
| `root` | — | 根原型；提供 talk / do / todo_* / plan_* / grep / glob / open_file / open_knowledge / metaprog / write_file / end；`defaultContext()` 含 relations + 最近 talks + active threads + active plan + 未完成 todos 切片 |
| `program` | root | 编程沙箱 + history viewport |
| `search` | root | grep / glob 结果聚合 + refine / expand + results viewport |
| `file` | root | 文件查看 + viewport |
| `knowledge` | root | 知识打开 + viewport |
| `command_exec` | root | 命令执行 + submit / refine |
| `skill_index` | root | skill 索引浏览 |
| `custom` | root | 用户自定义"裸 Object"基底 |

塌缩掉的旧 window 类型：`talk` / `do` / `todo` / `plan` / `relation` —— 全部变成 owner Object 自身的字段 + root 方法 + defaultContext 切片。

### 2.4 B 类塌缩字段映射

| 旧 window 类型 | 字段载体 | root 原型方法 | defaultContext 切片 |
|---|---|---|---|
| ~~talk~~ | `talks/<peer>.jsonl` 每 peer 一文件 | `talk(target, content)` 单动词 | 最近 N 条 talks 摘要 |
| ~~do~~ | `threads/<thread_id>/` 每子线程一目录 | `do(intent)` → thread_id；`do_close(id)` | active threads 列表 |
| ~~todo~~ | `todos.json` 结构化列表 | `todo_add` / `todo_check` / `todo_uncheck` / `todo_remove` / `todo_list` | 未完成 todos |
| ~~plan~~ | `plan.md` 单文件常驻 | `plan_set(text)` / `plan_clear()` | active plan 顶置 |
| ~~relation~~ | `children/` + 同级扫描 | 读自动注入；写靠 metaprog | siblings + children URI |

塌缩判据：**"实体（有自己的数据/生命周期）"保留为 Object 原型；"关系/状态（依附于 owner）"塌缩为字段**。

### 2.5 talks vs threads 对偶

| 维度 | talk（对外） | do（对内） |
|---|---|---|
| 方向 | 跨 Object 沟通 | 本 Object spawn 内部子任务 |
| 通道载体 | `talks/<peer>.jsonl` 每 peer 一文件 | `threads/<thread_id>/` 每子线程一目录 |
| 推进方 | peer Object 的 LLM | 本 Object spawn 的 sub-thread LLM |
| 复数 | 同时多个 peer 对话 | 同时多个 sub-thread 工作 |
| 关闭 | append-only 无显式关闭 | `do_close(thread_id)` 显式终止 |

主 thread + sub-threads 形态统一——owner 拥有 1 个主 thread + N 个 sub-threads，同形态、同概念。

---

## §3 数据流

### 3.1 统一的方法调用形式

任何方法调用——LLM 触发或 program 沙箱内 JS 调用——都走同一条路径：

```
caller → executable dispatcher → prototype chain resolve → method body → state mutation → return
```

- LLM 触发：LLM 在 thread 里 emit action（XML/JSON），runtime 解析，dispatcher 找 Object 与方法
- 代码触发：program 沙箱内 `await targetObj.method(args)` 走 RPC 到 server，同一个 dispatcher
- prototype chain resolve：method 在 Object 自身找不到则沿 `extends` 链向上查（root 为终点）
- method body 在 server 进程同步运行，不卷入 LLM

### 3.2 talk 路径

`A.talk(target=B, content="...")` 由 root 原型实现，body 流程：

1. append 到 `<A>/talks/<B_uri_slug>.jsonl`，direction=`out`
2. append 到 `<B>/talks/<A_uri_slug>.jsonl`，direction=`in`
3. 调度 B 的主 thread worker wake（worker queue 入队）
4. 返回 ack 给 A 的 LLM

B 的 worker 唤起 B 主 thread，把最新 `<B>/talks/<A_uri_slug>.jsonl` tail 注入 context（由 root.defaultContext 的 talks 切片自动包含），B 的 LLM 决定是否回 `talk(A, ...)`，循环。

**不再有 talk_window 中介**；唯一的"对话实体"是双方各自的 talks 文件。UI 渲染共享视图时两端按 timestamp 合并。

### 3.3 do 路径与 sub-thread

`A.do(intent="...")` 流程：

1. 生成 `thread_id`（短 hash 或 intent slug）
2. 创建 `<A>/threads/<thread_id>/`：写 `intent.md`，init `thread.json`，按需置空 `plan.md` / `todos.json`
3. spawn sub-thread worker：worker 装载 A 的 `self.md` + `server/index.ts`（同一份方法集），用 `intent.md` 作为 seed system message
4. 返回 thread_id 给 A 主 thread

**关键 invariant**：
- sub-thread 复用 owner 的 `self.md` + `server/` + `talks/` + `children/`——**共享 owner 身份**
- sub-thread 调用 `talk(B, ...)` 时，B 看到的 sender 是 A（不是 thread_id），写入 owner 级 `talks/<B_slug>.jsonl`
- sub-thread 调用 `metaprog` / `write_file` 等修改性方法时，凭借的是 owner A 的修改权

**sub-thread 嵌套**（do-in-do）：
- **允许**——sub-thread 跑的是 A 的方法集，含 `do()`，所以可以再 spawn
- 物理结构**扁平**：所有子线程在 `<A>/threads/` 同层，靠 `intent.md` 的 `parent_thread_id` 字段记录派生关系
- 避免深层目录；让所有子线程的 active 状态在 A 主 thread 的 defaultContext 切片中扁平可见

**sub-thread 关闭**：
- sub-thread 自己 emit `close()` → 标记自身为 closed，停止接收唤起
- 或 owner 主 thread emit `do_close(thread_id)` → 强制关闭
- 关闭后目录保留（永久保留原则）；context 切片不再展示其为 active

### 3.4 ephemeral A 类 Object 创建路径

以 `A.grep(pattern, path)` 为例（root 原型 method）：

1. 生成 `objectId = search_<hash>`
2. 创建 `flows/<sessionId>/objects/<objectId>/`：写 `self.md`（含 `extends: search`、参数等），运行 grep，把结果作为 viewport 数据写入 Object 自身字段（具体字段由 search 原型决定）
3. **不**起 `thread.json`（lazy）——除非有人 talk 它
4. 返回 objectId / `ooc://flows/<sessionId>/objects/<objectId>` URI 给 A 主 thread

A 后续可以：
- 直接调用：`searchObj.refine("更窄的关键词")` 同步执行
- talk 唤起：`talk(searchObj, "再加上 .test.ts 过滤")` → search Object 的 LLM 被唤起、思考、决定调自己的 refine 方法

`program` / `file` / `knowledge` 同结构，各自的 root 原型 method 决定初始字段。

### 3.5 字段更新与 context 注入

| 字段 | 写入路径 | 注入 context 方式 |
|---|---|---|
| `talks/<peer>.jsonl` | `talk()` body 直 append | root.defaultContext 的 talks 切片读最近 N 条摘要 |
| `threads/<thread_id>/` | `do()` body 创建；sub-thread 自治更新内部 | root.defaultContext 的 threads 切片列出 active thread_id + intent 头 |
| `todos.json` | `todo_*` 方法 mutate JSON | root.defaultContext 的 todos 切片列未完成项 |
| `plan.md` | `plan_set` / `plan_clear` | root.defaultContext 的 plan 切片：非空则置顶注入 |
| `children/` 关系 | `metaprog`（结构性修改） | root.defaultContext 的 relations 切片：siblings + children URI |

所有切片由 root 原型的 `defaultContext()` 统一组装，子原型可 override 加自己的切片。

### 3.6 方法可见性 vs 调用边界

| 维度 | public | private |
|---|---|---|
| 在 context 中可见（LLM 能看到方法签名） | ✅ | ❌ |
| LLM emit action 调用 | ✅ | ❌ |
| 同 Object 其他方法内部调用 | ✅ | ✅ |
| program sandbox 内 JS 直接 RPC 调用 | ✅ | ❌ |
| 跨 Object 调用（B 调 A 的方法） | ✅ | ❌ |
| sub-thread 调用 owner 的 | ✅ | ✅（sub-thread 共享 owner 身份） |

**核心边界**：public = 暴露给世界，private = 只给自己用。跨 Object 与 LLM emit 都视为外部。

### 3.7 children/ 修改权与 sub-thread

- **children/ 的归属**：owner Object 拥有修改权（自我轴 + parent-child 轴）
- **sub-thread 共享 owner 身份**：可以走 `metaprog` 创建/修改 children——等同于 owner 主 thread 操作
- **临时 Object（flows/）不可拥有 children/**：ephemeral 不参与 parent-child 修改权层级（除非被 super flow 升格为 persistent）

---

## §4 加载与原型链

### 4.1 三类 Object 源的统一 loader

loader 启动时（与 watch 模式增量时）扫描三类源：

| 源 | 路径模板 | 角色 |
|---|---|---|
| **builtin** | `stones/_builtin/objects/<proto>/` | 出厂原型，必有 |
| **branch persistent** | `stones/<active_branch>/objects/<name>/[children/<sub>/]*` | 当前分支持久 Object |
| **flow ephemeral** | `flows/<sessionId>/objects/<objectId>/` | 当前活跃 session 临时 Object |

`active_branch` 从仓库 git HEAD 当前 branch 推断，由 `bootstrap/config.ts` 解析（沿用现机制）。

**flow scope**：只加载"当前活跃 session"的 ephemeral；历史 session 在 `flows/<other>/` 下不载入主 registry，但仍可通过 `ooc://flows/<other>/...` 显式寻址（visible 渲染只读）。

**加载策略**：
- 启动阶段：扫描 builtin + 当前 branch persistent → 建 prototype registry + Object 实例表
- 运行时：flow ephemeral 在创建时即时入注册表
- watch 模式（开发态）：监听 builtin + branch 目录变更，热重载 self.md / server / client；运行时状态（thread.json / talks 等）变更**不**触发 prototype 重建

### 4.2 Object 表与 prototype 链解析

```ts
type ObjectRecord = {
  uri: string;                                  // ooc:// 绝对地址
  path: string;                                 // 磁盘绝对路径
  kind: 'builtin' | 'persistent' | 'ephemeral';
  self: { extends?: string; ...frontmatter };
  serverPublic: Record<string, ServerMethod>;
  serverPrivate: Record<string, ServerMethod>;
  client?: ClientModule;
}
```

**prototype 链解析算法**（resolveMethod 与 resolveClient 共用）：

```
function resolve(obj, key):
  if key in obj.own:
    return obj.own[key]
  parent = obj.self.extends           // 'search'，省略则 'root'，root 自身的 extends 为 null
  if parent == null: return undefined
  parentObj = registry.get(resolveProtoURI(parent))
  return resolve(parentObj, key)
```

- **`extends:` 简写**：`extends: search` 解析为 `ooc://stones/_builtin/objects/search`
- **完整 URI**：想引用 branch 内 Object 当 prototype 时写完整 URI
- **省略 `extends:`**：等价 `extends: root`
- **root 的 extends**：null（链终点）
- **循环检测**：build registry 时拓扑校验，发现环则报错并拒载

### 4.3 ooc:// URI scheme

URI 1:1 镜像文件系统路径：

| 形态 | 路径 | URI |
|---|---|---|
| builtin | `stones/_builtin/objects/<proto>/` | `ooc://stones/_builtin/objects/<proto>` |
| persistent | `stones/<branch>/objects/<name>/` | `ooc://stones/<branch>/objects/<name>` |
| persistent child | `stones/<branch>/objects/<name>/children/<sub>/` | `ooc://stones/<branch>/objects/<name>/children/<sub>` |
| ephemeral | `flows/<sessionId>/objects/<objectId>/` | `ooc://flows/<sessionId>/objects/<objectId>` |
| sub-thread | `.../threads/<thread_id>/` | `ooc://.../threads/<thread_id>` |

runtime 与 web 共用同一份解析器。

### 4.4 缓存与失效

- **prototype 链/方法签名**：缓存在 registry，watch 监听 self.md / server 变更失效
- **client 模块**：开发态 vite HMR；生产 build-once
- **thread.json / talks / todos**：每次访问 fs，不缓存（避免并发 worker 间状态不一致）
- **defaultContext 切片产出**：每轮 LLM 调用前实时拼装，不缓存

### 4.5 不支持 override builtin

按 Q1-B 承诺，用户**可以 fork**（extends builtin 派生新命名原型），但**不能 override**（用同名 Object 替换 builtin 自身）。理由：override 同名会让 prototype 解析靠"加载顺序"决定，引入 spooky action。

---

## §5 Web 渲染

### 5.1 visible 维度的 ownership

`ooc://` URI 由 visible 维度解析；web 路由 1:1 映射磁盘路径。

| URI | SPA route |
|---|---|
| `ooc://stones/<branch>/objects/<name>` | `/stones/<branch>/objects/<name>` |
| `ooc://flows/<sessionId>/objects/<objectId>` | `/flows/<sessionId>/objects/<objectId>` |
| `ooc://stones/<branch>/objects/<name>/threads/<thread_id>` | `/stones/<branch>/objects/<name>/threads/<thread_id>` |

任何 Object 都通过这条统一路由可达。

### 5.2 Object 自定义 UI 与原型链 fallback

渲染流程：

```
渲染请求 URI X
  → loader.resolveClient(X)
  → 查 X.client/index.tsx：存在则用，结束
  → 沿 X.self.md `extends:` 链向上各祖先查 client/index.tsx
  → 找到第一个则挂载渲染
  → 全链都没有 → fall through 到 root.client/index.tsx（保底，必有）
```

**root 原型的 client/index.tsx 是 fallback 兜底，必须永远存在**。它渲染：

- 顶部：Object 身份卡片（self.md frontmatter 摘要 + readme.md）
- 中部：context slice 展示区
  - active plan（如有）
  - active threads（active subset of `threads/`）
  - 最近 talks（自动按 peer 折叠）
  - todos（未完成）
  - relations（siblings + children URI 列表）
- 底部：talk 输入框 + 调用 public 方法的按钮

子原型的 client 通过 slot 模型扩展 root.client——`search/client/index.tsx` 在 root UI 中部插入 results viewport；`program/client/index.tsx` 插入 history viewport。技术上靠 React 组件组合（root.client 暴露 slot props，子原型填）。

### 5.3 ephemeral Object 只读访问

- session 活跃期：ephemeral Object 在主 registry，能 talk、能直接 method 调用
- session 结束后：脱出 registry，但目录保留
- 通过 URI 访问时：web 走 visible 解析 → 临时拉起一个只读 Object record（不入主 registry）→ 渲染 self.md + 状态字段 + 历史 talks/threads；**不可发 talk 也不可调 method**

想"复活"必须通过 super flow 升格为 persistent。

### 5.4 与现有 AppShell / chat 模型的对接

- AppShell 顶层路由按 §5.1 表
- chat 模型从"跨 Object talk_window 列表" → "用户视角下浏览的 Object 列表"——每个 Object 自带 talk 输入框
- ObjectClientRenderer 走原型链 fallback resolver

### 5.5 方法 button 直调

web 端可以直接调用 public 方法（不经 LLM），用于快速操作（如点 "refine search"）。敏感方法可在原型级别标 `requireLLM: true` 拒绝按钮直调（如 `metaprog` / `write_file` 必须通过 talk 让 LLM 决定）。

---

## §6 meta 文档更新清单

### 6.1 重写

**`meta/object.doc.ts`** —— 概念权威，本次归一的宪法：
- root content 重写：引入 OOC Object 为根概念
- 新增子节点：4 关系轴 / 三类位置 / B 类塌缩判据
- 8 维度子节点保留，每节点开头补"维度是 Object 自带能力"的归一化校准

### 6.2 大幅更新

**`meta/app.server.doc.ts`** —— loader 三类源 + prototype 链算法 + ooc:// URI + ephemeral 创建路径 + talk 直投回路 + worker 唤起

**`meta/app.client.doc.ts`** —— AppShell 新路由表 + ObjectClientRenderer 原型链 fallback + chat 模型重写 + ephemeral 只读 + button 直调

### 6.3 中度更新

**`meta/engineering.testing.doc.ts`** —— 新增 e2e 场景（见 §7）；旧 windows 测试集 rename

**`meta/cookbook.author-ooc-object.doc.ts`**（新建，取代 add-new-agent + author-ooc-agent 两份合并）

### 6.4 小幅更新

- `meta/engineering.harness.doc.ts` —— AgentOfX 落地形态描述更新
- `meta/case.factor-dev-agents.doc.ts` —— 术语 "Agent" → "持久 OOC Object（充当 Agent 角色）"
- `meta/case.feishu-integration.doc.ts` —— 同步术语

### 6.5 不动

- `meta/harness.md` —— 历史 narrative 归档

### 6.6 新增 learning 沉淀

`docs/solutions/ooc-object-unification.md` —— 记录本次归一的设计决策树（Q1-Q5 + §1-§5 决策）作为 learning 文档。

---

## §7 测试策略

### 7.1 三档评分 + 双观察孔

沿用 `meta/engineering.testing.doc.ts`：Good / OK / Bad；A 孔 backend（`app.handle()`）；B 孔 frontend（Playwright）。

### 7.2 必加 e2e 后端场景

| 场景 | Good 标准 |
|---|---|
| **prototype chain resolve** | search Object 没有自定义 talk，沿链调 root.talk 成功；search.refine 自定义优先于 root |
| **public / private 边界** | private 方法被外部 talk/RPC 调用返回 403；同 Object server 内部互调 OK |
| **ephemeral 落盘** | A.grep 后 `flows/<sessionId>/objects/search_<hash>/` 真目录存在、含 self.md(extends: search) |
| **talk 直投回路** | A.talk(B) → B 主 thread 被唤起 → B 看到最新 talks/A.jsonl → B.talk(A) 走回路 |
| **sub-thread 扁平 + parent_thread_id** | A.do() spawn → `threads/<id>/` 出现；sub-thread 内再 do() → 仍在 A 的 `threads/` 同层，intent.md 记录 parent_thread_id |
| **sub-thread 共享 owner 身份** | sub-thread 内 talk(B)：B 看到 sender=A，写入 owner 级 `talks/<B>.jsonl` |
| **super flow 升格** | ephemeral fork 进 stones，原 flows/ 不动；新 persistent 可被 supervisor 派为 Agent 角色 |
| **B 类塌缩字段** | A.todo_add → `todos.json` 出现 item；A.plan_set → `plan.md` 写入；defaultContext 切片在下轮 LLM 调用注入 |
| **route-audit** | 8 个 builtin 原型上每个 public method 都有 HTTP 真路由；自动扫描断言 |
| **active_branch 隔离** | 切换 git branch 后 loader 重建：旧 branch 下 persistent Object 不再可调 |

### 7.3 必加 e2e 前端场景

| 场景 | Good 标准 |
|---|---|
| **AppShell 路由统一** | `/stones/<b>/objects/<n>` / `/flows/<s>/objects/<o>` / `.../threads/<t>` 三类路由直接进入正确 Object UI |
| **client 原型链 fallback** | 无自定义 client 的 Object 渲染 root.client UI；search Object 渲染 root.client + search results slot |
| **ephemeral 只读** | 进入 `/flows/<old>/objects/<id>` UI 不出现 talk 输入框、调用按钮 disabled |
| **方法 button 直调** | 点 refine 按钮 → 不唤起 LLM，直接 method 调用，UI 刷新 |
| **requireLLM 拒按钮直调** | metaprog / write_file 按钮置灰，必须通过 talk 让 LLM 决定才能调用 |

### 7.4 视为 merge gate 的 6 条 invariant

落地必须全 PASS：

1. **route-audit 全员通过**
2. **prototype chain resolve 单元测试 100% 覆盖**
3. **talk / do 直投回路 e2e PASS 在真浏览器**
4. **ephemeral 落盘 fs assertion**
5. **super flow 升格回路 e2e PASS**
6. **tsc --noEmit meta/*.doc.ts 全员通过**

### 7.5 不测的（YAGNI）

- ephemeral session 结束自动清理（按 X 永久保留）
- override builtin（按 §4.5 不支持）
- sub-thread 跨 Object spawn（按 §3.3 不允许）

---

## §8 迁移机制（from-scratch worktree 重建）

### 8.1 worktree 设置

- **新分支**：`ooc-3`（与远端推送目标同名）
- **路径**：`/Users/zhangzhefu/x/ooc-2/ooc-3-wt/`
- **起点**：`git worktree add <path> -b ooc-3 --orphan`（orphan 分支，无父节点，从纯空开始）
- 初始 commit 仅含 `.gitignore` + `LICENSE` + 本设计 spec
- **ooc-2 主分支不受影响**，继续承接其他改动作为参考实现，永远可查阅
- 这是一次**重建**而非 refactor：`src/executable/windows/` 这类被砍掉的概念从未"出现过"

### 8.2 复用边界

| 类别 | 处理 |
|---|---|
| **基础设施**（package.json / bunfig / tsconfig / vite.config / playwright.config） | 直接 copy from ooc-2 |
| **LLM transport / observation** | 直接 copy |
| **world-config + bootstrap** | 直接 copy |
| **program sandbox** | 直接 copy |
| **fs-search / 文件操作工具** | 直接 copy |
| **viewport 通用机制** | 直接 copy |
| **command 实现细节**（grep / glob / open-file 等 body） | 参考 copy——逻辑复用，wire 在新 root 原型 server/index.ts 内 |
| **executable loader / dispatcher** | **重写** |
| **window 类型代码** | **不复用**——B 类消亡，A 类按 §2 形态重写 |
| **talk_window / do_window / relation_window** | **不复用** |
| **AppShell + chat 模型** | **重写** |
| **e2e 测试** | **不复用**——按 §7 场景全新写 |
| **meta/*.doc.ts** | **重写**——用旧版作参考 |

**复用判据**：领域稳定且不与归一概念耦合 = copy；任何触及 "window" / "Agent vs Window 二分" 概念 = 重写。

### 8.3 阶段顺序

每阶段一组 commit，meta + code + tests 同 commit 原子。阶段之间允许部分 e2e 跑不通（rebuild 期间），但每阶段结束必须达到自己 gate。

| 阶段 | 内容 | gate |
|---|---|---|
| **P0：scaffolding** | 空 worktree → copy 基础设施 + `bun install` 跑通 → 写本 spec 落盘 commit | `bun test` 空跑 PASS |
| **P1：meta 概念骨架** | 写 `meta/object.doc.ts` 完整版 + 占位的其他 meta 文件 | `bun tsc --noEmit meta/*.doc.ts` 全 PASS |
| **P2：persistable + thinkable 基础** | copy world-config / bootstrap / llm transport；写 `src/persistable/object-record.ts` 等基础类型 | 能从空 stones 启动 server |
| **P3：loader + prototype 链** | 新 loader：三类源扫描 + extends 解析 + ObjectRecord registry + ooc:// 解析 | §4 单元测试全 PASS |
| **P4：root 原型 + defaultContext** | `stones/_builtin/objects/root/` 完整：self.md + server/index.ts + defaultContext + client 兜底 UI | root 原型 e2e PASS |
| **P5：B 类塌缩字段实装** | talks/threads/todos/plan 物理写入 + talk 直投回路 + sub-thread spawn 扁平 + 共享 owner 身份 | §7.2 B 类塌缩、talk 回路、sub-thread PASS |
| **P6：A 类内置原型** | 7 个原型完整目录；ephemeral 落盘机制 | §7.2 ephemeral 落盘 + route-audit PASS |
| **P7：visible / web** | 新 AppShell + ObjectClientRenderer 原型链 fallback + ephemeral 只读 + button 直调 + requireLLM | §7.3 全 PASS |
| **P8：super flow 升格** | reflectable 维度新增 promote 流程 | §7.2 super flow 升格 PASS |
| **P9：harness 9 Agent + cookbook** | 创建 `stones/main/objects/agent_of_thinkable/` 等 8 + `agent_of_experience/`；写 cookbook | harness 体验官端到端 PASS |
| **P10：收尾** | 沉淀 `docs/solutions/ooc-object-unification.md`；§6 其他 meta 全部到位；§7.4 六条 gate 终检 | 全 gate PASS |

### 8.4 远端推送

完成后：`git push origin ooc-3`。

ooc-2 作为 legacy reference 不动；future work 切换到 ooc-3 分支为新主线。

### 8.5 与 ooc-2 in-flight 工作的隔离

- worktree 工作期间不与 ooc-2 同步——from-scratch 的固有性质
- ooc-2 上若出现新 learnings，等 P10 收尾时由 Supervisor 决定是否在 ooc-3 上补一笔
- worktree 期间不要在 ooc-2 上重置 / cleanup 旧 `.ooc-world/`——新分支自带 `.ooc-world/`

### 8.6 rollback

- **before push**：直接删 worktree + 删本地分支即可
- **after push**：通过 ooc-2 回退，data 层因 X 永久保留不丢

### 8.7 push gate

切换前必过：

1. §7.4 六条 gate 全 PASS
2. `bun tsc --noEmit meta/*.doc.ts` PASS
3. AgentOfExperience 端到端 dogfooding 跑通：通过 web 与一个 persistent Agent talk → Agent 用 do spawn sub-thread → sub-thread 调 grep → 真出现 ephemeral search Object → 把结果作为 talk 回复给用户
4. Supervisor 终审 `meta/object.doc.ts` 与 `docs/solutions/ooc-object-unification.md`

### 8.8 工作量预估

- P0+P1 1 天
- P2+P3 3 天
- P4 2 天
- P5 3 天
- P6 3 天
- P7 3 天
- P8 1 天
- P9 2 天
- P10 1 天

**合计 19 工作日**（理想顺利）；含波折预留 **5 周日历周期**。

---

## §9 开放实现问题（留给 writing-plans）

以下细节在 spec 阶段不解决，留给 implementation plan：

1. **root.client 的 slot 协议具体形态**——React 组件 props slot vs hook-based composition，二选一
2. **`thread_id` 命名规则**——纯 short hash vs `<verb>_<short_hash>` vs `<intent_slug>_<short_hash>`
3. **talks 文件命名 `<peer_uri_slug>`** 的 slug 算法——保 url 安全 + 唯一可逆
4. **worker queue / scheduler 与 sub-thread spawn 的并发模型**——是否复用现有 worker.ts；并发上限策略
5. **defaultContext 切片各自的 token budget**——单切片 hard cap vs 按 LLM context window 比例分配
6. **method `requireLLM` 标记的具体声明位置**——`server/index.ts` 导出对象内 metadata vs 方法定义旁注解
7. **ephemeral 升格时 LLM thread.json 是否一并迁过去**——还是只迁 identity + state，thread 清空重启
8. **`flows/super/` 与 Object 自身 `super flow` 的物理对应关系**——已确认按现有约定放 `flows/super/...` 但目录细则未定
9. **基础设施 copy from ooc-2 的清单 minimal vs maximal 边界**——P0 阶段需要细化

## §10 附录：词汇对照表

| 旧概念 | 新概念 |
|---|---|
| OOC Agent | OOC Object（persistent，承担角色时称 Agent） |
| Context Window | OOC Object（在 LLM context 中的呈现） |
| window type | Object prototype |
| window command | Object method（public / private） |
| talk_window | 不存在（塌缩为 owner Object 的 `talks/<peer>.jsonl` 字段） |
| do_window | 不存在（塌缩为 owner Object 的 `threads/<thread_id>/` 字段） |
| todo_window | 不存在（塌缩为 owner Object 的 `todos.json` 字段） |
| plan_window | 不存在（塌缩为 owner Object 的 `plan.md` 字段） |
| relation_window | 不存在（塌缩进 root.defaultContext 的 relations 切片） |
| say command | 不存在（统一为 talk 单动词） |
| children/ Agent | children/ Object（同构于其他 Object） |

## §11 设计决策溯源

本 spec 由以下 brainstorm 决策树推导：

- **Q1** Object 类型库形态 → **B**：内置原型也以 Object 目录形态存在
- **Q2** talk 普遍化的语义 → **A**：凡 Object 必持 LLM，talk 即唤起思考（lazy）
- **Q3a** 原型链声明位置 → **A**：self.md frontmatter `extends:`
- **Q3b** 方法可见性标注 → **α**：server/index.ts 导出时显式声明 `{ public, private }`
- **Q4a** ephemeral 生命期处理 → **X**：永久保留
- **Q4b** ephemeral → persistent 升格 → **Q**：仅 super flow 路径
- **Q5a** parent-child 结构表达 → **A**：保持 `children/` 子目录
- **Q5b** relation_window 归宿 → **β**：内化为 root.defaultContext 切片
- **塌缩外推** B 类窗口塌缩范围 → **ii**：talk + do + todo + plan 全部塌缩
- **talk/say 命名** → 统一为单动词 `talk`（无 `say`）
- **§2 修正** 移除 `super/` 与 `context/` 子目录；todos 改 JSON；plan 重新定义为 thread 引导文本
- **§3 修正** `dos/` → `threads/`，主 thread + sub-threads 形态统一
- **§4 修正** URI 1:1 镜像文件系统路径（`ooc://stones/...` / `ooc://flows/...`），不支持 override builtin
- **§8 修正** from-scratch worktree（branch `ooc-3`）重建，不在 ooc-2 上做渐进 refactor
