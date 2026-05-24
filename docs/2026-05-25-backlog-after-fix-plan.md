# Backlog after 10 Root-Cause Fix Plan — 待确认项详细展开

> **状态**：体验官 Round 1-7 + 10 根因 fix 全部完成（commits `89a1cdc` → `d1683c6`，已 push origin/ooc-2）。
> 本文档列出剩余待确认项，按优先级分 A/B/C/D/E 五段。
> 每项展开**前因 / 后果 / 代码或文档位置 / 修复方向 / Supervisor 推荐**，请阅读并对每项给出"做 / 推迟 / 不做"决策。
>
> **配套**：
> - `docs/2026-05-24-fix-plan.md`（10 根因设计权威）
> - `docs/2026-05-24-experience-rounds.md`（体验官 Round 1-7 audit trail）
> - `docs/2026-05-24-draft-object-as-repo.md`（Object≡repo north star 草稿）

---

## A 段：立即可做的小修（< 1 turn 工作量）

### A1. R7-2 — sandbox 2 处 bare `catch{}` 例外白名单

**前因**：根因 #6（silent-swallow ban）audit 时发现 `src/executable/program/sandbox/` 下 2 处 `catch {}` 完全无 log / event / rethrow，违反 fix-plan 字面契约"所有 catch 块必须做 (a)(b)(c) 至少一项"。但实际场景是 sandbox tmp 文件清理失败 / JSON.stringify 兜底——这种 cleanup 性质的失败如果 throw 反而会破坏主流程。

**后果**：
- 不修：fix-plan 字面要求未完整满足；下次审计跑 grep 会再次命中（误判为新 bug）
- 风险等级：极低（实际危害为零；只是约束文字与现实不符）

**代码位置**：
- `src/executable/program/sandbox/console.ts:18` — JSON.stringify 失败时 fall through 到 String(arg) 兜底
- `src/executable/program/sandbox/executor.ts:56` — 沙箱 cleanup tmp file 失败时静默

**修复方向**：
- **不**改代码逻辑（cleanup 路径 throw 会破坏主流程）
- 在两处加 `// intentional: sandbox cleanup 失败不应破坏主程序流；类型见 meta/observable.silent_swallow_ban.sandbox_exception` 注释
- `meta/object.doc.ts:observable.silent_swallow_ban` 加 "sandbox 例外白名单" 段，显式声明 2 种 sandbox 路径（tmp cleanup / serialization fallback）是 ban 例外

**Supervisor 推荐**：**做**（5 分钟改 2 处注释 + 1 段 meta，让约束与现实一致）

---

### A2. R7-3 — typebox VALIDATION 错误字面值未展开

**前因**：根因 #8（错误模型统一）落地后，schema 含 `t.Union([t.Literal("stone"), t.Literal("flow"), t.Literal("pool")])` 的字段验证失败时，response 显示 `"should be one of: 'string', 'string', 'string'"`——typebox 把每个 Literal 的 type 名印 3 次，没有印实际允许值。

**后果**：
- 不修：调试人体感差（开发者 / 体验官 / 外部 caller 看不到允许值）
- 客户端逻辑不受影响（schema 名义信息仍在 `details.all` 字段）

**代码位置**：
- `src/app/server/index.ts:60-115` — `normalizeErrorToJson` VALIDATION 分支
- `src/app/server/index.ts:95-110` — `elysiaCode === "VALIDATION"` 处理

**修复方向**：
- 在 normalizeErrorToJson 加一个 helper `flattenValidationDetails(errors)`：遍历 `error.all`，若 entry 有 `schema.anyOf` 数组且每项含 `const`，把 message 改成 `"should be one of: <const list>"`
- 大约 20-30 行新增

**Supervisor 推荐**：**做**（半小时活，让错误信息真正 friendly）

---

### A3. R7-4 — TreeScope 未含 "pools"

**前因**：2026-05-23 stone/pool/flow 三分落地后，`pool` 是一等公民。但 `/api/tree?scope=...` endpoint 仍只支持 `world | flows | stones`；前端浏览 `pools/objects/<id>/` 内容只能走 `world` scope + 手输 path。

