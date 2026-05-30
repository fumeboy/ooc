# OOC-4 增量归一：Object / Context Window 统一 design

**Date**: 2026-05-30
**Author**: Supervisor (Claude Code 主会话)
**Status**: Spec — pending implementation plan
**Branch**: `ooc-4`（在 `ooc-2` 基础上小步增量，**非** from-scratch）
**Supersedes**: `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md`（ooc-3 from-scratch 版）

## 与 ooc-3 spec 的关系

ooc-3 spec 的**概念内核保留**（Object ↔ Context Window 归一、B 类塌缩、原型链、stone/pool/flow 三层）。ooc-3「不符合预期」的是 **from-scratch 大爆炸的执行路径**（orphan 分支重写一切），不是概念本身。

ooc-4 的两点修正：

1. **执行路径**：在 ooc-2 现有代码上**小步增量 refactor**，每步 `bun test` 绿；不重建。
2. **概念新增**：引入 **readable 第 9 维度** + **context/ 物理嵌套树**，并统一持久化目录命名。

---

## §0 摘要

把 OOC Agent 与 Context Window 合并为单一 **OOC Object**。Context Window 不再独立存在，只是 Object 出现在 LLM context 中的形态。归一后：

- **概念简化**：window `command` 与 object `method` 合并为统一的 `method`；window type 的 per-type 契约（`commands` / `renderXml` / `onClose`，见 `src/executable/windows/_shared/registry.ts`）升格为 per-object、沿原型链 fallback。
- **readable 第 9 维度**：Object 自我实现「出现在他者 context 中的展示」，与 visible（人类 UI）对偶。
- **原型链继承**：`self.md` frontmatter `extends:`；方法 / visible / readable 三者沿链 fallback，root 兜底。
- **A/B 分类**：实体类（program/search/file/...）成 builtin object 原型并进 context 嵌套树；关系/状态类（talk/do/todo/plan）塌缩为 owner flow 字段 + root 方法 + 自视切片；relation 删除，改 siblings/children 自动注入。
- **context 物理树**：运行时新建 object 落 `flows/<sid>/objects/<oid>/context/<newOid>/`，递归嵌套，取代 ooc-2 的 `thread.contextWindows[]` 扁平数组。
- **目录改名**：`server/`→`executable/`、`client/`→`visible/`、`readme.md`→`readable.md`、新增 `readable.ts`。
- **保留 stone/pool/flow 三层**：归一不动这条正交维度。

---

## §1 单一概念 OOC Object

### 1.1 context window 归位（第 0 条）

context window = **OOC Object 出现在 LLM context 中的形态**，不是独立实体。统一后：

- window `command` ＝ object `method`，统一称 **method**。
- 任何在某个 context 中可见的东西，背后都是一个 Object。

### 1.2 Object 的五件持久化组成（第 6 条）

| 组成 | 目录/文件 | 维度归属 | 旧名 |
|---|---|---|---|
| 身份 | `self.md`（frontmatter 含 `extends:`） | reflectable | self.md |
| 方法 | `executable/index.ts` | programmable / executable | `server/` |
| 对外展示 | `readable.(md\|ts)` | **readable（新）** | `readme.md`（仅静态） |
| 人类 UI | `visible/index.tsx` | visible | `client/` |
| 子对象 | `children/` | parent-child 轴 | `children/` |
| seed 知识 | `knowledge/` | reflectable | `knowledge/`（不变） |

---

## §2 readable 第 9 维度（第 4 条，宪法级）

### 2.1 定位：visible 的对偶

判定轴「维度 = 自我构成性（self-constitutive）」下，readable 通过门槛：Object 控制「自己如何出现在推理者眼前」，比人类 UI 更贴近自我本质。

```
visible  : 人类 / 浏览器
readable : 他者 LLM / context
```

8 维 → **9 维**。自我塑造组从 3 件套（reflectable/programmable/visible）→ **4 件套**（+readable）。

### 2.2 精确语义：只渲染「对外的脸」

**readable 仅在 Object X 作为 window 出现在 _其他_ Object Y 的 context 中时触发**——X 自己的 context（自视）不经 readable。

