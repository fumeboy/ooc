# OOC 系统自循环优化（dogfooding loop）

> 2026-06-10。重启 `.ooc-world-meta` world（:3100）+ 开 debug（`POST /api/runtime/debug/enable`），
> 按 5 步 loop 让 OOC supervisor 自检/反思、与我的分析对比、观测产物、收集问题并优化。

## 跑法
两个真实 LLM session（`POST /api/sessions`，target=supervisor，前缀 `_test_selfloop_*`，跑后 pause 清理）：
1. **doc 自检**：审 world 文档质量/与源码一致/不清楚/可优化/可精简。
2. **设计反思**：反思 9 维度划分、ContextWindow/激活/worktree/class/协作等核心机制的设计债。

## OOC 的表现 vs 我的分析

### doc 自检（OOC 跑了 23 轮、未出最终 say）
- **OOC 自行 grep 源码逐条核验 doc 锚点**，独立发现 **file:行号漂移**：executable 知识写 `resolveMethod :228/:240`，实际主体在 `object-registry.ts:249`（`:228` 是内部 self-self overload）。还在核 `delivery.ts:88-89`、`triggers.ts:187`。
- **与我的判断一致**：我列的「`file:行号` 锚天生脆、每次重构漂移」被 OOC 用实例独立验证。
- **差集**：OOC 聚焦"锚点是否对得上代码"（逐条 grep）；我更早指出**根因**是 builtin seed 与对象树 meta 知识双源漂移——OOC 在单 session 视角里看不到这层（它只审自己看到的文档）。

### 设计反思（OOC 失败于超时）
- 失败前 OOC 正确地 `open_knowledge` 展开 ooc-philosophy / engineering-harness——**渐进式激活按预期工作**（看到 summary 主动拉全文）。但下一轮 LLM 调用超时，整 thread 被判 failed。

## Step 4 — thread.json / llm.input.json 观测发现

| # | 类型 | 发现 |
|---|---|---|
| A | 可靠性 | **单次 LLM 调用超时（默认 120s, `OOC_LLM_TIMEOUT_MS`）→ 整 thread `status=failed`，无重试、无 resume**。design session 即因此全废（3 轮工作丢失）。retry 逻辑（`retryClaudeGenerate`）在 timeout 内层、管不到慢调用。 |
| B | 可用性 | supervisor 读自身 world 文档时 **open_file 路径试错**（"baseDir 是 world 根…我需要用 flows/<sid>/objects/... 完整路径"），连环 close 失败 form、烧轮次。缺「session 内怎么引用 world 文件」的明确路径指引。 |
| C | UX/行为 | 开放式审计跑 23 轮、**对 user 零 interim `say`**（6+ 分钟静默），且随时可能撞超时全废。应分段 checkpoint 或任务更有界。 |
| ✓ | 正面验证 | 本轮两项改动线上生效：① XML **原样输出**（新 llm.input.json 中 `&quot;`/`CDATA` 计数=0）；② 知识**渐进式激活**（supervisor 常驻 full 9→3、summary 8，按需 open_knowledge 拉全文）。 |

## Step 5 — 已实施的优化（安全、loop 直接暴露）
- **LLM 超时默认 120s → 240s**（`thinkable/llm/timeout.ts`）：opus 级 + 大 context + extended thinking 单轮常 >120s，旧默认把正常深思轮判超时、硬杀 thread。仍可 `OOC_LLM_TIMEOUT_MS` 覆写。同步 `timeout.test.ts` 断言。

## 待决策方向（未实施——需更大改动 / 设计裁决）
1. **builtin seed vs 对象树 meta 知识双源**：归并裁决（instance-own 覆盖 / meta-world 不继承重定义主题）。本会话已多次暴露同根漂移。
2. **anchor 脆性根治**：`file:行号` → 符号名锚，或加一个校验 doc 锚点对得上代码的 check（OOC 这次手动 grep 做的事应工具化）。
3. **超时 reliability 升级**：除上调默认外，考虑 timeout 触发后 retry-once / 允许 failed thread resume（避免 transient 故障不可逆废工）。
4. **长任务 UX**：thinkloop 对开放式长任务应支持/鼓励 interim `say` checkpoint。
5. **peer 窗口渐进**：11 个 children peer 每轮全注入（~6.8k），peer 发现也可渐进而非恒亮。