**后果**：
- 不修：前端 sidebar 没有 "Pools" tab；用户体验上 pool 是隐藏存在
- 是 2026-05-23 三分落地后的**设计漂移**——文档已说 pool 是顶级三分之一，但 API 没跟上

**代码位置**：
- `src/app/server/modules/ui/model.ts:18` — `export type TreeScope = "world" | "flows" | "stones";`
- `src/app/server/modules/ui/service.ts:34` — `scopeRoot()` 加 pools 分支
- `src/app/server/modules/ui/service.ts:40` — `scopePrefix()` 加 pools 分支
- `web/src/domains/files/model.ts` — frontend TreeScope 同步
- `web/src/app/layout/Sidebar.tsx` — sidebar 加 "Pools" tab（可选）

**修复方向**：
- backend：3 处加 pools 分支
- frontend：sidebar tab 列表加 "Pools"，scope union 同步
- 测试：补 e2e `scope=pools` 返回正确 tree

**Supervisor 推荐**：**做**（1 小时活，弥补三分落地漂移）

---

### A4. fix-plan verification probe 段

**前因**：Round 7 反馈 #1——fix-plan 的 acceptance criteria 是自然语言（如 "mentions:['ghost'] 默认拒"），体验官需要主观穷举验证；这次就因为 sub agent 只动了 `appendComment` 漏掉 `createIssue` 入口，留下 R7-1 残留。

**后果**：
- 不修：未来新一轮 fix cluster 时同类问题再次发生（acceptance criteria 不可机器检查）
- 修：把每个根因 fix 都附 1-3 行可执行 probe（curl / grep / bun -e），让验收自动化

**位置**：
- `docs/2026-05-24-fix-plan.md` — 末尾加 "Verification Probes" 附录段

**修复方向**：
- 为 10 根因每个写 1-3 行 probe
- 示例：
  - #2 HTTP-git：`curl -X POST /api/stones -d '{"objectId":"x"}' && git -C $WORLD/stones/main log --oneline | head -1`
  - #8 错误模型：`curl -s /api/notexist | jq '.error.code'` → `"NOT_FOUND"`
- 可作为未来 Round N 复测的标准脚本

**Supervisor 推荐**：**做**（1 小时活；让 fix-plan 变成"可机器复测"的设计文档，方法论价值远超内容本身）

---

## B 段：体验官 Round 8 候选方向

每个方向都是 Round 1-7 未覆盖的真实使用场景；优先级取决于哪些方向更可能揭示 dogfooding 级缺陷。

### B1. LLM 真链路浏览器交互

**前因**：Round 1-7 多数体验观察基于 HTTP 模拟或代码 grep，少数跑了真 LLM（Round 4/6 各跑了一次）。但"真用户用浏览器跟 OOC 聊天"的完整链路（前端 chat composer → POST /api/flows/.../continue → worker 跑 LLM → 渲染回前端 → 时间线显示）从未被作为单一场景跑过。

**后果**：
- 不跑：可能 dogfooding 闭环在浏览器层有协议级缺口（如 Round 4 #19/#20 do_window 回报，同源风险）
- 跑：消耗 1 LLM credit + 60-90 分钟

**位置**：
- `web/src/domains/sessions/components/Composer.tsx`（前端 chat composer）
- `src/app/server/modules/flows/api.continue.ts`（HTTP 入口）
- `src/observable/`（debug 文件落盘）
- `meta/app.client.doc.ts:chat 模型`

**Supervisor 推荐**：**做 Round 8 优先**（dogfooding 核心，价值最高）

---

### B2. stone client / flow client 双层 UI 实跑

**前因**：根因 #3 已修 `ObjectClientRenderer` 路径硬编码；但 stone client 与 flow client 双层 UI 协作（`stones/<id>/client/index.tsx` 与 `flows/<sid>/.../client/pages/<page>.tsx`）从未真用浏览器跑过——Round 6 仅触发了 ObjectClientRenderer 加载错误。

**后果**：
- 不跑：双层 UI 协作（visible 维度另一面）真实可用性未知；可能有 Round 6 #40 同源 problems
- 跑：需 1-2 个真实 stone + flow page 实例（可自己 mock 写一个）

