# Observable Debug And Form Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OOC 增加可开关的 loop 级 debug 观测，并增强 form 协议可见性与纠偏提示，使 agent 稳定走对 `open/refine/submit` 序列。

**Architecture:** `observable` 负责 debug 生命周期与内存快照，`persistable` 负责 debug 文件路径与写盘，`thinkloop` 负责挂接单轮开始/结束记录，`context` 与 `tool/command` 负责把 form 协议约束显式暴露给 LLM。

**Tech Stack:** TypeScript, Bun test, Node `fs/promises`, 现有 `persistable` / `observable` / `thinkable` / `executable` 模块。

---

### Task 1: Loop Debug Persistence

**Files:**
- Modify: `src/persistable/debug-file.ts`
- Modify: `src/persistable/index.ts`
- Test: `src/observable/__tests__/observable.test.ts`

- [ ] 增加 loop 级 debug 文件路径与记录类型。
- [ ] 支持写入 `loop_NNN.input.json` / `loop_NNN.output.json` / `loop_NNN.meta.json`。
- [ ] 保持现有 `llm.input.json` / `llm.output.json` 覆盖写语义不变。

### Task 2: Observable Debug Mode

**Files:**
- Modify: `src/observable/index.ts`
- Test: `src/observable/__tests__/observable.test.ts`

- [ ] 增加 debug 开关与状态查询 API。
- [ ] 增加 loop 计数器与 begin/finish 生命周期。
- [ ] 在 debug 开启时写 loop 文件；关闭时保持仅 latest snapshot + 兼容落盘。

### Task 3: ThinkLoop Hookup

**Files:**
- Modify: `src/thinkable/thinkloop.ts`
- Test: `src/thinkable/__tests__/single-object-runtime.test.ts`

- [ ] 在每轮 LLM 调用前后挂接 begin/finish debug 生命周期。
- [ ] 记录 `ok / paused / error` 状态与错误信息。
- [ ] 确保异常路径也能落盘 meta。

### Task 4: Form Protocol Visibility

**Files:**
- Modify: `src/thinkable/context.ts`
- Modify: `src/executable/tools/open.ts`
- Modify: `src/executable/tools/refine.ts`
- Modify: `src/executable/tools/submit.ts`
- Test: `src/executable/__tests__/tools.test.ts`

- [ ] 增强 tool 描述，明确 `args` 与 form 生命周期协议。
- [ ] 在 `active_forms` 中新增 `next_action` / `protocol_hint`。
- [ ] 为 `program` form 提供缺参时的定向提示。

### Task 5: Program Command Feedback

**Files:**
- Modify: `src/executable/commands/program.ts`
- Test: `src/executable/__tests__/program.test.ts`

- [ ] 将缺少 `language/code/function` 的结果改成可操作的纠偏提示。
- [ ] 保持已有 `shell / ts/js / function` 正常路径不回退。

### Task 6: Integration Stabilization

**Files:**
- Modify: `tests/integration/meta-programming.integration.test.ts`
- Optionally modify: `tests/integration/_fixture.ts`

- [ ] 让 prompt 更明确地要求 `open(args?) / refine(args={...}) / submit(form_id)`。
- [ ] 在需要时开启 debug，便于失败复盘。
- [ ] 以真实 LLM 环境重跑验证通过。

### Task 7: Documentation Alignment

**Files:**
- Modify: `meta/object/observable/index.doc.js`
- Modify: `meta/object/observable/debug.doc.js`
- Modify: `meta/object/executable/actions/tools/open.doc.js`
- Modify: `meta/object/executable/actions/tools/refine.doc.js`
- Modify: `meta/object/executable/actions/tools/submit.doc.js`

- [ ] 同步 debug 模式当前实现边界。
- [ ] 同步 form 协议约束与推荐调用示例。

### Task 8: Verification

- [ ] 运行 `bun test src/observable/__tests__/observable.test.ts src/executable/__tests__/tools.test.ts src/executable/__tests__/program.test.ts src/thinkable/__tests__/single-object-runtime.test.ts`
- [ ] 运行 `bunx tsc --noEmit`
- [ ] 运行 `bun --env-file=.env test tests/integration/meta-programming.integration.test.ts`
