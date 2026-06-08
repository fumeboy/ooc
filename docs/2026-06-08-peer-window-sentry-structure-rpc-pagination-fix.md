# Peer Window + Sentry Stone 结构 + RPC 分页修复复盘（2026-06-08 会话）

> 动因：session `web-1780909890825`（query: "因子组 8029 是什么"）失败。sentry 主线程因 27MB 工具输出触发上游 `413 Request Entity Too Large` 挂死，
> Supervisor 永远 waiting。三层根因：① peer window 渲染但不可 exec → LLM 被诱导走不通路径；
> ② sentry stone 对象有 `src/` 后门 → LLM 绕过 ObjectMethod 直接裸 import RPC helper；
> ③ `factor-group-search` 在 `rpc_call` 和 helper 两层均缺分页默认值 → 返回 10,204 条因子组共 16.4MB →
> 工具输出 27.2MB → 下一轮 LLM 请求 56.6MB → 413。同时 sentry 子线程 glom 到暴露的
> `src/factor-group-search.ts`，跑 10 轮后撞 LLM 120s timeout。
>
> 修复横跨 P0（peer window 架构）/P1（sentry stone 结构标准化）/P2（全链路分页默认 + 响应截断）三个档位。

## 1. 一句话结论

一次修复把 OOC 的三条隐性契约破口补齐：
**peer Object 必须是 first-class exec-able window**（不是只展示的身份卡）、
**stone 对象只暴露 ObjectMethod 不暴露 raw 脚本**（对齐 builtins/file 模式，无 `src/` 后门）、
**所有搜索/列表 RPC 至少两层分页防护 + 一层响应截断**（从源头防御 413）。
修复后原失败链路在每一跳都有安全闸。

## 2. 根因三级复盘

### Level 1: 渲染-执行契约破口（直接触发失败的一环）

`XmlRenderer` 把 peer（如 `sentry/factor`）渲染为带
`<commands hint="open(parent_window_id='sentry/factor', ...)">` 的可操作窗口，
但 peer window 从未被放入 `thread.contextWindows`。`exec` → `WindowManager.fromThread`
只读 `contextWindows` → `requireParent("sentry/factor")` 永远报
`window "sentry/factor" not found`。LLM 首轮尝试 `exec(window_id="sentry/factor", command="group_search")` 失败后，
退化为 `sentry rpc_call` 裸 payload，直接撞 Level 3 的 payload 爆炸。

**设计漂移溯源**：`meta/object.doc.ts` 原语义是"Agent 一上场就看见身边同级和 children"——
但"看见"在某次迭代被窄化为只进 transient 的 `thread._renderedWindows`（observability mirror），
从未持久化到可 exec 的 `contextWindows`。渲染和执行两条路径契约脱钩。

### Level 2: Stone 对象结构偏离 builtin 参考实现

`packages/@ooc/builtins/file` 的模式是：所有方法实现内联在 `executable/index.ts`（纯函数
/ 渲染辅助以 sibling 文件存在，但没有独立 `src/` 子目录）。sentry 的 4 个子对象
（factor/event/strategy/lineage）都有 `src/` 子目录放 RPC helper，LLM 可通过
`glob **/factor/**/*.ts` → `program(ts, code="import { factorGroupSearch } from '...'")`
绕过 ObjectMethod 层——所有在 ObjectMethod 层写的分页默认、错误处理、UI 方法双导出契约
全部失效。sentry 子线程正是这样 glom 到 `src/factor-group-search.ts` 跑了 10 轮空转。

### Level 3: 全链路缺分页默认值 + 缺响应体大小上限

两条链路都没有安全闸：
- `sentry rpc_call`（`sentry/executable/index.ts`）：`payload` 直透传，不注入任何默认值。
  LLM 传 `{"keyword":"8029"}` → 后端返回 **10,204 个因子组、16.4MB 原始 JSON** →
  tool 事件膨胀到 27.2MB → 下一轮 LLM 请求 56.6MB → 413。
- `src/factor-group-search.ts:factorGroupSearch` 自身只有 `offlineSyncType: 1` 默认，
  没有 `pageSize/pageNum`。讽刺的是 ObjectMethod `group_search` 已写了 `page_size:20, page_num:1`
  默认——说明团队知道要分页，但只在上层做了保护，下层裸 helper 没保护。

