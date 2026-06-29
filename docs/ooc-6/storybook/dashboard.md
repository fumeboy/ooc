# Storybook 覆盖矩阵 / dashboard

> 本文件由 issue 2026-06-29-f5-storybook-survey landed 时重写,反映 2026-06-29 真实状态。
> 2026-06-29 晚: S 系列 10 issue 全 landed + A 系列 web build 通后再次更新覆盖矩阵。

## 设计 vs 现实

**`docs/ooc-6/storybook/framework-design.md` 等设计文档描述的 `packages/@ooc/storybook/`
框架在代码侧不存在**——`stories/*.story.ts` / `_harness/control-plane.ts` / `runner.ts`
全是规划,未落地。

**实际承担 storybook 角色的是 `packages/@ooc/tests/`**(33 个 `.test.ts`、177 cases)。
2026-06-29 后 OOC 走「就地升级 tests/ 为 storybook」路径,不另造 storybook 包(避免双轨)。

- **Phase A**(已落): 覆盖矩阵 / tests/README.md 约定
- **Phase B**: env-gated Tier B agent-native runner(`packages/@ooc/storybook/agent-native/`) — 留 follow-up
- **Phase C**: dashboard 自动化(scripts/storybook-dashboard.ts) — 留 follow-up
- **Phase D**: stories-outline L0-L<n> 标签贴到现 tests — 留 follow-up

## Tier A 覆盖矩阵(2026-06-29,177 cases / 0 fail)

按 **8 维度** + 横切模块分组(lifecycle 维度 = 2026-06-28 issue 引入,object base 4→5)。

### object base 维度(5)

| 维度 | tests 文件 | cases | 锚 issue / 设计元素 |
|---|---|---:|---|
| **readable** | thread-readable-views | 11 | issue I(thread 三视角) |
| | render-readable | 4 | issue E(单入口 renderReadable) |
| | registry-window-default | 8 | issue B(default window decl 约定) |
| | window-view-issueJ | 12 | issue J(OocObjectRef.window_view) |
| **executable** | dispatch-guide-form | 4 | issue A(guide method) |
| | dispatch-view-surface-gate | 5 | issue M(dispatch 闸 surface 守门) |
| | registry-method-guide | 6 | issue A(method/guide name cohesion) |
| | thread-window-method-dispatch | 3 | window method 派发 |
| | tools-open | 3 | issue E(open tool 原语) |
| **visible** | s2-visible-server-call-method | **5** | issue S2(callMethod 仅 flow scope, thread builtin 首批实装) |
| **persistable** | persistence | 1 | persistable 基础 |
| | persistable-versioned-fields | 6 | issue C(字段级版本化) |
| | stone-hydration | 1 | hydrate 顺序 |
| | flow-scan | 3 | issue D/F(flow 扫描) |
| | s1-file-edit-primitive | **10** | issue S1(file-edit/read 原语 + 三层防护) |
| **lifecycle** | refcount-gc | 5 | issue E(refcount + GC + dispatchUnactive 幂等) |
| | lifecycle-on-reload | 6 | issue 2026-06-28(on_reload 派发) |
| | server-lifecycle-integration | 3 | issue F1(生产 server 集成) |

### agent 智能增量维度(3)

| 维度 | tests 文件 | cases | 锚 issue / 设计元素 |
|---|---|---:|---|
| **thinkable** | thinkloop-e2e | 5 | thinkloop 一轮 e2e |
| | knowledge-activator | 9 | issue N(intent 激活下沉 knowledge_base) |
| **collaborable** | thread-scheduling | 6 | issue G(跨 session 调度) |
| | s5-user-root-thread | **6** | issue S5(user.root thread skip_scheduling) |
| | s6-thread-detail-list | **4** | issue S6(thread detail + list per session) |
| **reflectable** | reflectable | 3 | reflectable 基础 |
| | reflectable-redesign-issue-d | 12 | issue D(super flow as dispatcher) |
| | pr-deliver | 1 | PR 投递 |

### 横切模块 / 内置对象 / app

| 模块 | tests 文件 | cases | 锚 issue / 设计元素 |
|---|---|---:|---|
| ObjectRegistry | registry | 5 | object 注册 + resolve* |
| ThreadRuntime | thread-runtime | 5 | thread 私有 runtime facade |
| app server | app-server | 3 | health + runtime endpoint (legacy) |
| **app server S 系列** | s3-s4-s8-server-modules | **10** | issue S3+S4+S8(stones list/create + flows pause/resume + world-config + global-pause/debug) |
| | s7-s9-job-loop-debug | **8** | issue S7+S9(job-manager + loop debug 落盘+读) |
| extendable(飞书) | feishu | 2 | 飞书 stub |
| web build | web-e2e | 2 | vite build + http loop (A 系列 build 真通) |

## 维度覆盖摘要

| 维度 | tests files | cases | 状态 |
|---|---:|---:|---|
| readable | 4 | 35 | ✅ 高覆盖 |
| executable | 5 | 21 | ✅ 高覆盖 |
| visible | **1** | **5** | ✅ S2 落地 (thread visible/server) |
| persistable | **5** | **21** | ✅ 高覆盖 (S1 文件原语 +10) |
| **lifecycle** | 3 | 14 | ✅ 新维度覆盖 |
| thinkable | 2 | 14 | ✅ 覆盖 |
| collaborable | **3** | **16** | ✅ 提升 (S5+S6 加入) |
| reflectable | 3 | 16 | ✅ 覆盖 |
| 横切 / builtin / app | **7** | **35** | ✅ S 系列 server module 全 |
| **合计** | **33** | **177** | 0 fail / 6 个 check gate 全绿 |

## CI Gate

`bun run verify`(parent repo)= storybook Tier A CI gate:
- `bun run check:tsc`(tsc 干净, baseline 0 错误)
- `bun test packages/@ooc/tests/`(177 cases)
- `bun run check:silent-swallow`
- `bun run check:deprecated-symbols`
- `bun run check:doc-drift`
- `bun run check:anchor-drift`

## 缺口与待补

1. **visible 仍 1 文件覆盖**: 仅 thread 实装 visible/server,其他 builtin (todo/plan/skill_index/...) 待 follow-up issue 各自加 for-ui method + tests。
2. **collaborable 仍缺 say/reply/talk 深度**:cross-object talk 端到端跑通 (S5 已通 user-side, agent-side say/reply 待覆盖)。
3. **observable 维度无独立 test**:debug 落盘已实(loop-debug),需独立 observable test 验 thread 状态快照 / log-aggregator 等。
4. **Tier B agent-native 0 覆盖**: F5 Phase B 待做(真 LLM 端到端)。
5. **dashboard 自动化**: Phase C 待做(本表手写, 维护成本高)。

## 历史

- 2026-06-29 (晚): 更新 177 cases / 33 files,S 系列 10 issue + A 系列 web build 覆盖回流。
- 2026-06-29 (早): 重写 dashboard, 反映 134 cases / 8 维度真实状态; 标识 framework 不独立化路径。
- (之前): 9 特性 / programmable 等命名快照, 已与设计权威脱节。