**位置**：
- `web/src/domains/clients/ObjectClientRenderer.tsx`
- `meta/object.doc.ts:visible.stone_client / flow_client_pages`
- `src/persistable/stone-client.ts`

**Supervisor 推荐**：低优；与 B1 浏览器交互合并跑，能省一半 setup 时间

---

### B3. collaborable.relation_window 真链路

**前因**：relation_window 是 Round 1-7 完全没触达的子维度。relation 文件 IO（pool sediment + flow session 双层）+ `edit` command + relation_window 渲染 + LLM 视野中 long_term/session 路径标注，整条链路无体验官验证。

**后果**：
- 不跑：可能有 silent-swallow 或 visibility 缺口（与根因 #6 同源风险）
- 跑：60 分钟左右；需真 LLM 触发 talk_window 然后看 relation_window 派生

**位置**：
- `src/executable/windows/relation/`
- `src/persistable/flow-relation.ts`
- `meta/object.doc.ts:collaborable.relation_window`

**Supervisor 推荐**：低优；与 B1 合并跑

---

### B4. talk_window 完整生命周期

**前因**：体验官跑了 say 命令，但 talk_window 全套（open / refine / submit / say / mark / close + cross-session delivery）作为单一场景从未端到端走过。Round 4 #19 揭示了 do_window 协议缺口；talk_window 是其姊妹 window，可能有同源风险。

**后果**：
- 不跑：talk_window 完整协议可能有未发现缺口
- 跑：30-45 分钟

**位置**：
- `src/executable/windows/talk/`
- `src/executable/windows/talk/delivery.ts`
- `meta/object.doc.ts:collaborable.talk_window`

**Supervisor 推荐**：低优；与 B1 合并

---

### B5. observable.debug_file 全量协议

**前因**：根因 #5 worker 改造时 debug 文件没专门验证。`llm.input.json / llm.output.json / loop.input.json / loop.output.json / loop.meta.json` 五类文件的写盘协议（什么时候 flush、错误如何记录、文件大小限制）只在某些路径被测试。

**后果**：
- 不跑：根因 #5 改造可能漏掉 debug 文件协议某 corner case
- 跑：1 小时；含跑 LLM 真链路 + 手工查 debug 文件落盘

**位置**：
- `src/observable/debug-file.ts`（或类似）
- `src/persistable/debug-file.ts`
- `meta/object.doc.ts:observable.debug_files`

**Supervisor 推荐**：低优；除非 B1 体验官报告"debug 信息缺失/混乱"才优先

---

## C 段：未拍板的设计决策（需要 Supervisor × user 对话）

### C1. ui_methods 沙箱 vs 信任

**前因**：体验官 Round 3 #13 揭示 HTTP `/call_method` 暴露的 ui_methods 完全无沙箱——LLM 可 PUT 含 `import 'fs'` 的代码并通过 HTTP 调用读 host `/etc`。`program_window` 走 sandbox/wrap，但 ui_methods HTTP 路径裸 import host runtime。

**核心张力**：
- 信任模式（当前）：ui_methods 作者 = stone 作者 = OOC 自治区 owner；trusted code execution
- 沙箱模式：ui_methods 与 program_window 同协议 wrap；信任边界外移

**后果（不拍板）**：
- 信任模式默认有效，但安全边界未在 meta 显式声明
- 任何"复用别人的 stone"场景下成为 supply chain 风险

**代码位置**：
- `src/executable/server/loader.ts:55` — `loadUiServerMethods`
- `src/app/server/modules/stones/service.ts:266` — `callMethod` HTTP 入口
- `src/app/server/modules/flows/service.ts:543` — flow callMethod
- `src/executable/server/types.ts:70` — UiServerMethod entry 形状

**Supervisor 推荐方向**（user 拍板）：
- **选项 A**（信任模式，需要决策表态）：在 `meta/programmable` 或 `executable.server` 显式声明"ui_methods 作者必须是 stone 作者；HTTP 调用方信任 stone 作者"；加 GET schema endpoint 让作者快速发现契约
- **选项 B**（沙箱模式）：复用 program_window 的 sandbox 协议，wrap ui_methods 执行；牺牲 ui_methods 与 host 直接交互的能力
- 倾向 A——OOC 当前 dogfooding 阶段没有 multi-tenant 场景；信任模式简单可用

