# OOC-3

**Object Oriented Context** — 一种以面向对象哲学组织 LLM 上下文与构建 MultiAgent 系统的 AI Agent 架构。

OOC-3 是 ooc-2 从空 orphan 分支重建的第 3 代实现：把 OOC Agent 与 Context Window 归一为同一个 **OOC Object** 概念。Agent / Window 二分消失；底层都是 Object，沿 prototype 链继承方法与 UI。

---

## ✨ 核心特性

### 1. 概念归一：一切都是 OOC Object

每个 Object 由 4 件组成：
- **identity**: `self.md`（含 `extends:` frontmatter）+ `readme.md`
- **methods**: `server/index.ts` 显式 `{ public, private }` 导出
- **UI**: `client/index.tsx`（可选，缺则原型链 fallback 至 root）
- **runtime state**: 仅在 active flow 内存在（按需 lazy 创建）

"Agent" 与 "ContextWindow" 退化为称谓——前者是被 supervisor 派遣的 persistent Object 角色，后者是 Object 在 LLM context 中的呈现形式。

### 2. 三层持久层 + 1:1 URI 镜像

```
stones/<branch>/objects/<name>/      ← 身份 + 设计（进 git）
pools/objects/<name>/                ← 跨 session 累积产物（不进 git，不分 branch）
flows/<sessionId>/objects/<name>/    ← 单 session 运行时过程（不进 git）
```

`ooc://` URI 1:1 镜像文件系统路径（`ooc://stones/main/objects/supervisor`、`ooc://flows/<s>/objects/<n>`），runtime 与 web 共用同一解析器。

### 3. 四条正交关系轴

| 轴 | 表达载体 | 语义 |
|---|---|---|
| **自我**（super flow） | reflectable | Object 修改自己 |
| **peer**（talk） | `talk(target, content)` | 跨 Object 平等沟通 |
| **parent-child**（修改权） | `children/<sub>/` | 外层 owner 有权改 child |
| **prototype**（继承） | `self.md` `extends:` | 方法/UI 沿链 fallback |

### 4. B 类塌缩：window 概念去除

旧 ooc-2 的 14 个 window 类型按"实体 vs 关系/状态"重新分类：
- **A 类**（实体）→ 8 个内置 prototype Object: root / program / search / file / knowledge / command_exec / skill_index / custom
- **B 类**（关系/状态/过程）→ 塌缩为 owner Object 的字段:
  - `talks/<peer>.jsonl` ← `talk_window`
  - `threads/<thread_id>/` ← `do_window`
  - `todos.json` ← `todo_window`
  - `plan.md` ← `plan_window`
  - `children/` + relation 切片 ← `relation_window`

### 5. 方法 public/private 显式声明

```ts
export default defineObject({
  public: { talk, do_, todo_add, plan_set, grep, glob, open_file, write_file, exec_command, metaprog, memory_record, ... },
  private: { _internal_helper },
});
```

- public 方法进入 LLM context surface，可被 LLM 调用、可被跨 Object 调用
- private 方法仅同 Object server 内部 + sub-thread 共享 owner 身份时可调用

### 6. defaultContext 自动注入

每轮 LLM 调用前 root 原型 `defaultContext()` 实时拼装：
- **plan**：当前 thread 引导文本（顶置）
- **todos**：未完成项
- **threads**：active sub-threads
- **talks**：最近 N 条对话摘要（每 peer 折叠）
- **relations**：siblings + children URI 列表
- **pool_memory**：跨 session 长期记忆（`pools/objects/<self>/knowledge/memory/*.md`）

LLM 不需要显式调用工具就能感知自身状态。

---

## 🚀 当前能力

### Code-agent 基本能力（已验证）

| 能力 | 实装 | 真 LLM e2e |
|---|---|---|
| 跨 Object talk 直投 | ✅ flow 层 talks/<peer>.jsonl 双端 append | ✅ |
| LLM thinkloop with tool dispatch | ✅ `function_call` + `function_call_output` 原生协议 | ✅ |
| 任务规划 plan + todo | ✅ plan_set / todo_add / check / uncheck / remove / list | ✅ |
| 代码搜索 grep / glob | ✅ bounded fs walk + 正则 | ✅ |
| 文件读写 open_file / write_file | ✅ worldRoot 沙箱 | ✅ |
| 命令执行 exec_command | ✅ Bun.spawn + cwd 沙箱 + 60s timeout | ✅ |
| 元编程 metaprog | ✅ 读自身 stone file + write_file 沙箱化 stone 路径 | ✅ |
| 跨 session 长期记忆 | ✅ memory_record + defaultContext pool 切片 | ✅ |
| 长输出（4096 tokens） | ✅ 默认 maxTokens=4096，sliding window 50+ 消息 | ✅ |
| 并发 session | ✅ Worker.runUntilThread 只等单个 thread | ✅ |
| Session 持久化 | ✅ thread.json + flows/ 跨重启恢复 | ✅ |
| end() 终止 thread | ✅ `__ooc_thread_action: "end"` sentinel | ✅ |

