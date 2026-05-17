# OOC e2e tests

设计依据：
- `docs/testing/strategy.md` — 三档评分基准、不稳定性政策、入口分离原则
- `docs/testing/oocable-codeagent-backend-e2e.md` — 后端 S1–S4 场景集
- `docs/testing/oocable-codeagent-frontend-e2e.md` — 前端 F1–F5 场景集

## 触发

默认 skip，避免 `bun test` 全量跑时调用真 LLM：

```bash
# 后端 e2e（in-process Elysia + worker + 真 LLM）
RUN_BACKEND_E2E=1 bun test tests/e2e/backend

# 前端 e2e（Playwright + spawn 真 backend + spawn Vite + 真 LLM）
RUN_FRONTEND_E2E=1 bunx playwright test --config tests/e2e/frontend/playwright.config.ts
```

`.env` 中的 `OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL` 三件套缺一即跳过。

## 结构

```
tests/e2e/
├── backend/
│   ├── _fixture.ts                              # loadRealEnv / startApp / score / 观察 helpers
│   ├── backend-rename-symbol-via-edit.e2e.test.ts (S1)
│   ├── backend-read-only-search.e2e.test.ts       (S2)
│   ├── backend-multi-turn-followup.e2e.test.ts    (S3)
│   └── backend-invalid-edit-recovery.e2e.test.ts  (S4)
└── frontend/
    ├── playwright.config.ts
    ├── _fixture.ts                              # spawn backend + Vite + 浏览器跨场景
    ├── frontend-create-session-and-first-reply.spec.ts (F1)
    ├── frontend-rename-symbol-via-chat.spec.ts         (F2)
    ├── frontend-search-and-open-match.spec.ts          (F3)
    ├── frontend-user-talk-window-composer.spec.ts      (F4)
    └── frontend-no-right-panel-on-user-thread.spec.ts  (F5)
```

## Good / OK / Bad

每个场景显式列出 `bad` 与 `good` 规则（见 fixture `scoreScenario`）：

- `bad` 任意命中 → **Bad**：测试失败
- 否则 `good` 全命中 → **Good**；缺一即 **OK**

测试断言 `tier !== "Bad"`；命中档 + 关键观察值由 `logScore` 打到 stdout，
CI artifact 留下来便于追"上周 8/10 Good 这周 3/10 Good"这种退化。
