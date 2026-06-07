# OOC Storybook —— 体系化能力测试框架

storybook = OOC 的**能力目录 / showcase**：每个能力（8 维度 + class）一个可运行 story，同时给
**控制面确定性验证**（Tier A，可 CI）+ **agent-native 过程可见演示**（Tier B，真 LLM）。
设计权威：`docs/ooc-6/storybook/framework-design.md`。

## 结构

```
_harness/{types,control-plane,agent-native}.ts   # 共享驱动
stories/<cap>.story.ts                           # 9 特性纯模块（runControlPlane/runAgentNative）
stories/_control-plane.test.ts                   # bun:test 汇总入口（CI gate）
specs/capability_<cap>.md                         # 9 份能力规格（Tier A TC + Tier B rubric，收编自 harness playbook）
runner.ts                                        # 聚合 → 覆盖矩阵 + docs/ooc-6/storybook/dashboard.md
```

## 怎么跑

| 命令 | 作用 |
|---|---|
| `bun run test:storybook` | Tier A 控制面确定性套件（零真 LLM）—— **CI gate** |
| `bun run packages/@ooc/meta/storybook/runner.ts` | 聚合 9 特性 → 覆盖矩阵 dashboard |
| `RUN_STORYBOOK_AGENT=1 bun run packages/@ooc/meta/storybook/runner.ts` | 含 Tier B agent-native（需 .env LLM 凭证 + 运行中的 world） |

## 三层测试边界

- **storybook**（本框架）：能力目录，9 特性 × {控制面确定性 + agent-native 演示}。
- **e2e backend/frontend**（`tests/e2e`，S1-S6/F1-F7）：用户任务场景端到端不退化。
- **harness orchestrate**（`tests/harness`）：深度主观评估（spawn 体验官）；场景定义收编入本框架的 `specs/`。

## 迁移状态（2026-06-07）

- `_verify.ts`：**已迁入** `stories/*.story.ts` 的 Tier A（PROG/REFL/VIS/CLASS）+ 补齐 5 特性。保留作历史参考，新增/修改请改 stories。
- `_demo_session.ts`：agent-native 演示模式源，Tier B 的 `_harness/agent-native.ts` 从它抽公共驱动。
- `test_object_{programmable,reflectable,visible}.md`：**已收编** 进 `specs/capability_*.md`（9 份齐全）。
- `tests/harness/playbooks/*.playbook.md`：场景 + rubric **已收编** 进 `specs/`，作为 Tier B 判据来源。
