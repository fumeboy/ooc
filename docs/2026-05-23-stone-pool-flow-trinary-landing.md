# stone / pool / flow 三分落地

> **何时读这份**：想了解 2026-05-23 这次 OOC 持久层重构（stone 二分 → 三分）改了什么、
> 影响哪些代码与外部契约、还有哪些尾巴没收。
>
> 起因：用户提出"server-type Agent 还缺一个 database 组件"。Supervisor 与用户一轮设计对话定下三分语义；
> dev / review / cleanup 三轮 sub agent 完成代码落地与验收。

---

## 一句话总结

OOC World 持久层从 **stone（设计 + 知识）/ flow（运行）二分** 扩成
**stone（设计）/ pool（事实）/ flow（运行）三分**——
knowledge 与 files 从 stone 迁到 pool；data.json 从 stone 迁到 flow；
新增 `stones/<self>/database/` 作为 pool/sql 的 schema 设计层。

> **⚠️ 顶部指针（必读）— 本文档已被 2026-05-24 两次修订**：
> - **一次修订**：knowledge 拆为 **seed（stone, git review）/ sediment（pool, 写就生效）** 二分。
> - **二次修订**：删 sql_pool 改用 csv（`pools/<id>/data/<name>.csv`）；stone 不再有 `database/` 子目录。
>
> 原文中"knowledge 全部迁 pool"、"新增 stones/<self>/database/"、"pool/sql"、"bun:sqlite" 等表述
> **均已被推翻**，以文末两段修订为权威。当前形态见 `meta/object.doc.ts persistable.stone` /
> `persistable.pool.children.data_pool`。

---

## 设计裁决（meta 中的权威表述见 `meta/object.doc.ts`）

### 1. 三层定位彻底干净

| 层 | 内容 | 周期 | git | review |
|---|---|---|---|---|
| **stone** | 设计：身份 + 源码 + schema | 永久 | ✓ | PR-Issue |
| **pool**  | 事实：sql / knowledge / files | 永久 | ✗ | 写就生效 |
| **flow**  | 运行：thread.json + data.json + session relation + UI 页 | 单次会话 | ✗ | 即用即弃 |

### 2. stone 缩水到"设计五件套"

```
stones/<branch>/objects/<id>/
  self.md          ← 对内身份
  readme.md        ← 对外公开介绍
  server/          ← stone server 源码
  client/          ← stone client 源码
  database/        ← pool/sql 的 schema 源码层（新增）
    schemas/<n>.ts
    migrations/<n>_*.sql
```

去掉了 `data.json` / `knowledge/` / `files/` —— 它们要么过 git 是噪音、要么是数据不该 review。

### 3. pool 新增（事实层）

> **⚠️ OBSOLETE — 见 "2026-05-24 二次修订" 段**：以下 pool 形态是 05-23 当时的设计，
> 含 sql/data.sqlite（bun:sqlite）+ schema-in-stone 工程化方案；
> 05-24 简化后改为 `data/<name>.csv`（手写 RFC 4180 子集），删除 sql 整条链路。
> 当前权威形态见 `meta/object.doc.ts persistable.pool.children.data_pool` 与文末修订段。

```
pools/objects/<id>/
  .pool.json
  sql/data.sqlite       ← [OBSOLETE 05-24] bun:sqlite + WAL（已删除，改用 data/<name>.csv）
  knowledge/
    memory/<slug>.md    ← reflectable 写入位置
    relations/<peer>.md ← long_term 关系认知
  files/                ← 任意文件 / 二进制 / 大体量 blob
```

- **不挂 branch**：事实是单向积累的，不跟着 metaprog branch 切
- **schema-in-stone, data-in-pool**：[OBSOLETE 05-24] 当时设计 sql 的 migrations 在 stone 里做 PR-Issue review；
  05-24 删 sql 后，csv 没有 schema 声明文件（列即首行）；原则简化为 "design-in-stone, data-in-pool"
- **LLM 视野简化**：写 `pools/<self>/...`，rewriter 自动注入 `objects/`

### 4. flow 加 `data.json`

`ProgramSelf.getData / setData` 从原来的 `stones/<self>/data.json`（跨 session）
迁到 `flows/<sid>/objects/<self>/data.json`（**session-scoped**）。

API 形状（顶层 spread merge）保留；语义变化：跨 session 共享不再可用。

---

## meta 文档改动

`meta/object.doc.ts` 的以下节点已同步更新（单文件 `bun tsc --noEmit` 通过）：

