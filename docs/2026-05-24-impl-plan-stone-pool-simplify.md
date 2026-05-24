# 实施方案：stone/pool 简化与 csv/seed knowledge/repos 落地

> **配套设计文档**：
> - `meta/object.doc.ts` persistable / reflectable / programmable 节点（设计权威）
> - `docs/2026-05-23-stone-pool-flow-trinary-landing.md`（2026-05-23 三分落地报告，含 05-24 修订指针）
> - `docs/2026-05-24-draft-object-as-repo.md`（远景 north star，不影响本方案）
>
> **本方案范围**：把 meta 中 2026-05-24 系列设计裁决落到 `src/`：
> - 删除 sql / database / migration runner 工程化重量级
> - 引入 csv 作为结构化数据载体
> - 落地 seed knowledge（stone 五件套含 knowledge）+ loader 双源扫描
> - 落地 pools/repos/ 外部 git repo 工作面（可作为后续阶段）

---

## 1. 改动总览（按模块分组）

### A. 持久层路径函数

| 动作 | 文件 | 函数 |
|---|---|---|
| **删** | `src/persistable/stone-object.ts` | `stoneDatabaseDir` / `stoneDatabaseSchemasDir` / `stoneDatabaseMigrationsDir` |
| **加** | `src/persistable/stone-object.ts` | `stoneKnowledgeDir` |
| **删** | `src/persistable/pool-object.ts` | `poolSqlDir` |
| **加** | `src/persistable/pool-object.ts` | `poolDataDir(ref)` / `poolDataFile(ref, name)` |
| **加** | `src/persistable/pool-object.ts`（或新文件 `pool-repo.ts`） | `poolReposDir(baseDir)` / `poolRepoDir(baseDir, name)` / `poolRepoWorktreeDir(poolRef, name)` / `sessionRepoWorktreeDir(flowRef, name)` |
| **改** | `src/persistable/stone-object.ts:createStoneObject` | 移除 `mkdir database/schemas + database/migrations`；不预创 `knowledge/`（seed 是可选项） |
| **改** | `src/persistable/pool-object.ts:createPoolObject` | 移除 `mkdir sql/`；改为 `mkdir data/`（按需）；不预创 `repos/`（World 级、延后处理） |
| **改** | `src/persistable/index.ts` | 同步 export：去 database / sql 系列、加 knowledge / data / repos 系列 |

### B. csv runtime（新增）

| 动作 | 文件 | 内容 |
|---|---|---|
| **选库** | `package.json` | 加 `papaparse`（轻量、广泛、零依赖友好）；或自实现小工具（< 100 行）。倾向 papaparse 节省维护 |
| **新建** | `src/persistable/csv-pool.ts` | `readCsv<T>(ref, name): Promise<T[]>` / `writeCsv<T>(ref, name, rows: T[])` / `appendRow<T>(ref, name, row)` / 可选 `queryRows<T>(ref, name, predicate)` |
| **接入** | 同上 | 写串行化键 `enqueueSessionWrite('data:'+baseDir+':'+objectId+':'+name)`（复用 `src/persistable/serial-queue.ts`） |
| **测试** | `src/persistable/__tests__/csv-pool.test.ts` | 读空文件 / 写入读回 / append / 并发写串行化 / 异常路径 |

### C. thinkable.knowledge loader 双源扫描

| 动作 | 文件 | 改动 |
|---|---|---|
| **改签名** | `src/thinkable/knowledge/loader.ts:loadKnowledgeIndex` | 从 `(ref: PoolObjectRef)` 改为 `(refs: { stone: StoneObjectRef; pool: PoolObjectRef })`；同时扫两侧目录 |
| **合并语义** | 同上 | seed 与 sediment 都进同一个 KnowledgeIndex；frontmatter / activates_on 协议统一；如同名冲突（seed 与 sediment 都有 `foo.md`），sediment 优先（运行时认知覆盖先天）——但应 console.warn 提示 |
| **调用方** | `src/thinkable/knowledge/synthesizer.ts` 等 | 改造为传 stone + pool 两个 ref |
| **测试** | `src/thinkable/knowledge/__tests__/loader.test.ts` | 双源扫描 / 冲突警告 / 单源 fallback（如只有 pool）正确 |

### D. reflectable 写入面文本更新

| 动作 | 文件 | 改动 |
|---|---|---|
| **改文本** | `src/thinkable/reflectable/reflectable-knowledge.ts:REFLECTABLE_KNOWLEDGE` | 删除 "stones/<self>/database/" 提及；加 "禁止写 stones/<self>/knowledge/（seed knowledge，走 PR-Issue）"；与 meta `reflectable.memory_layout` 对齐 |

### E. repos runtime（新增；**可作为阶段 4 延后**）