## 3. 修复清单

### P0: Peer window 作为真实可 exec 的 contextWindow（4 文件核心 + 3 生产调用点）

**设计**：peer window 的注入从"仅渲染期派生"改为"初始化注入 + 每轮渲染 reconcile 补齐"双保险，
写入 `thread.contextWindows`，id 与 type 都等于 peer objectId（天然稳定）。

| 文件 | 改动 |
|---|---|
| `packages/@ooc/core/executable/windows/_shared/init.ts` | 新增 `injectPeerWindowsIfObjectThread(thread)`：调 `discoverStoneHierarchicalPeers` 拿 sibling + level-1 children，幂等写入 `contextWindows`（形状 `{id, type, parentWindowId="root", status="open", title}`）。IO 失败静默吞掉（debug log），不阻塞 thread 启动。 |
| `packages/@ooc/core/thinkable/context/index.ts` | 新增 `reconcilePeerWindowsIntoContext(thread, snapshot.windows)`：每轮 `pipeline.run()` 返回后，把 snapshot 中 peer-style window（`id===type` 且非 builtin window type）差集补进 `contextWindows`。覆盖 mid-session 动态新增 child 的极端情况。 |
| `executable/windows/talk/delivery.ts` + `persistable/thread-json.ts` + `app/server/modules/flows/service.ts` | 三个生产 thread 创建/恢复点，在 `initContextWindows` 后加 `await injectPeerWindowsIfObjectThread(thread)`。冷恢复也能拿到 peer windows。 |
| `executable/windows/index.ts` | 把 `injectPeerWindowsIfObjectThread` 加到 barrel re-export。 |
| `packages/@ooc/meta/object.doc.ts` | 四段修文：① `window_types` 补充 relation→peer 的语义 + peer 是 first-class contextWindow；② `relation_window` 节新增"持久化语义"子节区分新旧机制；③ `parent_child_hierarchy` 把"relation_window 每轮派生"改写为 peer Object first-class window（readable + commands + relation auto-activated）；④ `object_relations` patch 把 peer 轴从"talk/do/relation_window"改为"talk/exec——同 stone 同步 exec，跨 session 异步 talk"。 |

**不做**：knowledge/guidance/form-scoped 等派生 window 仍不进 contextWindows——那些是每轮重算的，
peer 是稳定 stone 对象，属于另一类。

### P1: Sentry stone 结构标准化（消除 `src/` 后门）

**原则**：对齐 `packages/@ooc/builtins/file` 模式——RPC helper、接口、endpoint 常量、渲染辅助
全部**内联**进 `executable/index.ts`，helper 全部 module-private（不 export），
对外可见接口只剩 `export const window` + `export const ui_methods`。删除整个 `src/` 目录。

| 对象 | 内联文件数 | 删除的 src 内容 |
|---|---|---|
| `sentry/children/factor` | 3（`factor-group-search.ts` / `event-factor-list.ts` / `event-factor-detail.ts`） | 接口 + endpoint + 3 个 RPC helper |
| `sentry/children/event` | 2（`search-event-snapshot.ts` / `snapshot-detail.ts`） | 接口 + 2 个双传输 RPC helper |
| `sentry/children/strategy` | 6（`types.ts` / `strategy-renderer.ts` / `run-detail.ts` / `strategy-detail.ts` / `strategy-fusion-detail.ts` / `template-action-usage.ts`） | 全部类型 + 渲染辅助 + 4 个 RPC helper |
| `sentry/children/lineage` | 3（`evaluate.ts` / `list-vertex.ts` / `release-gray.ts`） | 血缘图遍历 + 评估查询 + 灰度查询全套 helper |

同时每个对象的 `knowledge/<name>.md`：
- **删除** "脚本程序"表格（原指向 `src/*.ts` 相对路径，路径已失效）。
- **新增** "Object commands"表格，列出 command 名、用途、默认分页——引导 LLM 走 `exec`。
- **新增** "约束与注意事项"中的分页安全 + 响应截断说明。

结果：`grep -rn "from.*sentry/children/.*/src/"` 0 命中；`find sentry/children -name src -type d` 0 命中。

