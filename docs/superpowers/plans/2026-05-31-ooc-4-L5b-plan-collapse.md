# OOC-4 L5b：plan 塌缩（plan_window → plan.md owner flow）

> 执行 sub-agent **不要自己 commit**。复用 L5a（b538d6ae）建立的自视切片机制。

**Goal:** plan_window（持久化 ContextWindow，7 方法 + 嵌套 sub-plan）塌缩为 **`plan.md`**（object-scoped owner flow，markdown 文本）+ root 方法 `plan_set/plan_update/plan_clear` + active plan 自视切片。删 plan_window type。

**MVP 扁平（spec §4 已定）**：plan.md 是单一 markdown 文本，LLM 把 steps 作 markdown checklist（`- [ ]`/`- [x]`）**自管**（plan_set 全量设置、plan_update 改、plan_clear 清）。**降级**：嵌套 sub-plan（expand_step/collapse_subplan）+ 7 个 granular 方法（add_step/update_step/mark_done 等）→ 不再单独存在（LLM 直接编辑 plan.md 文本，更自然，符合「owner 维护自己的 plan 文档」）。

**Architecture（镜像 L5a）**：新增 `src/persistable/flow-plan.ts`（plan.md，object-scoped，serial-queue 写）+ `renderSelfView` 加 plan 段（self-view.ts）。root.plan（创建 window）→ plan_set/update/clear（写 plan.md）。删 plan WindowType + PlanWindow + renderPlanWindow/compressPlanWindow/onClosePlanWindow + windows/plan/。

**基线**（L5a 后）：1086 pass / 0 fail / 3 skip，tsc 0。

---

## 设计决策
### D1 plan.md（object-scoped owner flow）
`flows/<sid>/objects/<oid>/plan.md`（与 todos.json/data.json 同级）。单一 active plan markdown 文本。`src/persistable/flow-plan.ts`：`planFile(ref)` / `readPlan(ref): Promise<string>`（不存在→""）/ `writePlan(ref, md)`（经 enqueueSessionWrite，仿 flow-todos）。
- object-scoped → child do thread 共享对象 plan（**plan-share-parent-child 自动满足**，取代旧 share_windows 机制）。

### D2 root 方法（替换 root.plan；**M2 定：仅 2 个，drop plan_update**）
ROOT_METHODS 去 `plan: planCommand`，加：
- `plan_set(content)`：全量设置 plan.md（覆盖）。
- `plan_clear()`：清空 plan.md。
**不加 plan_update**（MVP 下与 plan_set 等价冗余，drop，与 todo 的 verb pairing 一致；将来需 diff 式再加）。**ROOT_METHODS count：18 − 1（plan）+ 2 = 19**。
每 method 返回 `internal/executable/plan_<x>/basic` knowledge（>20 字符，commands.test per-method 循环要求，两个文本不可 copy-paste 雷同）+ in-character 说明（LLM 用 markdown checklist `- [ ]`/`- [x]` 在 content 里管 steps）。
command.plan.ts **delete-and-rewrite 镜像 command.todo.ts**（M3，现 193 行全是 plan_window 逻辑，共享零代码；header docblock 也须重写）。

### D3 自视切片 plan 段
self-view.ts 的 `renderSelfView` 加：读 plan.md，非空 → `<self_view>` 内 `<plan>`（active plan 文本，置顶——在 todos 段之前或之后定个序）。空 plan → 不渲。

### D4 删 plan_window（tsc 枚举）
- WindowType union 去 `"plan"`；删 `PlanWindow`/`PlanWindowStep`/`PlanStep` interface + `generateWindowId` 前缀。
- 删 `registerWindowType("plan")` + `REGISTRY.set("plan")`（静态 seed，仿 L5a M4）+ renderPlanWindow/compressPlanWindow/onClosePlanWindow + windows/plan/ 目录 + windows/index.ts import。
- 删 command.plan.ts 旧 7 方法实现（D2 rewrite）。
- tsc 枚举所有 `type:"plan"`/`PlanWindow`/`planCommand`/parentPlanWindowId/subPlanWindowId 引用补齐。
- **H2 死触发**：`window::plan` activation（triggers.ts kind:"window" 匹配 w.type）塌缩后**永不触发且不 fail-loud**（parseTrigger 接受任意非空串）。`basic-knowledge.ts:220` 的 `"window::plan": "show_content"` 规范示例须换成存活 type（如 `window::program`/`window::do`）；记此面：seeded/world knowledge 里的 `window::plan` 静默 no-op（无 fail-loud）。

### D5 持久化迁移
旧 thread.json 含 plan_window → WindowType 去除后 dev world 重生（同 L5a）。测试迁移到 plan.md/plan_*。

---

## File Structure
```
src/persistable/flow-plan.ts                      # 新增：plan.md 读写
src/persistable/index.ts                          # 改：export flow-plan
src/thinkable/context/self-view.ts                # 改：renderSelfView 加 <plan> 段（plan 置顶，在 todos 前）
src/thinkable/knowledge/basic-knowledge.ts        # 改：scrub plan method 名 prose（:39/:125/:143 plan→plan_set）+ window::plan 示例(:220)换存活 type（H1/H2，agent-facing，仿 L5a todo scrub）
src/executable/windows/root/command.plan.ts        # 删+重写镜像 command.todo.ts：plan_set/plan_clear（写 plan.md）
src/executable/windows/root/index.ts              # 改：ROOT_METHODS 去 plan 加 plan_set/plan_clear + ROOT_KNOWLEDGE 表
src/executable/windows/_shared/types.ts           # 改：WindowType 去 "plan"，删 PlanWindow + 前缀 + PlanStep 等
src/executable/windows/_shared/registry.ts        # 改：删静态 REGISTRY.set("plan")
src/executable/windows/plan/                       # 删：整目录
src/executable/windows/index.ts                   # 改：去 import "./plan/index.js"
meta/object.doc.ts                                 # 改：method 表 + plan 描述
# 测试迁移（grep type:"plan"/PlanWindow/method="plan"/plan_window）：plan-then-execute.integration /
#   plan-window-basic.e2e / plan-share-parent-child.e2e / commands.test / commands-execution.test /
#   context.test / thinkloop.test / 任何 plan_window 断言
```

