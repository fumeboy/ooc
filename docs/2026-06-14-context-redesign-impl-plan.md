# context.md 重设计 → 系统实现 计划（2026-06-14）

权威：`.ooc-world-meta/.../thinkable/knowledge/context.md`（11 条核心，已定稿）。本文是落地排程，跨轮续作用。
潮汐律：每个增量 = 文档对准 + 代码改造 + storybook 覆盖 + 退潮清理，绿色提交。冲突一律以 context.md 为准、自主裁决。

## ⚠️ Ground truth 实测修订（2026-06-14，二手 recon/summary 严重失真，以此为准）

逐项**直接核验**后，发现 context.md 主体设计**早已实现且全绿**（recon 99 万 token 与 session summary 多处过时/失真）：
- `OOC_TOOLS=[EXEC,CLOSE,WAIT]` **已 3 原语**，compress 经 exec 拦截。→ Inc A 纯文档退潮，**✅ 已完成**。
- **do→talk 合并已完成**：`windows/do/` **已不存在**；`AGENCY_METHODS={talk,plan,todo,end}`（**无 do**，我早前"含 do"的 grep 命中的是注释）；`windows/talk/` 已含 `fork.ts`/`method.say.ts`/`method.share.ts`/`isForkWindow`/`archiveForkChild`。→ Inc B **代码层早已完成**。
- **SharingState 已是 `readonly-ref`/`mutable-ref`**（`_shared/types/context-window.ts:142-156`，move=动作）。→ 引用模式重命名**已完成**。
- attention-tiering（creator 窗句柄 + 内容进 message 流 + 50 字缩略）已落（`attention-tiering.test.ts`）。
- storybook **无任何 `do` 残留**（recon 说的 tmNoDo/kbNoDo 是假的）。
- **唯一真未实现**：`class` 仍落盘（`flow-thread-context.ts:42/82`、`state.json`、`context-registry`），**无任何按视角动态算 class 的逻辑**（全是 `w.class===` 读取点）。→ 核心 2/7 的 class-dynamic 未实现。

实测绿基线：`check:tsc` 干净 / `bun test packages/@ooc/core` = **918 pass · 3 skip · 0 fail** / `test:storybook` = **63 pass · 0 fail**。

## 决断：Inc C（class-dynamic + thread-window 模型 + share-object）**延后**，与 builtin-as-objects 弧绑定

行使 /goal 授权的"质疑+自主调整"。理由：
1. **核心 7「不存 class」对 inline builtin-feature 窗（talk/todo/method_exec）不可独立落地**——它们没有独立 object，class 无 ooc.class 可推；要么持久化某 discriminant（等于换名字存 class，违背设计），要么靠脆弱的字段推断。**干净落地必须先有 next_todo #2「builtin context window 整成 ooc class/object」**（届时 class 从 refObjectId→ooc.class 推）。
2. **核心 9/10 的 thread-window 模型**（自己视角 thread window 句柄、creator 对话是其通道、无独立 creator 窗）= next_todo #1「thread 也当作 ooc object」的直接产物；当前代码用 creator 窗 + isCreatorWindow + attention-tiering **行为等价**地达成，重做属概念-命名重构、应随 thread-as-object 一起。
3. **核心 11 的 share-object**（传 object 引用、class 由对方 readable 算）依赖 #1 的 class-dynamic。
4. 只做"_ref 窗 strip class"这种半切会造成"部分窗存 class、部分不存"的**不一致半态**，比当前一致态更差（违反 #1 代码质量铁律）。

**结论**：context.md 主体设计已落地且绿；class-dynamic/thread-window/share-object 三者同属一弧，**正确的下一步是 next_todo #1/#2（thread/builtin as ooc object）**，在其上一次性、一致地落地这三条核心，而非现在抢做半态。本次 /goal 的"实现"=验证主体已达成 + 退潮文档对准 + 记录此弧。

## 增量序列

