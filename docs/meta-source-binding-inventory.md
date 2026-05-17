# Meta ↔ Source 绑定 inventory

> **何时读这份**：想知道 OOC 哪些源码尚未在 `meta/` 概念图中有绑定、哪些应该补、
> 哪些可以不补。用于规划 meta 文档同步工作。
>
> 生成方式：`grep '@src/' meta/**/*.doc.js` 与 `find src -name "*.ts"` 对照。
> 详细方法见本文档末尾。
>
> 数据快照：**2026-05-17**

---

## 总览

| 维度 | 数 |
|---|---|
| `src/**/*.ts`（不含测试） | 143 |
| 已在 meta 中通过 `import * as ns from "@src/..."` 引用 | 60 |
| 未引用 | 83 |

未引用 ≠ 失同步：按 `meta-doc-maintenance` §11 "何时不必走概念图"，HTTP route glue
/ 私有 helper / 错误码定义等不必绑。下表按"是否值得绑"分类。

---

## 优先级分类

### ★★★ 必须补绑（核心对外设计点）

| 模块 | 文件数 | 缺失影响 |
|---|---|---|
| `@src/persistable/*` | 9 | Stone / FlowObject / thread.json schema 与 I/O 实现；OOC 对外承诺"对象可落盘"的实现层，但 `meta/object/persistable/index.doc.js` 是 blob，不通过 sources 绑定到任一具体文件 |
| `@src/thinkable/llm/*`（client / env / index / types） | 4 | LlmClient 统一门面 + LlmEnvConfig schema；OpenAI/Claude provider 已有概念绑定，但**门面层无绑定** |
| `@src/app/server/runtime/{job-manager,pause-store,resume,thread-query,types}` | 5 | Worker 调度核心：JobManager / PauseStore / resume 状态机 / paused 扫描；这些是后台运行的语义中枢 |
| `@src/thinkable/context/render` | 1 | XML context 渲染（system prompt + process event messages 全部从这里出）；`meta/object/thinkable/context/index.doc.js` 描述了 context 但 sources 只指 `index.ts` 不含 render |

### ★★ 应该补绑（重要内部能力）

| 模块 | 文件数 | 缺失影响 |
|---|---|---|
| `@src/executable/program/*`（shell / function / sandbox / format / self-env / types） | 8 | program command 的实际执行后端；program command 概念已绑 `@src/executable/windows/root/program.ts`（command 定义层），但执行层散落在 `executable/program/` 下 7 个文件无绑定 |
| `@src/executable/windows/{command-types,session-path}` | 2 | command 执行上下文类型 + session-aware 路径解析（spec 2026-05-17 新加） |
| `@src/app/server/modules/{stones,flows,runtime,ui}/{model,service}` | ~8 | 各 HTTP 模块的服务层 + Elysia 类型 schema |

### ★ 可选补绑（薄 router 层 / 配置）

| 模块 | 文件数 | 评估 |
|---|---|---|
| `@src/app/server/modules/*/api.*.ts` | ~40 | HTTP route glue，每个就是 `service.X` 的薄包装。可按"路由表总览"绑一次而非每文件 |
| `@src/app/server/bootstrap/{config,errors}` | 2 | 启动配置 + 错误码枚举；config 是工程入口该绑，errors 是枚举可不绑 |

### 不需要绑（按 §11 排除）

- `@src/app/server/modules/health/*` — 只是 health check
- `@src/app/server/modules/debug-ui/*` — debug 内网页面
- 各 `*.test.ts` / `__tests__/` — 单元测试 fixture（已被 §11 排除）

---

## 建议补绑路径（按 ROI 排序）

### Sprint 1：核心对外承诺（★★★）

1. **`meta/object/persistable/`** 升级为目录 + 概念图形态
   - 现有：`meta/object/persistable/index.doc.js` 单文件 blob
   - 应做：拆出 `stone-object`、`flow-object`、`thread-json`、`stone-data`、
     `stone-server`、`debug-file` 等概念（按 `src/persistable/` 的实际形态）
   - sources 各自指向对应 `.ts`

2. **`meta/object/thinkable/llm/index.doc.js`** 补 client / env / types 绑定
   - 现有：可能已有 provider-level 绑定（claude/openai 已有 docs）
   - 应做：在 llm/index 概念上加 sources `{ client, env, types, index }`