### 9-Round Harness 验证

通过 9 轮 体验官 → AgentOfX → 体验官 迭代收敛：

| 轮次 | 工作 | Score |
|---|---|---|
| R1-3 | 找出 22 个 issues（含根因 tool protocol bug） | 28/100 |
| R4 | 修 `LlmInputItem[]` 协议、`end()` sentinel、并发反阻塞、`defaultContext` 注入 | — |
| R5 | 22/22 issues PASS，tick 12→2-4，session 跨重启稳 | 88/100 |
| R6 | 收尾 #23/#24 → bun run verify 全绿 | 95/100 |
| R7 | 4 维度盘点：metaprog skeleton + sediment missing + 1024-token 截断 | 58/100 |
| R8 | 修 memory pipeline + maxTokens + metaprog minimal | — |
| R9 | 跨 session 3-fact 召回 ✅ / 499-word essay ✅ / 真 self-modify readme.md ✅ | **94/100** |

### 4 能力维度收敛（Round 9 最终评分）

| 维度 | 能力 | 分数 | 关键证据 |
|---|---|---|---|
| 元编程 | metaprog + stone write | **22/25** | thread `t_0ab91717`: metaprog→write_file→talk→end 4-tick 链路，readme.md 真追加 |
| 任务规划 | plan + todo + 多步分解 | **25/25** | 单 tick parallel 调用 5 tools，plan.md + todos.json 同步落地 |
| 长任务 | maxTokens + sliding window | **23/25** | 499-word essay 完整返回（旧 1024-token 截断），50+ 消息 sliding window |
| 经验沉淀 | memory_record + pool_memory 注入 | **24/25** | Session 2 fresh 召回 3 个 Session 1 fact：Alice + Python + March 15 |
| **Total** | | **94/100** | |

---

## 📐 架构

### 后端（Bun + Elysia + TypeScript）

```
src/
├── persistable/                    ← stone/pool/flow 三层 + ObjectRecord + URI 解析
├── thinkable/                      ← LLM transport + thinkloop + worker
│   ├── llm/                        ← claude + openai providers
│   ├── thinkloop.ts                ← single-thread one-cycle 推进
│   └── worker.ts                   ← session-scoped 调度
├── executable/                     ← loader + registry + prototype-resolver + dispatcher
├── observable/                     ← debug 落盘
└── app/server/                     ← Elysia HTTP control plane + CLI 入口
    ├── http.ts                     ← 14 REST endpoints
    ├── index.ts                    ← bun src/app/server/index.ts --world ...
    └── bootstrap/                  ← supervisor/user seed + 配置
```

### 前端（Vite + React + react-router）

```
web/src/
├── AppShell.tsx                    ← 3-tab nav 顶层布局
├── api.ts                          ← typed API client
└── views/
    ├── SessionsView.tsx            ← 列表 + 创建
    ├── SessionDetailView.tsx       ← 单 session objects
    ├── SessionObjectView.tsx       ← 聊天面板（chat composer + thread polling）
    ├── StonesListView.tsx          ← stone grid
    ├── StoneDetailView.tsx         ← self.md/readme.md/server-source + call-method
    └── FilesView.tsx               ← file tree + viewer
```

### HTTP API（14 endpoints）

```
GET  /api/health                                    健康检查
GET  /api/world                                     world 配置
GET  /api/sessions                                  列出 sessions
POST /api/sessions                                  创建 session
GET  /api/sessions/:id                              session 详情
POST /api/sessions/:id/invoke                       method 调用
GET  /api/threads/:threadId                         thread 状态
POST /api/talk                                      触发 talk（核心入口）
GET  /api/stones?branch=main                        列出 stones
GET  /api/stones/:branch/:name                      stone 元数据
GET  /api/stones/:branch/:name/{self,readme,server-source}
POST /api/stones/:branch/:name/call-method          直调 method
GET  /api/flows/:sessionId/objects                  flow 对象列表
GET  /api/flows/:sessionId/objects/:name            flow 对象详情
GET  /api/flows/:sessionId/objects/:name/threads/:threadId
GET  /api/tree?path=                                文件树
GET  /api/file/read?path=                           读文件
GET  /api/objects/:scope/:name/client-source-url    动态 client 加载
```

