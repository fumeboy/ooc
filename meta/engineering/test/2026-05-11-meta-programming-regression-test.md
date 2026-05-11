# Meta-Programming Regression Test Record

## 背景

本次测试针对以下两类改动做回归验证：

1. `observable` 增加 debug mode 与 `loop_NNN.{input,output,meta}.json` 落盘能力
2. `form` 协议增强：
   - `open(type=command)` 只负责创建 form
   - 业务参数必须放在 `args` 或 `refine(args={...})`
   - `submit(form_id)` 不接受新的业务参数
   - `program` 在缺少执行参数时返回可操作的纠偏提示

目标是确认 Agent 能稳定走出正确的 `open/refine/submit` 序列，并通过真实 LLM 完成 `meta-programming.integration.test.ts`。

## 操作过程

### 1. 功能分支验证

在 worktree `feat/observable-debug-form-protocol` 中执行：

```bash
bun test src/observable/__tests__/observable.test.ts \
  src/executable/__tests__/tools.test.ts \
  src/executable/__tests__/program.test.ts \
  src/thinkable/__tests__/context.test.ts \
  src/thinkable/__tests__/single-object-runtime.test.ts
```

结果：
- `35 pass`
- `0 fail`

继续执行：

```bash
bunx tsc --noEmit
```

结果：
- exit code `0`

### 2. 真实 LLM 集成验证

在 worktree 中使用主工作区 `.env` 执行：

```bash
bun --env-file=/Users/bytedance/x/ooc/ooc-2/.env test tests/integration/meta-programming.integration.test.ts
```

结果：
- `1 pass`
- `0 fail`
- 耗时约 `226.52s`

说明：
- Agent 已能完成“写入 `server/index.ts` -> 调用 `add` -> `end`”的完整链路
- 未再出现“把 `language/code` 写进 description”或“空 submit”导致的卡死

### 3. 合并到 main

执行：

```bash
git merge feat/observable-debug-form-protocol
```

结果：
- Fast-forward 合并成功

说明：
- 主工作区原有 `goal.md` 本地修改未被覆盖
- 仅将功能分支上的 `observable/persistable/thinkloop/context/tool/doc/test` 改动并入 `main`

### 4. 清理测试产物

按要求删除：

```text
/Users/bytedance/x/ooc/ooc-2/.ooc-world-test/stones/agent-meta-test/server/index.ts
```

说明：
- 该文件属于本地 `.ooc-world-test/` 测试产物
- 删除后不影响正式代码路径

### 5. main 分支复验

在主工作区重新执行：

```bash
bun --env-file=.env test tests/integration/meta-programming.integration.test.ts
```

结果：
- `1 pass`
- `0 fail`
- 耗时约 `126.30s`

说明：
- 即使清理了 `.ooc-world-test/stones/agent-meta-test/server/index.ts`
- 集成测试仍能在临时目录内自行创建 stone / flow / server 文件并独立通过
- 说明测试对外部测试遗留物无隐式依赖

## 结论

本次回归结论如下：

- `observable` 的 debug mode 与 loop 级落盘能力可用
- `program` 缺参纠偏提示生效
- `active_forms` 中的 `next_action` / `protocol_hint` 提升了 Agent 对 form 协议的遵循
- `meta-programming.integration.test.ts` 在真实 LLM 环境下可通过
- 删除历史 `.ooc-world-test` 里的 `server/index.ts` 后，测试仍然通过，说明链路具备隔离性

## 建议

- 后续新增依赖真实 LLM 的集成测试时，建议默认开启 debug mode，便于失败时直接查看 `loop_NNN.meta.json`
- 若继续扩展 Agent form 协议，优先沿着“可见性增强 + 明确纠偏提示”方向推进，避免引入黑箱自动修正
