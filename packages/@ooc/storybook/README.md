# OOC Storybook —— 体系化能力测试框架

storybook = OOC 的**能力目录 / showcase**：每个能力（8 维度 + class）一个可运行 story，同时给
**控制面确定性验证**（Tier A，可 CI）+ **agent-native 过程可见演示**（Tier B，真 LLM）。
设计权威：`docs/ooc-6/storybook/framework-design.md`。

## 结构

```
_harness/{types,control-plane,agent-native,story}.ts  # 共享驱动（含单元化 story 骨架）
stories/<cap>.story.ts                           # 9 能力 story（runControlPlane/runAgentNative，Tier A/B）
stories/L<n>_<layer>.stories.ts + _catalog.ts    # 单元化 catalog（一条 story 一个预期）
stories/{_control-plane,_catalog}.test.ts        # bun:test 汇总入口（CI gate）
runner.ts / catalog-runner.ts                    # 聚合 → dashboard / stories-report（docs/ooc-6/storybook/）
```

> **测试规格已归属对象树（Phase 3，2026-06-09）**：每个能力的 Tier A TC + Tier B rubric 由对应 OOC Object
> 的 `knowledge/tests.md` 持有（`.ooc-world-meta/.../children/<dim>/`）；原 `specs/capability_<cap>.md` 已删。
> 体验官 orchestrate 读对象树的 tests.md 作剧本。测试**代码**留本目录（可跑、进 CI）。

## 怎么跑

| 命令 | 作用 |
|---|---|
| `bun run test:storybook` | Tier A 控制面确定性套件（零真 LLM）—— **CI gate** |
| `bun run packages/@ooc/storybook/runner.ts` | 聚合 9 特性 → 覆盖矩阵 dashboard |
| `RUN_STORYBOOK_AGENT=1 bun run packages/@ooc/storybook/runner.ts` | 含 Tier B agent-native（需 .env LLM 凭证 + 运行中的 world） |

## 三层测试边界

- **storybook**（本框架）：能力目录，9 特性 × {控制面确定性 + agent-native 演示}。
- **e2e backend/frontend**（`tests/e2e`，S1-S6/F1-F7）：用户任务场景端到端不退化。
- **harness orchestrate**（`tests/harness`）：深度主观评估（spawn 体验官）；剧本（场景 + rubric）读对象树 `children/<dim>/knowledge/tests.md`。

## 迁移状态

- `_verify.ts`：**已迁入** `stories/*.story.ts` 的 Tier A。保留作历史参考，新增/修改请改 stories。
- `_demo_session.ts`：agent-native 演示模式源，Tier B 的 `_harness/agent-native.ts` 从它抽公共驱动。
- 测试规格（Tier A TC + Tier B rubric）**已归属各维度 OOC Object 的 `knowledge/tests.md`**（Phase 3，2026-06-09）；
  原 storybook `specs/` 已删，orchestrate 改读对象树。