---

### C2. seed knowledge eval gate 协议

**前因**：根因 #1 修了 reflectable 的 sediment write contract（frontmatter 强制）；但 seed knowledge（stones/<self>/knowledge/）的 eval gate 还是 todo。

**核心张力**：
- seed knowledge 影响 Agent 先天能力，变更应过评估
- 但 eval 机制本身要怎么定义（test framework? LLM evaluator?）

**位置**：
- `meta/object.doc.ts:persistable.stone.children.seed_knowledge.todo`（已记）
- `docs/2026-05-24-fix-plan.md` 中根因 #1 引用了此 todo

**Supervisor 推荐方向**（user 拍板）：
- **选项 A**（推迟）：当前 OOC 还没有"seed knowledge 变更引发能力退化"的真实案例；先放着
- **选项 B**（设计）：定义 eval gate 协议（LLM judge / unit test / specific scenarios）写进 meta
- 倾向 A——等真实需求出现再设计

---

### C3. Object ≡ repo 是否升级为 v2 架构方向

**前因**：2026-05-24 supervisor × user 对话涌现"每个 OOC Agent 就是一个 git repo"的对称洞察，写进 `docs/2026-05-24-draft-object-as-repo.md` 草稿。当时拍板：保留为 design north star 候选，不写入 meta，不启动迁移。

**核心张力**：
- 全部好处（Agent 可分发 / federated OOC / cluster 协作）
- 全部代价（重写 .stones_repo 模型 / StoneObjectRef 语义 / world manifest）

**位置**：
- `docs/2026-05-24-draft-object-as-repo.md` — 草稿全文
- `meta/object.doc.ts:persistable.pool.children.repos_pool` — 当前 pools/repos 实现是"务实落地版"

**Supervisor 推荐方向**（user 拍板）：
- **选项 A**（暂缓）：草稿不动；等真实需求（如 OOC marketplace / 跨 world 协作）出现再启动
- **选项 B**（实验）：选 1-2 个 Agent 试点拆成独立 repo，验证语义
- **选项 C**（接受为 v2 方向）：写入 meta `persistable.future.object_as_repo` 节点，作为 v2 主线
- 倾向 A——OOC 现状仍处 dogfooding 阶段，远景方向不必急于拍

---

### C4. cross-session end notify（super-alias 场景）

**前因**：根因 #5 worker 事件驱动改造 sub agent 末尾报告的 caveat：end 命令 notify 用 `persistence.sessionId` 路由；若 callee 在 super session，caller 在 user session，notify 可能找不到 thread → jobManager 标 failed。现有 `syncCrossObjectCalleeEnds` 在 caller 拿到 job 时 fallback 读 callee disk state，暂可用。

**核心张力**：
- 当前 fallback 已让功能正常；但 jobManager 偶发 "failed" 状态对前端是干扰
- 干净修复需要给 ThreadContext 加 `creatorSessionId` 字段（C5）

**位置**：
- `src/executable/windows/root/command.end.ts:79-91` — autoReplyAndArchiveDo
- `src/executable/windows/talk/delivery.ts:notifyThreadActivated`
- `src/thinkable/context/index.ts:147` — ThreadContext 当前有 `creatorObjectId` 但无 `creatorSessionId`

**Supervisor 推荐方向**：
- **与 C5 一起做**（同根问题）

---

### C5. ThreadContext 加 creatorSessionId 字段

**前因**：与 C4 同根。ThreadContext 当前有 `creatorThreadId` 和 `creatorObjectId`，但没 `creatorSessionId`——super-alias 场景（callee 在 super session，caller 在 user session）下 notify 不知道 caller 所在 session。

**位置**：
- `src/thinkable/context/index.ts:138` — `creatorThreadId?: string;`
- `src/thinkable/context/index.ts:147` — `creatorObjectId?: string;`（这里加 `creatorSessionId?: string;`）
- `src/executable/windows/_shared/init.ts` — `initContextWindows` 注入位置
- `src/executable/windows/talk/delivery.ts` — 派生 caller persistence 时使用
- `src/thinkable/__tests__/context.test.ts:101` + `scheduler.test.ts:45` — 测试