### P2: 全链路分页默认值 + 响应体大小截断

三层防御，每层独立生效：

**A. 底层 RPC helper 默认值（覆盖直接 import 的人）**
在每个子对象内联的 helper 函数里，请求参数展开前注入分页默认：
- `factorGroupSearch` → `{pageNum:1, pageSize:50, offlineSyncType:1, ...request}`
- `eventFactorList` / `searchEventSnapshot` / `searchEventSnapshotByEcop` → `{page:1, size:50, ...request}`
- `templateActionUsage` → `pageSize` capped 500 即使调用方要求更大
- `queryEvaluateTasks` 已自带 `pageSize:10`（保留）

**B. 通用 `rpc_call` 默认值注入（覆盖 LLM 绕 ObjectMethod 走 raw RPC 的情形）**
- `packages/sentry-core/src/types.ts`：`RpcEndpoint` 扩展可选 `defaultParams?: Record<string, unknown>`。
- `packages/sentry-core/src/rpc-registry.ts`：
  - 所有 15 个列表/搜索 endpoint（`event-search`, `factor-group-search`, `search-event-snapshot`,
    `strategy-pack-search`, `operation-log-list`, `rg-queue-search` 等）全部补 `defaultParams`。
    单条查询（detail/snapshot-detail 等）不强制分页。
  - `applyDefaultParams(endpoint, body)`：body 如果能 parse 为 JSON object，`{...defaultParams, ...parsed}`
    merge（用户显式参数优先覆盖）。
  - `callRegisteredEndpointRaw` 在此层完成 defaultParams merge + truncateResult 响应截断。

**C. 响应体截断（最后一道防线——即使分页也防单条记录过大）**
新增 `packages/sentry-core/src/truncate-result.ts`：
1. 若 `length ≤ 200KB` 原样返回。
2. 否则先尝试 JSON parse，对 `items/rows/records/list/groups/data/ItemList/tasks/edges/vertices`
   等常见数组字段切片到 100 条，保留结构 metadata（total/Base 等），附加 `_truncated: true` +
   `_originalLength` + `_hint` 元信息，再序列化。
3. 解析失败或智能截断后仍超限 → 原始字符串切片 + 机器可读 `[truncated]` 后缀。

所有 5 个 sentry 对象（root + 4 子）的每个 ObjectMethod.exec 返回值都套 `truncateResult(...)`。

**顺手修掉的 bug**：sentry root 的 `rpcCallMethod` 之前对 `callRegisteredEndpointRaw`（本身返回 JSON string）
再做一次 `JSON.stringify(resp, null, 2)`——等于把字符串又包了一层引号。修复为直接透传响应。

## 4. AgentOfX 维度重新评估