| 动作 | 文件 | 内容 |
|---|---|---|
| **新建** | `src/persistable/pool-repo.ts` | `clonePoolRepo(baseDir, name, remoteUrl)` / `openPoolRepo(baseDir, name)` / `addRepoWorktree(...)` / `removeRepoWorktree(...)` |
| **git 调用** | 同上 | 用现有 `src/persistable/stone-git.ts` 模式（CLI 薄包装）；不引入 simple-git / isomorphic-git 依赖 |
| **测试** | `src/persistable/__tests__/pool-repo.test.ts` | mock git CLI；验证路径计算与子进程调用形状 |

### F. 存量清理 + bootstrap

| 动作 | 文件 | 改动 |
|---|---|---|
| **改 CLI 描述** | `src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts` | doc 注释加：05-24 后 seed/sediment 二分，本 CLI 把全部 knowledge 当 sediment 迁是过度操作；用户应自行判定 |
| **加 advisory** | `src/app/server/bootstrap/check-stale-database-dir.ts`（新建） | 启动期检查 stones/<branch>/objects/<id>/database/ 残留，console.warn 提示用户在 stones worktree 内 git rm（不强制） |
| **接入** | `src/app/server/index.ts` | 启动期调用 checkStaleDatabaseDir |

### G. 测试与全局验证

| 项 | 验证标准 |
|---|---|
| `bun tsc --noEmit`（全 repo） | 与 baseline 同 N 处 pre-existing 错误，**不引入新失败** |
| `bun test` | 不引入新失败（baseline 已有 ~20 flaky，保持持平） |
| 五件套 smoke | stone 目录形态：仅 self.md / readme.md / server / client / knowledge/，无 database/ |
| 三件套 smoke | pool 目录形态：data/ + knowledge/ + files/，无 sql/ |
| 双源 knowledge smoke | 在 stones/<self>/knowledge/foo.md 与 pools/<self>/knowledge/memory/bar.md 各放一篇，验证 synthesizer 都能激活 |
| 删除残留 grep | `grep -rn "sql\|database\|sqlite\|migration_runner" src/`（除历史变更说明外）零结果 |

---

## 2. 实施阶段（按依赖顺序）

### 阶段 1：清理（破坏性变更收尾）—— 1 个 sub agent 1 轮

**目标**：移除 sql / database / migration 一切代码痕迹，保持 tsc + bun test 通过。

**改动集**：
- A1（删 stone-object database 函数）
- A3（删 pool-object sql 函数）
- A6（createStoneObject 不预创 database）
- A7（createPoolObject 不预创 sql）
- A8（index.ts export 同步）
- D（reflectable-knowledge.ts 文本更新）
- 全 repo grep 验证无悬挂引用：`grep -rn "stoneDatabaseDir\|poolSqlDir\|database/schemas\|database/migrations" src/`

**验收**：
- `bun tsc --noEmit` 全绿
- `bun test` 不引入新失败
- `src/persistable/__tests__/pool-object.test.ts` 同步更新（去 poolSqlDir 断言）

### 阶段 2：seed knowledge 双源加载 —— 1 个 sub agent 1 轮

**目标**：stone 五件套真正成立，loader 同时扫 stone seed + pool sediment。

**前置**：阶段 1 完成。

**改动集**：
- A2（加 stoneKnowledgeDir）
- A8（index.ts export 同步）
- C1-C3（loader 双源扫描 + 调用方改造）
- C4（loader / synthesizer 测试）
- meta sources 锚点更新：`persistable.stone.children.seed_knowledge` 加 `sources` 指向 stone-object.ts 与 loader.ts

**验收**：
- 双源 smoke：手工 mkdir stones/<test>/knowledge/、放 1 篇 md，验证 synthesizer 渲染时该 knowledge 出现
- 冲突 warn：stone 与 pool 同名 .md，loader 应 console.warn 且 sediment 胜出
- 单源 fallback：只有 pool 或只有 stone，loader 不报错

### 阶段 3：data csv 落地 —— 1 个 sub agent 1 轮

**目标**：csv 读写能力可用，server method 可在内部用 csv-pool 工具。

**前置**：阶段 1 完成。

**改动集**：
- A4（poolDataDir / poolDataFile）
- A7（createPoolObject 改为 mkdir data/）
- B1（papaparse 选型 + package.json）
- B2（csv-pool.ts 实现）
- B3（串行化键接入）
- 测试：csv-pool.test.ts

**验收**：
- 单测全过
- 集成 smoke：在一个 stone server method 里用 readCsv / writeCsv 完成一次 upsert + query 循环
- 并发 smoke：两个并发 thread 写同一 csv，无文件撕裂

### 阶段 4：repos 落地 —— **延后**，等真实需求出现再启动

