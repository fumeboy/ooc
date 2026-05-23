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

```
pools/objects/<id>/
  .pool.json
  sql/data.sqlite       ← bun:sqlite + WAL（runtime 待落地）
  knowledge/
    memory/<slug>.md    ← reflectable 写入位置
    relations/<peer>.md ← long_term 关系认知
  files/                ← 任意文件 / 二进制 / sql 行外 blob
```

- **不挂 branch**：事实是单向积累的，不跟着 metaprog branch 切
- **schema-in-stone, data-in-pool**：sql 的 migrations 在 stone 里做 PR-Issue review，data 在 pool 里高频累积
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
- **2026-05-23**（本次）：pool 层引入；knowledge / files 迁出 stone；data.json 迁到 flow
