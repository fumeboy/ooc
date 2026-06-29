# Storybook 覆盖矩阵 / dashboard

> 本文件由 issue 2026-06-29-f5-storybook-survey landed 时重写,反映 2026-06-29 真实状态。
> 历史快照(9 特性 / programmable 等已退役命名)已过期,本表替代。

## 设计 vs 现实

**`docs/ooc-6/storybook/framework-design.md` 等设计文档描述的 `packages/@ooc/storybook/`
框架在代码侧不存在**——`stories/*.story.ts` / `_harness/control-plane.ts` / `runner.ts`
全是规划,未落地。

**实际承担 storybook 角色的是 `packages/@ooc/tests/`**(27 个 `.test.ts`、134 cases)。
2026-06-29 后 OOC 走「就地升级 tests/ 为 storybook」路径,不另造 storybook 包(避免双轨)。
后续 follow-up issue 将做:

- **Phase A**(本表): 覆盖矩阵 / tests/README.md 约定
- **Phase B**: env-gated Tier B agent-native runner(`packages/@ooc/storybook/agent-native/`)
- **Phase C**: dashboard 自动化(scripts/storybook-dashboard.ts)
- **Phase D**: stories-outline L0-L<n> 标签贴到现 tests

## Tier A 覆盖矩阵(2026-06-29,134 cases / 0 fail)

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
| **visible** | _(范例未落地)_ | 0 | F3 待做 |
| **persistable** | persistence | 1 | persistable 基础 |
| | persistable-versioned-fields | 6 | issue C(字段级版本化) |
| | stone-hydration | 1 | hydrate 顺序 |
| | flow-scan | 3 | issue D/F(flow 扫描) |
| **lifecycle** | refcount-gc | 5 | issue E(refcount + GC + dispatchUnactive 幂等) |
| | lifecycle-on-reload | 6 | issue 2026-06-28(on_reload 派发) |
| | server-lifecycle-integration | 3 | issue F1(生产 server 集成) |

### agent 智能增量维度(3)

| 维度 | tests 文件 | cases | 锚 issue / 设计元素 |
|---|---|---:|---|
| **thinkable** | thinkloop-e2e | 5 | thinkloop 一轮 e2e |
| | knowledge-activator | 9 | issue N(intent 激活下沉 knowledge_base) |
| **collaborable** | thread-scheduling | 6 | issue G(跨 session 调度) |
| **reflectable** | reflectable | 3 | reflectable 基础 |
| | reflectable-redesign-issue-d | 12 | issue D(super flow as dispatcher) |
| | pr-deliver | 1 | PR 投递 |

### 横切模块 / 内置对象

| 模块 | tests 文件 | cases | 锚 issue / 设计元素 |
|---|---|---:|---|
| ObjectRegistry | registry | 5 | object 注册 + resolve* |
| ThreadRuntime | thread-runtime | 5 | thread 私有 runtime facade |
| app server | app-server | 3 | health + runtime endpoint |
| extendable(飞书) | feishu | 2 | 飞书 stub |
| web build | web-e2e | 2 | vite build + http loop |

## 维度覆盖摘要

| 维度 | tests files | cases | 状态 |
|---|---:|---:|---|
| readable | 4 | 35 | ✅ 高覆盖 |
| executable | 5 | 21 | ✅ 高覆盖 |
| visible | 0 | 0 | ❌ **未落地**(F3 待做) |
| persistable | 4 | 11 | ✅ 覆盖 |
| **lifecycle** | **3** | **14** | ✅ 新维度覆盖 |
| thinkable | 2 | 14 | ✅ 覆盖 |
| collaborable | 1 | 6 | ⚠️ 仅 thread 调度,缺更多 |
| reflectable | 3 | 16 | ✅ 覆盖 |
| 横切 / builtin | 5 | 17 | — |
| **合计** | **27** | **134** | 0 fail / 6 个 check gate 全绿 |

## CI Gate

`bun run verify`(parent repo)= storybook Tier A CI gate:
- `bun run check:tsc`(tsc 干净)
- `bun test packages/@ooc/tests/`(134 cases)
- `bun run check:silent-swallow`
- `bun run check:deprecated-symbols`
- `bun run check:doc-drift`
- `bun run check:anchor-drift`

## 缺口与待补

1. **visible 维度 0 覆盖**: F3 issue 落地时补 visible/server 调用 e2e。
2. **collaborable 仅 1 文件**: 跨 thread 协作场景(say/reply/talk)需要更深 case。
3. **observable 维度无独立 test**: 当前 web-e2e 间接覆盖, 缺独立 observable test。
4. **Tier B agent-native 0 覆盖**: F5 Phase B 待做。
5. **dashboard 自动化**: Phase C 待做(本表手写, 维护成本高)。

## 历史

- 2026-06-29: 重写 dashboard, 反映 134 cases / 8 维度真实状态; 标识 framework 不独立化路径。
- (之前): 9 特性 / programmable 等命名快照, 已与设计权威脱节。