**目标**：pools/repos/ 与 worktree 派生协议可用。

**前置**：阶段 1 完成；最好等 Object≡repo 远景方向有进一步信号。

**改动集**：
- A5（路径函数）
- E1-E3（pool-repo.ts + 测试）

**理由延后**：当前没有真实"多 Agent 协作改同一 repo"用例；meta 与文档已定义清楚，落地等用例驱动。

### 阶段 5：存量清理 + meta 锚点 —— 1 个 sub agent 1 轮

**目标**：bootstrap warn + meta sources 完整。

**前置**：阶段 1-3 完成。

**改动集**：
- F1（migrate CLI 注释更新）
- F2（check-stale-database-dir 启动期 warn）
- meta sources 锚点更新：
  - `persistable.stone` 加 sources 指向 stone-object.ts（已有则更新）
  - `persistable.pool.children.data_pool` 加 sources 指向 csv-pool.ts
  - `programmable.pool_methods` 加 sources 指向 csv-pool.ts 与 server-method 示例
- 同步更新 `docs/2026-05-23-stone-pool-flow-trinary-landing.md`：加 "2026-05-24 二次修订" 段（删 sql 改 csv）

**验收**：
- 启动期 warn 在残留 database/ 的旧 world 上能触发
- meta sources 锚点 grep 检测全部存在（不破断）

---

## 3. 风险与回滚

### 风险 1：papaparse 不在 bun 生态正常工作

**缓解**：先在隔离脚本 `bun -e "import Papa from 'papaparse'; ..."` 验证；不行就降到自实现小工具（< 100 行，标准 csv 不含特殊嵌套引号场景足够）。

### 风险 2：阶段 1 后某个调用方对 `stoneDatabaseDir` 有未被发现的引用

**缓解**：grep 全 repo + tsc 双重保险；阶段 1 完成前必须跑全量 `bun tsc --noEmit`。

### 风险 3：loader 双源扫描破坏现有 knowledge 渲染（性能 / 缓存）

**缓解**：双源扫描是叠加逻辑（不替换），原 pool 扫描行为保持不变；新增 stone 扫描挂在同一 loader cache 内。如有现有 cache key 设计假设 1 个 ref，需同步扩成 2 个 ref。

### 回滚策略

每个阶段独立 commit；如阶段 N 后发现根问题，git revert 该阶段 commit 即可。
**不应跨阶段 squash**——保留单步可回退性。

---

## 4. 验收清单（最终）

阶段 1-3 + 5 完成后，跑：

- [ ] `bun tsc --noEmit`：与 baseline 同错误数
- [ ] `bun test`：与 baseline 同 pass/fail 数
- [ ] `grep -rn "stoneDatabaseDir\|poolSqlDir" src/`：零结果
- [ ] `grep -rn "bun:sqlite\|PRAGMA user_version\|migration_runner" src/`：零结果（除注释中历史说明）
- [ ] stones/`<branch>`/objects/`<id>`/ 形态：self.md / readme.md / server/ / client/ / knowledge/（按需）；无 database/
- [ ] pools/objects/`<id>`/ 形态：data/ + knowledge/ + files/；无 sql/
- [ ] stones/`<self>`/knowledge/foo.md 能被 synthesizer 激活，与 pool sediment 同等渲染
- [ ] server method 可用 csv-pool 完成一次 upsert + query 循环
- [ ] meta sources 锚点 grep 全部存在
- [ ] docs/2026-05-23-stone-pool-flow-trinary-landing.md 后记段同步

---

## 5. 不在本方案范围

- **Object ≡ repo 远景**：完全保留为 docs/2026-05-24-draft-object-as-repo.md 草稿；不动 .stones_repo 模型；不拆 Object 为独立 repo。
- **eval gate**：seed knowledge 改动的 CI 评估测试协议（meta `seed_knowledge.todo` 第 4 条）；未拍板，延后。
- **params schema 校验**：CommandTableEntry 自动 params 检查（meta `programmable.todo`）；与本方案独立。
- **多 Object 同时 metaprog 的 manifest 锁版本**：Object≡repo 远景的子问题；延后。

---

## 6. 派单建议

- 阶段 1：派一个偏 "破坏性清理 + 全 repo grep 验证" 的 sub agent；明确"不引入新错误"的强约束
- 阶段 2：派一个偏 "代码新增 + 测试" 的 sub agent；最好同时改 loader 与测试
- 阶段 3：派一个偏 "新模块设计 + 选型决策" 的 sub agent；先评估 papaparse vs 自实现再动手
- 阶段 5：派一个偏 "文档同步 + sources 锚点" 的 sub agent（量小，可并入阶段 3）

每个阶段 sub agent 完成后，由 Supervisor 验证阶段验收清单；通过才进下一阶段。