| 维度 | 修复前缺口 | 修复后 | 下一阶段演进 |
|---|---|---|---|
| **Thinkable** | peer 渲染但不可 exec，LLM 被 XML 诱导走死路；27MB 工具输出炸 context | peer 真实进 context，exec 通；截断从源头防爆炸 | protocol knowledge 补"同级/children peer 默认已在 context，直接 `exec(window_id=objectId, command=...)`，无需 talk" |
| **Executable** | stone 对象有 `src/` 后门；rpc_call 无默认值/截断 | 4 个子对象对齐 builtins/file；rpc_call 加 defaultParams + truncate | 写 stone-validation linter（Supervisor/Programmable 自检 command），CI 扫 `src/` 后门和裸 RPC helper import |
| **Observable** | `_renderedWindows` vs `contextWindows` 语义割裂；windowsSnapshot 只存 rendered | reconcile 后 peer 同时在两边，观察与执行看同一窗口集 | `finishLlmLoop` 的 windowsSnapshot 可改用 `contextWindows ∪ derivedNonPeer`，不再需独立维护 `_renderedWindows` |
| **Persistable** | peer 不持久化，冷恢复首轮 exec 仍找不到 peer | init-time 注入 + per-round reconcile；thread.json 冷恢复路径已调 peer injector | 若后续支持 peer 动态增删 event-sourcing 回放，reconcile 层加删除清理 |
| **Collaborable** | peer 只能 talk，链路 3 跳；exec 路径被破坏实际只剩 talk | peer 作为 first-class contextWindow，默认可直接 exec；talk 只用于跨 session/异步 | **重写边界定义**：同 stone 层级 peer = 直接 exec 对象方法；跨 session / 需持久会话的 peer = talk_window。talk 创建 callee 时默认不反向注入 self 的所有 peer |
| **Reflectable** | 响应爆炸、exec 失败无沉淀 | 截断响应带 `[truncated]` meta，可作信号源 | super flow 统计各 endpoint 截断率/payload 分布，自动调优 defaultParams.pageSize |
| **Programmable** | cookbook 若举 `src/` 例子会误导；stone 结构无校验 | 4 个实际 stone 已修正，有了真实参考 | **必须更新 `meta/cookbook.add-new-agent.doc.ts`**：明确 `executable/index.ts` 内联所有方法实现，禁止 `src/` 子目录；把 sentry/* 四对象作为合规样本链接 |
| **Visible** | 无实质影响 | peer id 稳定 = objectId，UI 跨轮位置不变 | 前端 ObjectClientRenderer 可把 peer window 渲染为带 command palette 的 sidebar 快捷入口；peer 真实进 contextWindows 后 frontend 可直接读 registry 拿 command schema |

## 5. Supervisor 行为语义变化（本次修复最大的架构影响）

修复前调 sentry/factor：

```
user → supervisor talk(target="sentry") → sentry talk(target="sentry/factor") → factor exec
```

3 跳，中间每个 talk 都要创建新 session/thread/job。

修复后：

```
user → supervisor exec(window_id="sentry/factor", command="group_search", args={...})
```

1 跳，同 session，直接返回结果。

**这要求 Supervisor 的 self.md / protocol knowledge 重写协作直觉**：
- 「我身边的 peer（sentry, sentry/factor, sentry/event 等）默认已经在我的 context 里打开，
  是我可以直接调用的对象，不是需要发消息的远方同事。」
- 「只有需要对方独立思考 / 跨 session 异步处理时，才用 talk。」
- 「跨 stone / 跨 world 的对象（不在我的 stone 层级树上）仍然必须走 talk。」

## 6. 验证

| 验证项 | 结果 | 备注 |
|---|---|---|
| 全量 TypeScript（core） | 0 errors on changed files | `packages/@ooc/core` 全量 tsc --noEmit |
| 全量 TypeScript（sentry-world） | 0 errors on changed files | `.ooc-world-sentry` 全量 tsc --noEmit |
| Core context 单测 | 26 pass / 0 fail | `bun test --test-name-pattern context` |
| Storybook Tier A（control-plane） | 9 fail, 但**全部为 pre-existing 环境问题** | `git 2.20.1` 不支持 `git init --bare -b <branch>`（2.28+ 才加），与本次改动无关 |
| src/ 后门残留扫描 | 0 hit | `find -name src -type d` under sentry children |
| 旧 src 路径残留 import 扫描 | 0 hit | `grep -rn "from.*sentry/children/.*/src/"` |

## 7. 未完成 / 待办

1. **`meta/cookbook.add-new-agent.doc.ts` 结构示例更新**（P2）：明确禁止 `src/`，
   加 sentry/factor 作为合规 stone 样本链接。本会话未做——改动只在本 repo 的
   meta 文档，属于下一轮的 meta 维护项。
2. **Stone-validation linter / CI gate**（P3）：扫描 stone 对象是否存在
   `src/` 或直接 import RPC helper 的路径。可作为 Supervisor 自检 command。
3. **Supervisor self.md / protocol knowledge 更新**（P1）：把"同 stone peer 默认可直接 exec"
   写进 Supervisor 的身份文档和 protocol knowledge，是本次修复后最大的语义变化，
   不写进去等于只修了代码没修 Agent 行为。
4. **Storybook collaborable story 新增 "peer exec 首轮可用" control-plane 用例**（P3）：
   创建带 children 的 stone，验证 parent thread 首轮就能 `exec(window_id="parent/child_a", command="...")`
   不报错。本会话没加——storybook 受 git 2.20 环境问题阻塞，先解环境再补用例。
5. **Truncation 指标沉淀到 super/memory**（P4）：reflectable 维度的自动调优。