- **root content + named**：三分总览
- **persistable**：根 content / world_layout / stone（缩水）/ flow（加 session_data）/ **新增 pool 节点**（含 sql_pool / knowledge_pool / files_pool 三 children + 5 patches）/ refs（PoolObjectRef）/ stone_versioning（git 追踪面收缩说明）
- **reflectable**：root content / memory_layout / metaprogramming / dont_summarize / business_task_isolation —— 所有写盘路径改 pool
- **collaborable.relation_window**：long_term 路径全部改 pools/...
- **programmable**：program_self_injection（getData/setData 改述）+ **新增 patches.pool_methods**

---

## 代码改动

### 新增（5）
- `src/persistable/pool-object.ts` — PoolObjectRef + 路径函数全套 + createPoolObject + derivePoolFromThread
- `src/persistable/flow-data.ts` — flowDataFile + readData / writeData / mergeData，串行化 `flow-data:` 键
- `src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts` — 一次性迁移 CLI 命令（dryRun + per-object 报告；只复制不删除）
- `src/app/server/bootstrap/check-pool-migration.ts` — 启动期 advisory 警告
- `src/persistable/__tests__/{pool-object,flow-data}.test.ts` — 单元测试

### 修改（核心 ~10）
- `src/persistable/stone-object.ts` — 移除 knowledge / files 路径函数；新增 stoneDatabaseDir / Schemas / Migrations；createStoneObject 缩水到五件套
- `src/persistable/index.ts` — 导出更新；移除 stone-data
- `src/executable/server/self.ts` — getData / setData 切到 flow-data
- `src/executable/windows/_shared/session-path.ts` — 新增 rewritePoolsPath
- `src/thinkable/knowledge/{loader,synthesizer,basic-knowledge}.ts` — knowledge 扫描切到 pool
- `src/thinkable/reflectable/reflectable-knowledge.ts` — memory 协议路径改 pool
- `src/executable/windows/relation/{index,types}.ts` — long_term 提示改 pool
- `src/executable/windows/talk/index.ts` — LLM 视野路径改 pool
- `src/app/server/modules/stones/{index,model,service}.ts` — **删除 HTTP `/api/stones/:id/data` 路由**；`createStone` 改写 self.md 首行
- `src/app/server/index.ts` — 启动期接 checkStoneToPoolMigration
- 8 处单测同步 / 3 处 integration 测试更新

### 删除（3）
- `src/persistable/stone-data.ts`
- `src/app/server/modules/stones/api.get-data.ts`
- `src/app/server/modules/stones/api.patch-data.ts`

---

## 验收结果

- **tsc 全 repo**：与 baseline 同 9 处 pre-existing 错误，**未引入新失败**
- **bun test**：526 pass / 20 fail / 11 skip。20 fail 全部 baseline pre-existing
  （LLM-flaky integration / metaprog e2e / U8 recovery-check）
- **smoke test**（独立重做）：stone 五件套形态 ✓ / pool 三件套形态 ✓ /
  ProgramSelf 跨 session 隔离 ✓ / rewritePoolsPath ✓ / bootstrap warn ✓ /
  memory 写入 + 重启复读 ✓
- **文档代码一致性**：meta sources 锚点全部存在；目录形态与 meta 描述一致

---

## 已知 contract break（升级注意）

### 1. `createStone(name, description)` —— description 字段从 schema 移除

历史上 `createStone` 接受 `name` / `description`，写入 `stones/<id>/data.json`。
data.json 删除后：
- `name` → 写 self.md 首行（与 `visible.display_name_from_self_md` 协议吻合）
- `description` → **从 HTTP schema 与函数签名彻底删除**

风险：若有外部 API consumer 传 `description`，Elysia 默认 silently drop（与之前 void 行为等价）；
若将来开 strict 模式会变 422。Release notes 应 flag。

### 2. `ProgramSelf.getData / setData` 语义变化

API 形状（顶层 spread merge）保留；存储位置从 `stones/<self>/data.json`（跨 session）
改为 `flows/<sid>/objects/<self>/data.json`（session-scoped）。

如果某个 server method 历史上依赖"在 session A 写、session B 读到"，
迁移后这种用法将失效。要保留旧语义需显式改写为通过 stone server method 写 pool/sql。

### 3. HTTP `GET / PATCH /api/stones/:id/data` —— 路由删除

这两个路由已删除（grep 全 web/src 验证零 caller）。
如果有未发现的外部 HTTP 客户端在用，会 404。

---

## 未完成 todo

### 短期工程整理（应在下一轮一并清理）