- `readable.md`：静态文本，直接作为 X 在他者 context 中的展示。
- `readable.ts`：导出 `readable()` 函数，计算 XML（可读 X 的运行时字段动态生成）。
- 沿原型链 fallback：X 无自定义 readable → 向上找祖先 → root 兜底。

**与现有代码的对应**：泛化 `src/executable/windows/_shared/registry.ts` 的 `renderXml` hook——把「per-window-type 注册的 renderXml」改写为「per-object 的 readable，沿 `extends` 链解析」。

### 2.3 自视 vs 对外（关键边界）

| | 渲染者 | 内容 |
|---|---|---|
| **X 的自视**（X 自己的 LLM 看到的） | thinkable 的 ContextBuilder | X 的 B 类切片（plan/todos/talks）+ X 的各子对象（每个走子对象自己的 `readable()`）+ 自动注入的 siblings/children（走它们各自的 `readable()`） |
| **X 的对外**（X 出现在 Y context 中） | `X.readable()` | X 控制自己这一个 window 节点的 XML |

即：一个 context 由「容器自身的自视逻辑」+「每个被包含 Object 的 readable() 输出」组装。readable 是被包含者贡献的那一块。

### 2.4 object.doc.ts root 同步项

- 判定轴叙述：自我塑造三件套 → 四件套。
- 维度清单：8 → 9，新增 readable 节点（与 visible 对偶）。
- named 词典：补 readable / 修订 visible。
- agent-native-parity：readable=agent 面展示，visible=人类面展示，二者是「展示」这件事的两个消费方。

---

## §3 原型链（第 5 条）

### 3.1 声明与解析

- `self.md` frontmatter `extends: <proto>`；省略 = `extends: root`；root 的 extends = null（链终点）。
- `extends: search` 简写解析为 `ooc://stones/_builtin/objects/search`；引用 branch 内 Object 当原型则写完整 URI。
- **方法 / visible / readable 三者共用同一套 resolve**：own 找不到 → 沿 `extends` 链向上 → root 兜底。
- build registry 时拓扑校验，发现环则拒载。

### 3.2 8 个 builtin 原型

落 `stones/_builtin/objects/<proto>/`，由现有 window 类型转写：

| 原型 | extends | 来源（现有 window） |
|---|---|---|
| `root` | — | windows/root：提供 talk/do/todo/plan/grep/glob/open_file/open_knowledge/program/metaprog/write_file/end + 自视 context builder |
| `program` | root | windows/program |
| `search` | root | windows/search |
| `file` | root | windows/file |
| `knowledge` | root | windows/knowledge |
| `command_exec` | root | windows/command_exec |
| `skill_index` | root | windows/skill_index |
| `custom` | root | windows/custom |

不支持 override builtin（同名替换会让解析靠加载顺序，引入 spooky action）；只支持 fork（extends 派生新命名原型）。

---

## §4 方法可见性（第 7 条）

每个 method 两个正交布尔标记：

| 标记 | 默认 | 语义 |
|---|---|---|
| `public?` | `false` | `false`=仅自己 context 可见可调；`true`=可被他人 / 跨 Object / LLM emit 调用 |
| `for_ui_access?` | `false` | `true`=前端可直调（不经 LLM）；取代旧 `llm_methods` 概念 |

| 调用场景 | public=false | public=true |
|---|---|---|
| 自己 context 中可见 / 自己 LLM emit 调用 | ✅ | ✅ |
| 同 Object 其他方法内部调用 | ✅ | ✅ |
| 跨 Object / 他者 LLM emit | ❌ | ✅ |
| 前端按钮直调 | 仅当 `for_ui_access=true` | 仅当 `for_ui_access=true` |

声明位置：`executable/index.ts` 导出方法时附 metadata（具体形态留 implementation plan）。

---

## §5 A/B 分类与塌缩（第 1 / 8 / 10 条 + 继承 ooc-3）

塌缩判据：**实体（有自己的数据/生命周期）→ 保留为 Object 原型；关系/状态（依附 owner）→ 塌缩为字段**。

### 5.1 A 类：实体 → builtin object 原型（进 context 树）

program / search / file / knowledge / command_exec / skill_index / custom。

运行时由 method 创建即进 context（第 8 条）：旧「command exec 开新 window」→ 现「创建新 Object 进入 context 作为 window 展示」，物理落 context/ 嵌套树（§6）。