**修复方向**：
- ThreadContext 加 `creatorSessionId?: string;`
- `initContextWindows` 注入 creator window 时同时设置
- talk-delivery / do-delivery 走 cross-session 派送时读这个字段
- 端到端测试：super-alias 场景 end notify 不再 failed

**Supervisor 推荐方向**：**做**（半天活；让 R5 fixed cluster 完全 clean）

---

## D 段：工程化提升（防回归）

### D1. ESLint rule `no-empty-catch` + `no-void-async`

**前因**：根因 #6 silent-swallow audit 是 grep 周期审计——每次大重构后跑 grep 是被动防线。ESLint rule 在 IDE / pre-commit / CI 中提示，主动防回归。

**位置**：
- 项目当前没 ESLint 配置（已检查；no .eslintrc / eslint.config）
- 若引入，新建 `eslint.config.ts` + `package.json` 加 `lint` script

**修复方向**：
- 引入 ESLint + typescript-eslint
- 启用 `no-empty` 规则（含 `allowEmptyCatch: false`）
- 自定义规则 `no-void-async-result`（不存在内置规则；自写 ~50 行）
- 加 `package.json` `lint` script + pre-commit hook

**Supervisor 推荐**：**推迟**——OOC 还小，grep 周期 audit 够用；引入 ESLint 是较大 framework decision，等代码规模 +50% 再考虑

---

### D2. ESLint rule 禁止 service 层 return `{code, message}` 裸形态

**前因**：根因 #8 修了 onError 全覆盖，但 service 层 return 裸 `{code, message}` 是 anti-pattern；ESLint 能在 service 编写时主动提示"用 throw AppServerError 而不是 return"。

**位置**：
- 同 D1（依赖 ESLint setup）

**Supervisor 推荐**：**与 D1 一起或暂缓**

---

### D3. CI 跑 `bun tsc --noEmit` + silent-swallow grep 周期检查

**前因**：当前没有 CI；所有验证都是本地 bun test + tsc。`silent-swallow audit` / `tsc baseline` 等周期检查需要人手跑。

**位置**：
- 项目当前没 CI 配置文件（.github/workflows / .gitlab-ci.yml 都没）
- 若引入，新建 `.github/workflows/ci.yml`

**修复方向**：
- 加 GitHub Actions（或类似）跑 `bun tsc --noEmit && bun test`
- 加 `silent-swallow-audit.sh` 脚本，CI 跑后比对 baseline 行数

**Supervisor 推荐**：**值得做**——但取决于 OOC 是否走 OSS 化路线（公开 CI 才有意义）；当前自用阶段，本地 verification probe（A4）已够

---

## E 段：知识沉淀

### E1. cluster 化方法论沉淀（49→10 收敛过程）

**前因**：Round 7 反向反馈 #5——本次"49 Issue 收敛到 10 根因 + 3 契约"的过程本身是 OOC 工程组织的方法论资产。建议沉淀为正式 doc，作为未来 backlog 收敛的范本。

**位置**：
- 新建 `docs/methodology-cluster-rooting.md`（或类似名）
- 引用：`docs/2026-05-24-experience-rounds.md`、`docs/2026-05-24-fix-plan.md`

**内容大纲建议**：
1. 触发条件：何时启动 cluster 化（backlog > N？跨多个 facet？）
2. 步骤：通读全部 Issue → 找同源 facet（≥ 3 处 same-root）→ 升维到契约层 → 写简化设计
3. 哲学：克制熵增 / 用更少抽象 / 删特殊路径 vs 加补丁
4. 风险：升维太早会模糊问题；升维太晚 backlog 累积
5. 验收：每个 cluster 必有 verification probe（与 A4 联动）

**Supervisor 推荐**：**值得做**（半天活；OOC 哲学第二个具体方法论 doc，方法论价值高）

---

## 决策模板

请对每项填写：**做 / 推迟 / 不做 / 改方向**。