- meta 文档漂移：以下几处 dev 已落地但 meta 仍写"待落地"，需 sweep
  - `persistable.flow.session_data` 仍说 "src/persistable/flow-data.ts 待落地"
  - `persistable.pool.todo` 第 1 / 3 条已完成（pool-object.ts 路径函数、存量数据迁移工具）
  - `persistable.stone.todo` 两条已完成（stone-data.ts 删除、knowledge 路径迁移）
  - `persistable.world_layout` 文末"poolDir 待 src/persistable/pool-object.ts 落地"
  - `persistable.refs` 说 derivePoolFromThread "待落地"
- pre-existing meta drift（不是本轮引入但顺手可修）：
  - `collaborable.relation_window` 多处 sources 仍写 `src/executable/windows/relation.ts`，实际已是 `relation/index.ts`

### 中期能力补全（meta 已声明 todo）

- **pool sql runtime**：bun:sqlite 连接 + WAL + connection cache（按 PoolObjectRef 复用）
- **migration runner**：forward-only `<n>_<name>.sql` 自动 apply；通过 `enqueueSessionWrite('db:'+baseDir+':'+objectId)` 串行化
- **params schema 校验**：`stones/<self>/database/schemas/<n>.ts` 同时驱动运行时校验

### 存量数据迁移（依赖用户主动跑）

- `.ooc-world*/stones/<branch>/objects/<id>/{knowledge,files}` 一次性迁到 `pools/objects/<id>/{knowledge,files}`
  通过 CLI 命令 `migrate-stone-knowledge-to-pool` 触发；命令只复制不 git rm，
  用户需在 stones worktree 内手工 `git rm + commit` 才完整脱钩 git 追踪
- 启动期会 console.warn 提示有未迁移的 world

### 未拍板的设计点

- `programmable` todo（pre-existing）：Object 注册多个自定义 window 类型（不仅 self window）；目前 `export const window` 是单数

---

## 相关文件

- 设计权威：`meta/object.doc.ts`（root / persistable / reflectable / collaborable.relation_window / programmable）
- 落地代码：见上方代码改动清单
- 落地工作流：本文件即"完成报告"

---

## 历史

- **2026-05-21**：stones/<branch>/objects/ 中间层引入（per-Object 与 world-level 分开）
- **2026-05-23**：pool 层引入；knowledge / files 迁出 stone；data.json 迁到 flow
- **2026-05-24**（修订）：knowledge 拆为 seed（stone, git review + eval gate）/ sediment（pool, 写就生效）二分；详见下文修订段
- **2026-05-24**（二次修订，简化）：删除 stone database/ 子目录；删 pool sql_pool；改用 csv 作为结构化数据载体（pool/data/<name>.csv）；详见对应修订段

---

## 2026-05-24 修订：knowledge seed/sediment 二分

### 起因

用户在回看 2026-05-23 落地后提出：knowledge 影响 Agent 能力表现，变更应当经过版本管理和评估测试——
全部丢进 pool 不对。Supervisor 一轮设计对话后定下：knowledge 内部本来就有两层，应当分别落两处。

### 二分边界

| 层 | 来源 | 路径 | git | review | 写入面 |
|---|---|---|---|---|---|
| **seed** | 人类（或 metaprog Agent）设计的初始知识库 | `stones/<self>/knowledge/<slug>.md` | ✓ | PR-Issue + eval gate | **不在 super flow 默认面** |
| **sediment** | reflectable / collaborable 运行时沉淀 | `pools/<id>/knowledge/{memory,relations}/` | ✗ | 写就生效 | super flow 默认面 |

对应能力来源的二分：
- 能力的"先天"部分（设计者赋予）需要严格 review + eval —— seed in stone
- 能力的"后天"部分（运行中沉淀）需要低摩擦累积 —— sediment in pool

为什么不全 stone：reflectable 每次自反思都走 PR-Issue 会卡死维度的自动性；
高频 sediment 塞进低频 review 盒子，review 必然形同虚设。

为什么不全 pool（即 05-23 的版本）：seed 是 Agent 能力基底，
变更应当过 version control + eval；pool 没有这两个性质。

### meta 文档改动（已落地）

`meta/object.doc.ts` 单文件 `bun tsc --noEmit` 通过：