### 5.2 B 类：关系/状态 → 塌缩（继承 ooc-3 §2.4）

| 旧 window | 字段载体（flow） | root 方法 | 自视切片（ContextBuilder） |
|---|---|---|---|
| ~~talk~~ | `talks/<peer>.jsonl` | `talk(target, content)` | 最近 N 条 talks |
| ~~do~~ | `threads/<thread_id>/` | `do(intent)` / `do_close(id)` | active threads |
| ~~todo~~ | `todos.json` | `todo_add/check/uncheck/remove/list` | 未完成 todos |
| ~~plan~~ | `plan.md` | `plan_set/plan_clear` | active plan 置顶 |

注：B 类切片是 owner 的**自视**（§2.3），由 ContextBuilder 渲染，**不走 readable**。

### 5.3 relation 删除（第 10 条）

relation window 取消。siblings + stone `children/` **自动注入** context（各自走自己的 `readable()`）。pool 长期 relations 知识合并进自视的 relations 切片。

### 5.4 继承的不变量

- **凡 Object 必持 LLM（lazy）**：A 类对象（如 search）可被 talk 唤起，决定调自己的 `refine` 等方法；仅被 talk 时才起 `thread.json` 消耗 token。

---

## §6 context/ 物理嵌套树（第 9 条）

### 6.1 物理形态

运行时新建 Object 落：

```
flows/<sid>/objects/<oid>/context/<newOid>/
                            └── context/<newOid2>/   # 递归嵌套
```

这是 context window 树的**物理表达**，取代 ooc-2 的 `thread.contextWindows[]` 扁平数组 + `parentWindowId`。

### 6.2 window 状态迁出 thread.json（已定子决策）

- **每个 window = 一个 `context/<oid>/` 目录**，自带 `self.md` + 运行时状态文件。
- `thread.json` 只保留 LLM 消息流（items / tool calls / results），**不再**内嵌 window 数组。
- 物理树即真相；ContextBuilder 每轮扫 owner 的 `context/` 子树 + 自视切片实时组装。

### 6.3 三个 context 来源（正交）

1. 自动注入：siblings + stone `children/`（§5.3）。
2. 运行时 A 类对象：嵌在 owner `context/<oid>/`（§5.1）。
3. owner 自己的 B 类切片：自视渲染（§5.2）。

---

## §7 web 归一（第 3 条）

- web 对每个 window type 的自定义 UI + diff 视图 → 改由 Object 的 `visible/` 模块实现。
- `ObjectClientRenderer` 走原型链 fallback resolve（与方法/readable 同套解析）。
- 无自定义 visible 的 Object → 沿链 fallback 到 root.visible 兜底。

---

## §8 持久化目录改名总表（第 6 条）

| 旧 | 新 | 说明 |
|---|---|---|
| `server/` | `executable/` | Object 方法库 |
| `client/` | `visible/` | 人类 UI |
| `readme.md` | `readable.md` | 静态对外展示文本 |
| —（renderXml hook） | `readable.ts` | 动态对外展示函数 |
| `self.md` | `self.md` | 不变 |
| `children/` | `children/` | 不变 |
| `knowledge/` | `knowledge/` | 不变（seed knowledge） |

---

## §9 执行排序（meta 先行 → 分层派单）

第一交付物 = 本 spec + 重写 `object.doc.ts`（**无代码**）。之后按水平层派 AgentOfX，每层 `bun test` 绿、可独立 review/回滚：

| 层 | 内容 | gate |
|---|---|---|
| L0 | 目录改名（server→executable / client→visible / readme→readable.md）+ 术语 command→method | 现有 test 全绿 |
| L1 | readable hook 泛化：renderXml → per-object readable，沿原型链解析 | readable resolve 单测 |
| L2 | 原型链 resolve：`extends:` 解析 + 方法/visible/readable 共用 | 原型链单测 + 环检测 |
| L3 | builtin object loader：`stones/_builtin/objects/<proto>/` 扫描入 registry | 8 原型加载 e2e |
| L4 | A 类迁移：7 个 window → builtin object 原型 | route-audit + A 类 method 调用 e2e |
| L5 | B 类塌缩：talk/do/todo/plan → owner flow 字段 + root 方法 + 自视切片 | B 类落盘 + 自视注入 e2e |
| L6 | relation 删除 + siblings/children 自动注入 | relations 切片 e2e |
| L7 | context/ 物理树：window 状态迁出 thread.json，运行时对象嵌套落盘 | context 树落盘 + 嵌套 e2e |
| L8 | web visible/ 归一：ObjectClientRenderer 原型链 fallback | 前端 visible fallback e2e |

