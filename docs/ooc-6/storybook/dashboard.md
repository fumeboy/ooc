# Storybook 覆盖矩阵 / dashboard

> runner 产物（自动生成）。Tier A = 控制面确定性（可 CI）；Tier B = agent-native（真 LLM，env-gated）。
> 生成方式：`bun run packages/@ooc/meta/storybook/runner.ts`。

**Tier A 汇总**：9 特性，FAIL=0。✅ 全绿（CI gate 通过）

| 能力 | Tier A 档位 | A: PASS/FAIL/SKIP | Tier B（agent-native） |
|---|---|---|---|
| thinkable | 🟢 Good | 2/0/0 | 待补（Phase 2） |
| executable | 🟢 Good | 2/0/0 | 待补（Phase 2） |
| collaborable | 🟢 Good | 2/0/0 | 待补（Phase 2） |
| observable | 🟢 Good | 2/0/0 | 待补（Phase 2） |
| reflectable | 🟢 Good | 6/0/0 | 待补（Phase 2） |
| programmable | 🟢 Good | 4/0/0 | 🟢 Good |
| visible | 🟡 OK | 3/0/2 | 待补（Phase 2） |
| persistable | 🟢 Good | 3/0/0 | 待补（Phase 2） |
| class | 🟢 Good | 4/0/0 | 待补（Phase 2） |

_注：SKIP 多为环境依赖（如 visible 的 Vite serve 需 live Vite 指向同 world）。Tier B 质量判据见各 spec。_