---

## 🚀 启动 / Dev Workflow

### Backend only

```bash
# 默认 port 3000, world ./.ooc-world
bun run server

# 自定义
bun src/app/server/index.ts --world ./.ooc-world --port 3000 --stones-branch main
```

启动时会自动 seed `supervisor` + `user` 两个 persistent stones（幂等）+ 加载 8 个 builtin prototypes + 9 个 AgentOfX stones。

### Backend + Frontend（全栈）

```bash
bash scripts/dev-start.sh
# UI:  http://localhost:5173
# API: http://localhost:3000/api/health
```

### 真 LLM 集成

`.env`:
```
OOC_API_KEY=<key>
OOC_BASE_URL=https://api.anthropic.com  # or proxy
OOC_MODEL=claude-haiku-4-5
OOC_PROVIDER=claude
```

第一次 talk 试试：

```bash
SID=$(curl -s -X POST http://localhost:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"objectUri":"ooc://stones/main/objects/supervisor"}' \
  | bun -e "console.log(JSON.parse(await Bun.stdin.text()).sessionId)")

curl -s -X POST http://localhost:3000/api/talk \
  -H 'content-type: application/json' \
  -d "{\"target\":\"ooc://stones/main/objects/supervisor\",\"content\":\"Hi, what tools do you have?\",\"sessionId\":\"$SID\"}"
```

### 测试

```bash
bun test                                   # 338+ unit tests
bun run verify                             # tsc + tests + silent-swallow + deprecated 全 gate
bun run test:e2e:backend                   # 真 LLM e2e（需 API key）
```

---

## 🎭 Harness 组织

9 个 AgentOfX stones 已落 `stones/main/objects/`：

- `agent_of_thinkable` / `agent_of_executable` / `agent_of_collaborable` / `agent_of_observable`
- `agent_of_persistable` / `agent_of_reflectable` / `agent_of_programmable` / `agent_of_visible`
- `agent_of_experience`（体验官）

每个 AgentOfX 是 `extends: root` 的 persistent Object，作为对应能力维度的 owner 角色。Supervisor（world 级 root parent）协调他们。

体验官 → AgentOfX → 体验官 闭环已在 R1-R9 跑过 9 轮，是这次 41-commit 重建的迭代驱动。

---

## 📄 文档

| 文件 | 内容 |
|---|---|
| `meta/object.doc.ts` | OOC 概念权威：4 关系轴 / 三层 / 8 维度 / b_class_collapse |
| `meta/app.server.doc.ts` | HTTP 控制面 + loader + worker + 14 路由 |
| `meta/app.client.doc.ts` | Web 控制面 + ObjectClientRenderer + 原型链 fallback |
| `meta/engineering.harness.doc.ts` | 1 Supervisor + 9 AgentOfX 组织结构 |
| `meta/engineering.testing.doc.ts` | 三档评分 + 双观察孔 + 7 gate |
| `meta/cookbook.author-ooc-object.doc.ts` | 5 步教学：选 prototype → self.md → server → client → 验证 |
| `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` | spec V2 完整设计 |
| `docs/superpowers/plans/*.md` | P0-P10 实施 plans |

---

## 🔭 仍在演进的（增强项，非阻塞）

- `stone-versioning.ts` git worktree 真 wiring（programmable 元编程进阶：让 LLM 通过 git branch 协议改 server/index.ts）
- Memory pool TTL / prune（防 sediment 无限增长）
- ObjectClientRenderer 动态 client/index.tsx 加载（当前 fallback 已够）
- 调试 loop viewer + pause/permission UI
- 9 个 AgentOfX 各自的 server/index.ts 自定义方法（当前都继承 root）

---

## 🤝 与 ooc-2 的关系

`ooc-3` 是从空 orphan 分支起步的 from-scratch **重建**，不是 ooc-2 的 refactor。

- ooc-2 保留为 legacy reference
- ooc-3 走全新设计：归一 Object 概念、prototype 链、function_call 原生协议
- 后续工作切到 `ooc-3` 分支为新主线

---

**41 commits on origin/ooc-3 · 95/100 平时分 + 94/100 4维度分 · 4 real-LLM e2e + 338 unit tests PASS · bun run verify 全绿**