- **root content + named**：stone 升六件套（self / readme / server / client / database / **knowledge**）；新增 seed/sediment 词条
- **persistable.world_layout**：目录树加 `stones/<id>/knowledge/<slug>.md`；pool 的 knowledge 注释改 "sediment-only"
- **persistable.stone**：六件套子项 + 历史变更段（标记 05-24 二次修订）+ **新增 `children.seed_knowledge` 子节点**
- **persistable.pool.knowledge_pool**：定位为 sediment-only；双源扫描；super flow 只写 sediment
- **persistable.pool.patches.knowledge_no_git**：重写为 "seed/sediment 二分边界"
- **persistable.pool.patches.schema_in_stone_data_in_pool**：knowledge 行加注 "仅 sediment 在 pool"
- **reflectable**：content / memory_layout / business_task_isolation / metaprogramming 全部加 "seed 不在默认面，走 PR-Issue + eval"
- **thinkable.knowledge**：加双源扫描段
- **collaborable.relation_window**：long_term relation 描述精化为 "sediment knowledge"

### 代码改动（未落地）

`persistable.stone.children.seed_knowledge.todo` 登记 4 条工程项：

1. `src/thinkable/knowledge/loader` 改双源扫描——原本只扫 pool，需补扫 `stones/<self>/knowledge/`
2. `src/persistable/stone-object.ts` 加 `stoneKnowledgeDir` 路径函数（与 `stoneDatabaseDir` 对称）
3. `createStoneObject` 是否预创建空 `knowledge/` 目录（设计待定——seed 可选，不预创可能更干净）
4. eval gate 协议——seed 改动 PR 时如何挂能力评估（未拍板）

最小集是 1 + 2；3 待 seed 引入第一个真实用例时回头看；4 是中期能力。

### 已知影响

- **2026-05-23 的迁移 CLI `migrate-stone-knowledge-to-pool`** 现在是"过度操作"——把全部 knowledge 当 sediment 迁到 pool。
  已在 `persistable.stone.todo` 中加注：用户迁移后需自行判定哪些条目属于 seed 并迁回 stone（或在 worktree 内 git rm 并保留 stone 的新 seed 版本）。
- **没有新的 contract break**：seed 路径是新增的；旧 sediment 路径（pool/knowledge/memory + relations）形态不变；
  reflectable 写入面不变（仍只写 sediment + 身份）。
- **协议向后兼容**：synthesizer 双源扫描后，原 pool-only 知识仍按 sediment 加载；seed 是叠加新增。

### 哲学一致性

修订后三层定位更干净：

- **stone = 设计意图**：身份（self/readme）+ 行为源码（server/client）+ 数据 schema（database）+ **知识种子（knowledge）**
- **pool = 运行时事实**：sql data + sediment 知识（memory/relations）+ files
- **flow = 单次会话**：thread + session data + session knowledge

每一类内容都对应一个明确的演化入口：设计层走 PR-Issue + eval；事实层 reflectable / collaborable 自动写入；运行层即用即弃。

---

## 2026-05-24 二次修订：删 sql 改用 csv

### 起因

2026-05-23 的 pool 设计里 `sql_pool` 走 bun:sqlite + WAL + forward-only migration runner（`stones/<self>/database/migrations/<n>_*.sql`），
属于完整的"工程化重量级"持久层方案。Supervisor 二次评估后判定：

- OOC 当前阶段（dogfooding 还没真正起来）**用不到这种复杂度**——没有百万行级数据、没有复杂聚合查询、没有高并发事务。
- bun:sqlite 引入 connection cache、migration runner 协议、schema 与运行时双向校验……每一项都增加 stone server method 实现者的认知负担。
- "schema-in-stone / data-in-pool" 二元自身没错，但"schema = sql DDL"显得过载：列变更要写 migration、要跑 forward-only，
  和 OOC "高频实验、轻协议、文件即真相"的气质冲突。

裁决：**删 sql，改用 csv 作为 pool 的结构化数据载体**。未来真有 sql 需求再以 sql_pool 形态回归，与 data_pool 并存即可。

### 设计要点

**1. data csv 形态**

```
pools/objects/<id>/data/
  <name>.csv         ← 一张"表"；首行 header，后续行记录；逗号分隔；标准 csv 转义
  factors.csv
  users.csv
  metrics.csv
```

- 命名 **kebab-case**（与文件路径约定一致；防 path-traversal）。
- **无 schema 声明文件**：列即文件第一行；列变更直接改文件，**无 forward-only migration 概念**。
- **无 collection / docId 抽象**：一个 .csv = 一张逻辑表。

**2. LLM 路径暴露是合法例外**

与 knowledge md / repos 同级——LLM 可通过 `file_window.open path="pools/<self>/data/<name>.csv"` 直接读写 csv，
不强制经 server method 中转。server method 主要在两种场景下提供价值：

- 大批量写 / 复杂查询：避免 LLM 反复读全表。
- 语义化封装：让 LLM 看见 `upsert_factor` 比"读 factors.csv 找一行改一行写回"更顺手。

简单的"查看 / 偶尔小改"，LLM 直接 file_window 操作即可。

