# Failed Form GC — 复用 P0-2 自然衰减协议精修豁免规则

**作者**：Supervisor
**日期**：2026-05-27
**性质**：design + 实施 plan
**触发**：Round 14 体验官观察 — failed form 长期残留 thread.contextWindows 堆积占 context_bytes
**前置**：Round 13 form 四态机 + Round 1 P0-2 自然衰减协议

---

## 1. 问题

**Round 14 体验官原文**：
> failed form 不阻塞 thread 进入 waiting 状态（符合设计），但**有可能 LLM 永远不回头修**它们 → 长期 thread 上下文里堆积 failed forms 占 context_bytes

具体场景（Round 14 实测）：
- thread settle 到 waiting 时残留 2 个 failed form（say 缺 msg / refine 给空 args）
- LLM 后续 N 轮没 refine / 没 close
- 占 token + 视觉噪音

---

## 2. 设计哲学

### A. 复用已有协议，不发明新机制
P0-2 已落地 **自然衰减（idle-fold / age-fold / double-fold）** + **emergency guard** —— 这是 OOC 处理"长期不用的 window 占 context"的通用方案。failed form 是这个问题的一个 instance。

### B. visibility-first（不静默 GC）
LLM 应该看见 form 被 fold（compressLevel 1/2），而不是被静默物理移除。**fold ≠ close**：
- fold：compressLevel 升档，render 时只 summary，LLM 仍可 refine 修复（form 还在）
- close：物理移除（不可恢复）

GC 应当走 fold，不走 close。LLM 决定要不要 close。

### C. 精修豁免规则，不破坏其它语义
P0-2 现状：`command_exec` **整类豁免**（设计原因："command_exec 是当前活动 form"）。

Round 13 后状态机更精细：
- `open` / `executing` = **真活动 focus**（LLM 正在用 / exec 在跑）
- `success` = 已自动移除（不会到衰减阶段）
- `failed` = **stuck**（不是 focus；可能永远不回头）

`failed` 不再属于"当前活动 form"，应当**取消豁免**。

---

## 3. 实施

### 3.1 改豁免规则（核心 1 处）

`src/thinkable/context/budget.ts`：

**前**（L132 + L441）：
```ts
const DECAY_EXEMPT_TYPES = new Set(["root", "command_exec"]);
const EMERGENCY_EXEMPT_TYPES = new Set(["root", "command_exec"]);
```

**后**（抽 helper）：
```ts
/** 永不衰减/降级的豁免判定。
 *  - root: thread 同生命周期, 不可关闭
 *  - command_exec.status ∈ {open, executing}: 真活动 form, LLM 正在用 / exec 在跑
 *  - command_exec.status === "failed": **不豁免** (Round 13 状态机 + Round 14 体验官观察:
 *    failed 不是焦点; LLM 可能永远不回头修; 让它走自然衰减 fold)
 *  - command_exec.status === "success": 永远不会到这里 (success 自动从 contextWindows 移除)
 */
function isDecayExempt(window: ContextWindow): boolean {
  if (window.type === "root") return true;
  if (window.type === "command_exec") {
    return window.status === "open" || window.status === "executing";
  }
  return false;
}
```

替换所有 `DECAY_EXEMPT_TYPES.has(window.type)` / `EMERGENCY_EXEMPT_TYPES.has(window.type)` 调用点。

### 3.2 failed status 进 IDLE_STATUS_SET

`IDLE_STATUS_SET` 现在是 `{done, archived, closed, idle}`。

**加 `"failed"`**：
```ts
const IDLE_STATUS_SET = new Set(["done", "archived", "closed", "idle", "failed"]);
```

这样 failed form **进 idle-fold 路径**（N 轮后 level 0→1）；不在 idle-set 就只走 age-fold（K 轮无 exec 访问）。两条都会触发，但 idle-fold 更快感知 failed 状态。

### 3.3 basic-knowledge hint

`src/thinkable/knowledge/basic-knowledge.ts` 的 form lifecycle 段（Round 13 重写）追加：

```
## failed form 长期残留的 GC (Round 14 体验官 + Round 16 落地)

failed form 如果长期 (N 轮) 没有 refine / close, OOC 会自动让它走自然衰减:
- N 轮无访问 → compressLevel 0→1 (折叠为 summary, render 时只看 title)
- K 轮持续无访问 → compressLevel 1→2 (snapshot 形态)
- fold 不会物理移除 form, LLM 仍可调 refine 复活回 open 或 close 释放

**建议**: 主动 close 你不打算 refine 的 failed forms, 而不是让它积压。
检查 thread.contextWindows 内 failed forms; 不再相关的直接 close。

(自然衰减规则: 单 Object 可在 stones/<self>/config/context-budget.json
调 naturalDecay.idleRoundsN / ageRoundsM / doubleFoldRoundsK)
```

### 3.4 meta 同步

`meta/object.doc.ts:thinkable.children.context_budget.patches.natural_decay` 加一行：

```
- **command_exec failed** 状态参与衰减 (Round 16, 2026-05-27);
  从 Round 1 的 "command_exec 整类豁免" 精修为 "仅 open/executing 豁免"。
  failed 不是焦点, 应当走 idle-fold; 与 emergency_guard 豁免规则同步。
```

### 3.5 单测

`src/thinkable/context/__tests__/budget.test.ts` 加 3 用例：

1. **command_exec failed 进 idle-fold**：构造 thread + 1 个 command_exec.status="failed" form；调 applyNaturalDecay N 轮后断言 compressLevel === 1
2. **command_exec open 仍豁免**：同上但 status="open"；N 轮后 compressLevel === 0（仍豁免）
3. **command_exec executing 仍豁免**：同上但 status="executing"；N 轮后 compressLevel === 0

---

## 4. 不变量

| 不变量 | 说明 |
|---|---|
| **不发明新 GC 机制** | 复用 P0-2 自然衰减 + emergency guard |
| **不物理移除 form** | fold 到 compressLevel 1/2，LLM 仍可 refine 复活 |
| **visibility-first** | fold 落 ProcessEvent `context_compressed`，LLM 看见 |
| **保留 active form 不被 fold** | open / executing 仍豁免 |
| **可配置** | stones/<self>/config/context-budget.json 调阈值（已有协议）|

---

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 折叠后 LLM 想 refine 复活看不到完整 result | level 1 fold 仍有 summary 含 result 摘要；level 2 snapshot 也指 form id，LLM 可调 expand 复原 |
| 单测改动小但要覆盖 4 个 status case | 加 3 用例（success 不需要测，自动移除）|
| LLM 不知道 failed form 在被 fold | knowledge hint + ProcessEvent 双重可见 |

---

## 6. 实施分阶段

| Phase | 范围 | 派单 |
|---|---|---|
| **G1** | meta + design doc | Supervisor 直写 |
| **G2** | budget.ts 豁免规则 + basic-knowledge hint + 单测 | 1 sub agent |
| **G3** | Supervisor 验证 + commit + push | Supervisor |

---

## 7. 验收

1. tsc clean
2. budget.test.ts 新 3 用例 pass
3. 全仓 src/ + e2e 不破坏
4. 真启 backend + 跑 thread 含 failed form → N 轮后看 thread.events 出现 context_compressed reason=idle-fold

---

## 历史

- 2026-05-27: 首版。Round 16 design。