每层落地时 meta + code + tests 同 commit 原子。

---

## §10 meta 文档更新清单

| 文件 | 改动 |
|---|---|
| `meta/object.doc.ts` | **重写**：单一 Object 概念 / readable 第 9 维 / 原型链轴 / A/B 分类 / context 树 / 目录改名；判定轴 3→4 件套 |
| `meta/app.server.doc.ts` | **大改**：builtin object loader / 原型链 resolve / context/ 物理树 / B 类塌缩字段路径 |
| `meta/app.client.doc.ts` | **大改**：visible 原型链 fallback / ObjectClientRenderer |
| `meta/engineering.testing.doc.ts` | **中改**：新增 §11 e2e 场景；旧 windows 测试集 rename |
| `meta/cookbook.add-new-agent.doc.ts` | **中改**：改为 builtin object + 五件套形态 |

改一个 `.doc.ts` 立刻 `bun tsc --noEmit meta/<file>.doc.ts`（`DocTreeNode.sources` 仅允许 1 个 entry）。

---

## §11 不变量与测试 gate

落地必过：

1. **原型链 resolve**：方法/visible/readable 三者 own 优先、沿链 fallback、root 兜底、环检测拒载——单测 100%。
2. **readable 对外语义**：X 出现在 Y context → 走 `X.readable()`；X 自视不经 readable。
3. **方法可见性**：`public=false` 被跨 Object/他者 LLM 调用拒绝；同 Object 内部调用 OK；`for_ui_access` 控前端直调。
4. **A 类落 context 树**：A.grep → `flows/<S>/objects/<A>/context/<search_oid>/` 真目录存在，含 `self.md(extends: search)`。
5. **B 类塌缩落盘**：todo_add → `todos.json`；plan_set → `plan.md`；talk → `talks/<peer>.jsonl`；自视切片下轮注入。
6. **context 树迁出 thread.json**：thread.json 不再内嵌 window 数组；ContextBuilder 扫 `context/` 子树组装。
7. **route-audit**：8 个 builtin 原型每个 public method 都有 HTTP 真路由。
8. **`bun tsc --noEmit meta/*.doc.ts`** 全 PASS。

不测（YAGNI）：override builtin（不支持）；历史 flow 自动清理（永久保留）。

---

## §12 开放实现问题（留给 writing-plans）

1. `readable.ts` 的 `readable()` 函数签名与可访问的运行时上下文范围。
2. 方法 metadata（`public` / `for_ui_access`）在 `executable/index.ts` 的具体声明形态。
3. window 状态迁出 thread.json 后，每个 `context/<oid>/` 目录内状态文件的 schema。
4. ContextBuilder 扫 `context/` 物理树的缓存/失效策略（避免并发 worker 状态不一致）。
5. L4 A 类迁移时 grep/glob/open-file 等 body 的复用边界（参考 copy vs 直接 wire）。
6. visible 原型链 fallback 的 slot 协议（root.visible 暴露 slot，子原型填）。

---

## §13 词汇对照表

| 旧 | 新 |
|---|---|
| OOC Agent | OOC Object（承担角色时称 Agent） |
| Context Window | OOC Object（在 context 中的形态） |
| window type | Object 原型（prototype） |
| window command | Object method（public / for_ui_access） |
| renderXml hook | readable（readable.md / readable.ts） |
| `server/` | `executable/` |
| `client/` | `visible/` |
| `readme.md` | `readable.md` |
| llm_methods | `for_ui_access` 方法 |
| relation window | 不存在（siblings + children 自动注入） |
| talk/do/todo/plan window | 不存在（塌缩为 owner flow 字段 + root 方法 + 自视切片） |
| thread.contextWindows[] | `flows/<sid>/objects/<oid>/context/<oid>/` 物理嵌套树 |
</content>
</invoke>