**3. 并发与一致性：写入串行化 + write-then-rename**

- csv 整文件写：`enqueueSessionWrite('data:'+baseDir+':'+objectId+':'+name)` 串行化避免读写撕裂。
- 写盘协议：write-then-rename（先写临时文件、再 fs.rename 原子替换），防部分写。
- 不支持复杂事务；应用层（server method）自己保证一致性。

### 影响

**删除的概念 / 节点**:

- `stones/<branch>/objects/<id>/database/` 子目录及其 `schemas/<n>.ts` + `migrations/<n>_*.sql` 形态；
  stone 从"六件套"缩回 **五件套**（self / readme / server / client / knowledge）。
- `meta/object.doc.ts` 中 `persistable.pool.children.sql_pool` 节点（连同其 patches 中的 `migration_runner_protocol` /
  `schema_in_stone_data_in_pool` 的 sql 表述）被删除或重写。
- `programmable.pool_methods` 中"sql-based pool method"语义被"csv-based pool method"取代。

**新增**:

- `persistable.pool.children.data_pool` 节点：data csv 形态约束 + 适用 / 不适用场景。
- `persistable.stone` named 中删 "database/" 行；children 不再有 stone_database。

### meta 文档改动清单

`meta/object.doc.ts`（单文件 `bun tsc --noEmit` 通过）：

- **root content + named**：去掉"六件套"改回"五件套"；新增 "data csv" 词条 + 删除 sql 相关词条。
- **persistable.pool.children.data_pool**：新增节点；含 sources 锚点（csv-pool.ts + pool-object.ts:poolDataDir/poolDataFile）。
- **persistable.pool.children.sql_pool**：删除。
- **persistable.pool.patches**：删除 `migration_runner_protocol`；`schema_in_stone_data_in_pool` 重写为 csv 语义。
- **persistable.stone**：children 不再含 stone_database；named 删 "database/"；content 调回五件套描述。
- **programmable.pool_methods**：内容重写为 csv-based；新增 sources 指向 `src/persistable/csv-pool.ts`。

### 代码改动清单

- **新增** `src/persistable/csv-pool.ts`：`readCsv` / `writeCsv` / `appendRow` —— 标准 csv 转义；
  写入用 write-then-rename + `enqueueSessionWrite('data:...')` 串行化键。
- **修改** `src/persistable/pool-object.ts`：新增 `poolDataDir(ref)` 与 `poolDataFile(ref, name)`；
  name 做 kebab-case 校验。
- **修改** `src/thinkable/reflectable/reflectable-knowledge.ts`：写盘协议文本同步——删除 sql 相关提示，
  knowledge 路径文本保持指向 pool/knowledge/。
- **删除** `src/persistable/` 下任何残留 sql_pool / migration runner 相关代码（若有）；
  stone-object.ts 不再导出 `stoneDatabaseDir` / `stoneDatabaseSchemas` / `stoneDatabaseMigrations`。

### 已知影响

- **旧 .ooc-world 中的残留 `stones/<branch>/objects/<id>/database/`**：失去语义，但空目录无害。
  启动期由新加的 `src/app/server/bootstrap/check-stale-database-dir.ts` advisory 检测并 warn，
  提示用户在 stones worktree 内 `git rm -r database/` + commit；不强制。
- **旧 .ooc-world 中的 sediment knowledge 路径不变**：仍是 `pools/<id>/knowledge/{memory,relations}/`；
  本轮简化只动 data 载体，不动 knowledge 形态。
- **旧 stone server method 若有 sql 实现代码**：本仓库自有的 stone 没有这种实现（sql 协议未真正落地代码），
  所以无 contract break。若外部 fork 已经基于 2026-05-23 sql 协议开始写 server method，
  需要把读写逻辑切到 csv-pool 的 API。

### 哲学一致性（与上一段修订叠加）

三层定位**进一步**简化：

- **stone = 设计意图**：身份（self/readme）+ 行为源码（server/client）+ **知识种子**（knowledge）。
  （删掉了"数据 schema (database)"——schema 即 csv 第一行，无需独立设计层）
- **pool = 运行时事实**：data（csv 结构化）+ sediment 知识（memory / relations）+ files（非结构化 blob）+ repos（外部 git）。
- **flow = 单次会话**：thread + session data + session knowledge。

stone 的每一件都是"高赌注、低频改、应当 review"；任何被识别为"高频累积"的内容（包括从前的 sql data）都下沉到 pool。
csv 是 pool 的最简实现形态——人类可读、LLM 可直接 file_window 操作、无第三方运行时依赖。