### Inc A — compress 3 原语（纯文档退潮）✅做中
代码已 3 原语。对准对象树文档（仍写"4 原语/compress 是 tool"）：
- executable/self.md（L7/15/23/55）、executable/knowledge/tool-primitives.md（整篇）、executable/readable.md（L1）、
  thinkable/self.md（L59）、thinkable/knowledge/thread-and-thinkloop.md（L41-46/L58）。
- 改：稳定原语恒 3 个 exec/close/wait；compress = window method（经 exec 调，与 file 窗 set_viewport 同类）。
- doc-drift：往 `scripts/check-doc-deprecated-drift.sh` FORBIDDEN 加"4 原语/compress.*tool"类精确模式。
- storybook 注释（executable.story.ts L5、executable tests.md L9/24）改 3 原语。

### Inc B — do→talk 合并 + share 迁 talk + 引用模式（大，派 sub-agent）
context.md 核心 9/11 + 迁移映射 3.7。
- 代码：删 `windows/do`（class/continue/move/init isCreatorSelf 二分）；`talk(target=自己 objectId)` ⇒ fork 子线程（isForkWindow）；
  agency 删 `do`（builtins/root AGENCY_METHODS、agent/self.md、object-registry _builtin/agent）；continue→say；
  do_window.move → talk 上的 share；SharingState `ref`/`lent_out` → `readonly-ref`/`mutable-ref`，move=动作；
  share 传 object 引用（非整窗冻结快照）。
- 文档：collaborable/self.md+cross-object-talk.md+inbox-outbox-delivery.md、thinkable/thread-and-thinkloop.md、
  executable/self.md+root-methods-and-forms.md+permission.md、readable/self.md。
- 测试：~19 处 do/do_window/continue/move 测试 reframe。
- 注意：creator window 模型（init.ts isCreatorWindow 注入/拒 close/reply 归属）→ "thread window 的 creator 通道"语义（与 Inc C 联动）。

### Inc C — class 动态算不持久化 + thread/talk window 按视角投影（大，派 sub-agent）
context.md 核心 2/7/8/9/10。
- 代码：`class` 从三处落盘移除（flow-thread-context.ts _ref+inline、flow-runtime-object.ts state.json、context-registry 间接）；
  hydrate 只还原 id+展示状态，class 留空；buildInputItems 渲染时由 readable 按 thread 角色(creator/peer/sub)算 class；
  thread window（自己视角句柄+内容进 message 流）vs talk window（他者视角 transcript+50 字缩略）。
- 同名陷阱：context 不持久化的是 window 投影 class（thread/talk）；class 维度 ooc.class（继承链）仍落 .flow.json，勿混。
- 文档：persistable/self.md、readable/self.md+window-method-and-display-state.md+two-faces-of-readable.md（补"按视角算 class"职责）、
  class/self.md（辨析两种 class）、observable/self.md（windowsSnapshot class 标注运行时算）、ooc-philosophy.md（视角参数去 decayMeta 加 class）。

### Inc D — storybook cases + 全量 verify
- 新增/改：thinkable/tests.md（context 核心判据：双投影/不存 class/attention/引用模式——当前最大空白）、
  collaborable（fork=talk self 形态）、executable（3 原语、去 do）、class（agency 反例 talk）。
- attention-tiering.scenario.ts（唯一 attention 观察 case，未进 gate）随新模型更新。
- gate：`bun run test:storybook` 0 fail + `bun run verify`（tsc/core/silent-swallow/deprecated/doc-drift/anchor-drift）全绿。

## 两套 story 体系（勿漏）
- gate：`stories/<cap>.story.ts`（9）经 `_control-plane.test.ts`。
- catalog：L0-L9 `*.stories.ts` 经 `_catalog.ts`。改 do/talk 两套都要扫。

## 长期路线（next_todo，保持兼容、非本次范围）
persistable 自定义（thread 作 ooc object 自带持久化）/ builtin context window 整入 builtins / reflectable(pr,reflect_request) 迁 builtins 留 index / constructor 单例·非单例 / thinkable·collaborable·reflectable 上提到 ooc agent（agent extends object）。
→ 本次 do→talk、class 动态都顺这个趋势，勿把能力钉死在 ooc object 基类层。
