# WAVE-LIFECYCLE broken tests ledger (Phase 0 + Phase 1)

每行格式：`文件 — 原因`。仅登记，不修（修在 Phase 5）。

## Phase 0 + Phase 1 结果

无任何因 Phase 0/Phase 1 改动而新增的编译/运行失败。

- `bun tsc --noEmit` 过滤 `^packages/@ooc/core`：0 错误（改前改后皆 0）。
- 非 core `packages/@ooc/` 错误：86 个，全部 baseline（git stash 验证：改前=改后=86），
  均为 `packages/@ooc/web` / 部分 builtins visible 的前端依赖缺失
  （`react-router` / `lucide-react` / `@codemirror/*` / `react-dom` 的 TS2307 + 其级联 TS7006），
  与本 wave 改动无关、不在本 wave 范围。
- `ThreadStatus` 加 `"canceled"` 后未触发任何穷举 switch 的 non-exhaustive 报错
  （core 内唯一 `ThreadStatus` 消费点 `thinkable/context/index.ts:42` 只是 re-export）。
- 已跑测试套件全绿（无 FAIL）：
  - `packages/@ooc/core/runtime` + `packages/@ooc/core/executable`：205 pass / 0 fail
  - `packages/@ooc/core/persistable`：151 pass / 0 fail
  - `packages/@ooc/builtins/agent/children/thread`：16 pass / 0 fail
  - 新模块 `core/runtime/__tests__/object-lifecycle.test.ts`：16 pass / 0 fail