### A 段（全部完成 ✓）
- [x] A1（R7-2 sandbox 例外白名单）: **DONE** commit 5e38691
- [x] A2（R7-3 typebox flatten）: **DONE** commit 5e38691
- [x] A3（R7-4 TreeScope 加 pools）: **DONE** commit 5e38691（含 sidebar tab + /pools route）
- [x] A4（fix-plan verification probe）: **DONE** commit 5e38691（10 根因每个附 probe）

### B 段
- [ ] B1（LLM 真链路浏览器交互）: ___
- [ ] B2（stone+flow client 双层 UI）: ___
- [ ] B3（relation_window 真链路）: ___
- [ ] B4（talk_window 完整生命周期）: ___
- [ ] B5（debug_file 全量协议）: ___

### C 段
- [ ] C1（ui_methods 沙箱 vs 信任）: ___（A / B / 其它）
- [ ] C2（seed knowledge eval gate）: ___（A / B / 其它）
- [ ] C3（Object ≡ repo 升级 v2）: ___（A / B / C / 其它）
- [x] C4（cross-session end notify）: **DONE** commit 54c31447
- [x] C5（ThreadContext creatorSessionId）: **DONE** commit 54c31447

### D 段
- [ ] D1（ESLint no-empty-catch）: ___
- [ ] D2（ESLint service throw）: ___
- [ ] D3（CI 配置）: ___

### E 段
- [x] E1（cluster 化方法论沉淀）: **DONE** commit 1f367c66（docs/methodology-cluster-rooting.md, 218 行）

---

## Round 8 体验官产出（2026-05-25 B 段验证）

5 方向全部跑：

| 方向 | 评分 | 关键发现 |
|---|---|---|
| B1 LLM 真链路浏览器交互 | Good | 跨 thread say delivery 完整、worker 入队 0 漂浮 |
| B2 stone/flow client 双层 UI | Good | client-source-url contract OK；path-traversal 防护已有 |
| B3 relation_window 真链路 | OK | 三路径派生正确；测试 fixture 漂移已修 |
| B4 talk_window 完整生命周期 | Good | open→say→end→close 全 form 链跑通 |
| B5 observable.debug_file 全量协议 | Good（修后） | debug API 旧版用 process.cwd() → 隔离 world 永远 404；已修 |

### Round 8 自动修复（已 commit 在 B 段同一批 commit）

| # | 修复 |
|--|--|
| 1 | runtime debug API 从 ServerConfig.baseDir 注入（R8 B5 严重缺陷） |
| 2 | loop debug error label 4 位 zero-pad 与磁盘文件名对齐 |
| 3 | debug-ui/chat.html 修旧路由 → canonical `/api/flows/:sid/continue` |
| 4 | relation-window test fixture 补 3 个 required path 字段（漂移漏跟） |
| 5 | R8-4 path-traversal 防护：删除 debug API `?baseDir=` query override |

### Round 8 Issue 候选（剩余，未修，需 user 决策）

- [ ] **R8-1**（low）chat.html 用两步法 createSession 而非 canonical seedSession：___
- [x] **R8-2**（trivial）backlog A3 文档勾选已同步：**DONE**（本次更新）
- [ ] **R8-3**（design）Vite dev server 与 backend 分裂——是否在 backend dev 模式嵌入 minimal SSR 让单 process 端到端跑？涉及 visible 维度 dev runtime 协议决策：___
- [x] **R8-4**（medium / security）debug API path-traversal：**DONE**（本次 commit）
- [ ] **R8-5**（low）relation_window not-materialized signal——API response 是否补 `{exists:false}` flag 给 caller 区分 lazy-create vs bug？涉及 contextWindow shape 契约调整：___

---

## Supervisor 综合建议

**最简短期路线**（1-2 天工作量）：
- A1 + A2 + A3 + A4 全做（< 1 turn 各，方法论 + 漂移修复）
- C5（半天，让 R5 完全 clean）
- E1（半天，沉淀方法论）

**中期路线**（1 周）：
- B1（Round 8 LLM 真链路浏览器）
- C1 / C2（必做的设计决策；C3 可暂缓）

**长期路线**：
- D 段（CI / ESLint），等 OOC 工程规模 / OSS 化时机
- C3 Object ≡ repo，等真实需求驱动
