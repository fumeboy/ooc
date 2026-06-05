# 维度体验官 Harness

并行 `claude --dangerously-skip-permissions` 进程作为各 OOC 维度的**体验官**，驱动真实 OOC World
Server 跑任务、观察落盘、自评 Good/OK/Bad、产维度报告。与 bun:test S1-S6（快 CI gate）互补的
**按需深度体验 harness**。设计见 `docs/superpowers/specs/2026-06-05-dimension-experience-harness-design.md`。

## 用法
```bash
# 干跑（验编排机制，无 LLM 成本）
bun packages/@ooc/tests/harness/orchestrate.ts --dry-run

# 冒烟（1 个真实维度端到端）
bun packages/@ooc/tests/harness/orchestrate.ts --smoke

# 全 8 维度并行（~10-30min，真 LLM × 2 层）
bun packages/@ooc/tests/harness/orchestrate.ts

# 指定维度 / 调并发 / 超时
bun packages/@ooc/tests/harness/orchestrate.ts --dimensions reflectable,programmable --concurrency 2 --timeout 1800
```

## 结构
- `playbooks/<dim>.playbook.md` — 每维度的 brief + 种子场景(task+观察指南+rubric) + 探索提示 + 陷阱
- `driver/cheatsheet.md` — OOC HTTP 驱动手册（体验官照此 curl）
- `driver/ooc-drive.ts` — 薄驱动 CLI（可选，等价 cheatsheet curl）
- `officer-prompt.md` — 体验官 prompt 模板（编排注入 dim/port/world/report）
- `report-schema.md` — 报告结构契约
- `orchestrate.ts` — 编排：起 server+officer 并行、收集、聚合 dashboard、清理

## 产出
`docs/harness-reports/<run_ts>/`（**gitignored，ephemeral**）：每维度 `<dim>.report.md`（基线档位+探索发现+Issue）
+ `dashboard.md`（维度×档位矩阵）。notable 发现手工 curate 进 `docs/`（仿 round-N-experience-report）。

## 两层 LLM
- 体验官 = Claude Code 进程（自身 auth）。
- 被测 OOC Agent = OOC_PROVIDER（env `ANTHROPIC_AUTH_TOKEN`）思考。
两者都需真 LLM；全维度跑成本/时长可观，按需触发非 CI。