---

## Task 1：flow-plan 持久化 + 单测
- [ ] flow-plan.ts（planFile/readPlan/writePlan，serial-queue）+ 单测（不存在→""、写读回、clear）。export。

## Task 2：root plan_* 方法
- [ ] command.plan.ts 重写：plan_set/plan_update/plan_clear（写 plan.md）+ in-character knowledge（教 LLM 用 markdown checklist 管 steps）+ 每 method internal/executable/plan_*/basic entry。
- [ ] ROOT_METHODS 去 plan 加 3 个；ROOT_KNOWLEDGE 方法表更新（删 plan 行加 plan_* 行）。

## Task 3：自视 plan 段
- [ ] self-view.ts renderSelfView 加读 plan.md → `<plan>`（非空）。定 todos/plan 段序。
- [ ] 单测：含 plan.md 的 context 有 `<self_view><plan>`；空不渲。

## Task 4：删 plan_window（tsc 枚举）
- [ ] WindowType 去 "plan" + 删 PlanWindow + PlanStep 等 + generateWindowId 前缀；删 REGISTRY.set("plan") + windows/plan/ + windows/index.ts import + command.plan 旧实现。
- [ ] tsc 枚举补齐（含 web display union 残留——若不在后端 tsconfig 则记为 web 清理，同 L5a）。

## Task 5：测试迁移 + meta + 回归
- [ ] **完整测试清单（C1，含 review 补的 5 文件）**——迁移到 plan.md/plan_*/自视：
  - `src/executable/__tests__/commands.test.ts`（toContain + **精确 sorted toEqual：去 plan 加 plan_set/plan_clear 保排序，count 19** + per-method knowledge 循环）
  - `src/executable/__tests__/commands-execution.test.ts`、`src/thinkable/__tests__/context.test.ts`、`src/thinkable/__tests__/thinkloop.test.ts`
  - **`src/app/server/modules/flows/service.test.ts`（:11,762-828 import PlanWindow + type:"plan"，硬 tsc break，最危险）**
  - **`src/executable/__tests__/tools.test.ts`（:31-69 exec(method=plan) form + forms[0].command==="plan"）**
  - **`src/executable/__tests__/server-enrich.test.ts`（:32-38 makeForm command:"plan" + internal/executable/plan/basic|input 路径→plan_set）**
  - **`src/thinkable/__tests__/single-object-runtime.test.ts`（:65-112 mock method:"plan"）**
  - **`src/executable/windows/root/__tests__/command.refine-hint.test.ts`（:36 TARGETS 含 "plan" + :44 ROOT_METHODS["plan"] throw-if-missing → 换 plan_set）**
- [ ] **plan-share-parent-child.e2e + plan-window-basic.e2e = 删+重写（H3，非 assertion-patch）**：现测 share_windows/lent_out/expand_step/collapse_subplan/compressView——MVP 扁平全删。**新 plan-share 测试**：构造 child do-thread 共享 parent objectId → 断言 child 的 renderSelfView 渲染同一 `<plan>`（证 object-scoped 取代 share_windows）。plan-window-basic 的 compressView block 直接删（自视已精简态，无 analog）。
- [ ] **meta/object.doc.ts（M1）**：method count 18→**19** + named-entry :850 `"plan"` 描述→plan_set/plan_clear + **删/重写 plan_window DocTreeNode（:1174-1235，含 sources 指向被删的 windows/plan/ → 改指 flow-plan.ts/command.plan.ts）** + window-type list 各处 plan 提及。tsc 该文件。
- [ ] `bun test src/`（0 fail）、`bun tsc --noEmit`（0）、`bun tsc --noEmit meta/*.doc.ts`、route-audit e2e。

---

## 验证 gate
- [ ] plan_set→plan.md 落盘；plan_clear 清；plan_update 改。
- [ ] 自视：含 plan.md 的 context 有 `<self_view><plan>`；空不渲。plan-share：child do thread 渲染对象 plan（object-scoped 自动）。
- [ ] plan_window type 彻底删（WindowType 无 "plan"，windows/plan/ 删，tsc 0 残留）。
- [ ] bun test src/ 0 fail；tsc 0；meta tsc PASS；route-audit PASS。

## 开放点（feasibility review 核查）
1. plan_update vs plan_set 是否冗余（MVP 可能只需 plan_set + plan_clear）。
2. plan 嵌套 sub-plan 降级是否丢关键能力（plan-share-parent-child 测试现在测什么——若测嵌套则需调整断言为 object-scoped 共享）。
3. PlanStep/sub-plan 数据结构被别处（web diff renderer / persistence）引用的清理面。
4. self_view 段序（plan 置顶 vs todos 置顶）+ 与 L5a todos 段的结构协调。
5. compressPlanWindow 删除后，plan 在压缩态怎么呈现（自视切片本身已是精简态，可能无需压缩）。