3. **`meta/object/thinkable/thread/scheduler.doc.js`** 扩 sources 含 runtime 子系统
   - 现有：scheduler 概念已绑 `@src/thinkable/scheduler`
   - 应做：扩 sources 加 `@src/app/server/runtime/{job-manager,pause-store,resume,thread-query}` —
     这些是 scheduler 的服务化外壳，目前散在 server runtime 下

4. **`meta/object/thinkable/context/`** 拆出 render concept
   - 现有：`context/index.doc.js` + `context/process-events.doc.js`
   - 应做：新增 `context/render.doc.js` 绑 `@src/thinkable/context/render`，把
     "XML system prompt + process event messages 两层拆分" 单独表达

### Sprint 2：内部执行能力（★★）

5. **`meta/object/executable/program/`** 新建目录拆 program 执行后端
   - 现有：`commands/program.doc.js` 只绑 command 入口
   - 应做：新建 `executable/program/{shell,function,sandbox}.doc.js`，sources 各
     指 `@src/executable/program/*`

6. **`meta/object/executable/concepts/session-path.doc.js`** 新建
   - 现有：spec 2026-05-17 后新加的 `@src/executable/windows/session-path.ts`，
     表达"数据原语用 thread.persistence.baseDir 解析相对路径"的设计点
   - 应做：单概念文件，sources 指该模块

### Sprint 3：HTTP 控制平面（★）

7. **`meta/app/server/`** 升级为目录 + 各 module 概念
   - 现有：`meta/app/server/index.doc.js` 单 blob 描述全部 API
   - 应做：按 `{flows, stones, runtime, ui, debug-ui, health}` 拆出概念，sources
     指向 `service.ts + model.ts`（不必每个 api.*.ts 都绑）

---

## 现有 meta 模块覆盖度

| meta 模块 | 当前形态 | 概念数 | 评级 |
|---|---|---|---|
| `meta/object/executable/` | 全概念图（已完整迁移）| 37 | ✅ |
| `meta/engineering/` | 全概念图（本轮升级）| 4 | ✅ |
| `meta/object/thinkable/` | 部分（context 已拆，其它 blob）| 7 | 🟡 |
| `meta/object/collaborable/` | 全 blob | 0 | ⚠️ |
| `meta/object/persistable/` | 单 blob | 0 | ⚠️ |
| `meta/object/observable/` | 多 blob 文件 | 0 | ⚠️ |
| `meta/object/extendable/` | 单 blob | 0 | ⚠️ |
| `meta/object/reflectable/` | 单 blob | 0 | ⚠️ |
| `meta/app/` | 多 blob | 0 | ⚠️ |

"概念数" = 通过 walkConcepts 识别为合规概念的数量。

---

## 工作量评估

| Sprint | 工作量 | 收益 |
|---|---|---|
| Sprint 1（persistable / llm / scheduler / context-render） | 1-2 天 | 锁住核心对外承诺；任何源码改名 → tsc 失败 |
| Sprint 2（program 执行后端 / session-path） | 半天 | 完整覆盖 executable 执行链 |
| Sprint 3（HTTP 控制平面） | 1-2 天 | 锁住 API 形态 |

每 Sprint 都按 `meta-doc-maintenance` §8.1 操作：新建概念文件 → import 到聚合层 → tsc + bun test
门禁全绿 → commit。

---

## 重新生成 inventory 的方法

```bash
# 1. 抽 meta 中所有引用的 @src/ 路径
grep -rh '"@src/' meta --include="*.doc.js" | grep -oE '@src/[^"]+' | sort -u > /tmp/meta-refs.txt

# 2. 列出 src 全部 .ts（不含测试）
find src -type f -name "*.ts" | grep -v __tests__ | grep -v ".test.ts" \
  | sed 's|^src/|@src/|; s|\.ts$||' | sort -u > /tmp/src-paths.txt

# 3. 求差集
comm -23 /tmp/src-paths.txt /tmp/meta-refs.txt > /tmp/src-unbacked.txt

# 4. 按模块聚合
cat /tmp/src-unbacked.txt | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
```

---

## 相关文档

- `meta/engineering/meta-doc-maintenance.doc.js` — 概念图维护规范（schema / sources 规则 / 维护操作）
- `meta/engineering/refactoring-governance.doc.js` — 重构治理（含 §8 文档同步规范）
- `docs/solutions/conventions/meta-concept-graph-2026-05-15.md` — 首次迁移的 field notes
- `docs/plans/2026-05-15-001-refactor-meta-concept-graph-executable-plan.md` — executable 模块首期迁移 plan
