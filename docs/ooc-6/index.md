# OOC-6 能力维度索引

> **维度/模块设计的权威已迁入 `.ooc-world-meta` 对象树**（OOC 自举 world，submodule → ooc-0）。
> 每个维度的「核心设计 / 当前设计 / 现状 / 已知问题 / 名词解释 / knowledge」由对应 OOC Object 自管：
> `.ooc-world-meta/stones/main/objects/supervisor/children/<dim>/`。
> 原 `docs/ooc-6/<dim>/<date>-iteration-NN.md` 迭代文档**已吸收进对象树并删除**（演化轨迹见 git 历史）。
> 本 index 现仅保留**跨维度分析**入口；与代码冲突时一律信代码。

## 9 个能力维度 → 对象树

OOC Agent 由 9 个能力维度组合（运行时底座 5 + 自我塑造 2 + 外观 2）+ 横向模块 app / class。
每个维度的设计师对象（self.md 先陈述核心设计 + 名词解释 + knowledge）：

| 维度 | 对象（`.ooc-world-meta/.../children/<dim>/`） |
|---|---|
| thinkable（思考） | `children/thinkable/` — context window + 渐进式执行伴随渐进式知识激活 |
| executable（行动） | `children/executable/` — 以 Object 为中心的稳定行动协议（object method） |
| collaborable（协作） | `children/collaborable/` — talk/do 窗口协作、消息投递、无全局共享态 |
| observable（观测） | `children/observable/` — 不改变行为的旁路观测 |
| persistable（持久化） | `children/persistable/` — stone/pool/flow 三子树 + session-worktree |
| reflectable（反思/自我演化） | `children/reflectable/` — 业务 session 试验 → super flow 合入闭环 |
| programmable（自写方法） | `children/programmable/` — Object 为自己编写并热更方法库 |
| readable（LLM 侧展示） | `children/readable/` — Object 怎样被读（静态名片 + 动态渲染/window method） |
| visible（人类侧 UI） | `children/visible/` — 自持 UI + ooc:// 1:1 映射 SPA route |
| app（控制面，横向） | `children/app/` — 显式 runtime orchestration（job/worker/pause） |
| class（一等继承，横向） | `children/class/` — class 与 object 平级、仅供继承 |

## 本轮系统演化主线（2026-06，史料）

四条横切主线（设计权威留在 `docs/` 对应设计文档，对象树持终态）：

1. **去 metaprog 统一 session-worktree**（persistable/reflectable/programmable，2026-06-09）：LLM session 内所有 stone 写一律 plain write 落 `flows/<sid>` worktree，唯一合入闸门 = super flow `evolve_self`。设计权威 `docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md`。
2. **session-worktree 统一模型**（persistable/executable/programmable/reflectable/visible）：stone identity 会话内试验层 = 从 main 派生的 git worktree 分支。设计权威 `docs/2026-06-05-stone-flow-overlay-versioning-design.md`。
3. **可观测增强**（observable）：log-aggregator 限流 + `/api/runtime/activity` 快照 + harness 超时前抓快照，把盲 TIMEOUT 变成可诊断。
4. **class 一等继承抽象**（2026-06-07）：class 提升为与 object 平级的唯一继承机制（剔除 prototype）；builtin=类 / world=实例；`instantiate_with_new_world` 幂等实例化。详见 [class-abstraction.md](./class-abstraction.md)。

## 跨维度分析

- [self-iteration-frontier.md](./self-iteration-frontier.md) —— 层次 A（Object 自我迭代，已闭环）vs 层次 B（框架自我迭代，尚不成立）+ 三缺口（边界/重载/治理）。（已吸收进 reflectable/knowledge/self-iteration-frontier.md，源留作上游权威。）
- [dogfooding-probe-design.md](./dogfooding-probe-design.md) —— 最小 dogfooding 探针实验设计（5 阶段插桩 + 预判矩阵）。
- [class-abstraction.md](./class-abstraction.md) —— OOC Class 一等继承抽象横切变更记录（动机→设计→实现→验证）。
- [storybook/framework-design.md](./storybook/framework-design.md) + [storybook/stories-outline.md](./storybook/stories-outline.md) + [storybook/dashboard.md](./storybook/dashboard.md) + [storybook/stories-report.md](./storybook/stories-report.md) —— 能力测试框架（Tier A 控制面确定性 + 单元化 catalog + agent-native）。归测试归属（Phase 3）。

## 文档约定

- **维度设计的活文档是对象树**（`.ooc-world-meta`）；`docs/ooc-6/` 仅留跨维度分析与史料，正逐步退役。
- **接地**：源代码与文档分歧时信任源代码。
