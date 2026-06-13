# 设计裁决：ContextWindow = 方法挂载点（第一公理）+ 三条收敛

> 2026-06-14 · Supervisor 裁决 · status: 方向已定，待分阶段实现（**勿直接在 main 上手术**）
> 上游：`docs/2026-06-12-…buffer-view-redesign.md`（被本裁决取代方向）；名词 grill 见 `tmp/context.md` + 会话记录。

---

## 0. 第一公理

> **ContextWindow 首先是「方法挂载点」；内容展示是可选的第二面，且同一份信息在 LLM input 里只渲染一次。**

之前（含框架现状）的隐含假设是"窗 = 一块内容 + 它的方法"。这是错的。窗的**主**身份是 method mount；content 是**可有可无**的另一面：

| 窗 | 内容渲在哪 | 窗体现什么 |
|---|---|---|
| file / knowledge / search / program | 窗内（切片/正文/历史） | 内容 + 方法 |
| **transcript** | 原生对话轮（窗外） | **只挂 compress** |
| **self（agent 自窗）** | instructions（self.md，窗外） | **只挂 agency** |

公理的两个直接后果：
- **窗可以没内容**（transcript / self）——空内容是对的，不是 bug。
- **窗不能没它该有的方法**——这正是 A 问题（self 窗 agency 未渲）的判据：内容空合法，方法空是缺陷。

一旦立住这条，下面三条收敛都是它的自然推论。

---

## 1. 推论一：do → talk（spawn 子线程 = talk 到一条新线程）

**`talk` 是唯一的"开线程 + 通信"动词；`do` 只是它的一个 target。**

证据（OOC 里已存在）：
- `super` 本就是 `talk(target="super")` = 开一条我自己的反思线程——"talk 到自我的新 thread"早已是模式。
- do 的回信路径：`end(result)` 内部 = 在 creator talk_window 上 `say` 一次——do 的返回通道本来就是 talk.say。

收敛后 target 分类（exec=同步、talk=异步开线程，比今天"do/talk 都模糊异步"更锐利）：

| 意图 | 动作 |
|---|---|
| 同步调一个在场对象的方法 | `exec(window, method)`（1 跳，不变） |
| 异步开线程并通话 | `talk(target=…)` |
| ├ 人 | `target=user` |
| ├ 兄弟对象 | `target=<peer objectId>` |
| ├ 工作分身（= 旧 do） | `target=self-new` |
| └ 反思分身（已存在） | `target=super` |

**删除**：`do` 原语、`do_window` 作为独立概念。
**降级为 talk arg**：`share_windows`。
**保留**：fan-out = 开 N 条 talk 通道；`wait(on=talk_window)`；creator-reply 协议（已是 say）。

## 2. 推论二：compress tool → window method（4 原语回到 3）

**compress 是"调整信息展示"，与 `set_viewport` / `set_transcript_window` 同类——是窗的方法，不是原语。**

证据：
- 每种窗早有"缩小自己"的方法（file/knowledge 的 `set_viewport`、talk 的 `set_transcript_window`）。
- `expand` **今天就是 exec 路由的伪方法**（`executable/tools/exec.ts` 拦截 `method="expand"`）。expand 是方法、compress 当 tool，不对称。

收敛：
- **稳定原语回到 3 个**：`exec` / `close` / `wait`（顺手消除 interaction-core "三原语" vs world-vocabulary "4 tools" 的矛盾——答案是 **3**）。
- compress 成为每种窗注册的 window method；没定义的窗用现有 `compressLevel` 机制做 default impl。
- **thinkable 职责缩小**为：容量检查 + 注入一句提示（"context X% 满，考虑 compress 这些窗"）+ **保留被动 relevance-budget 兜底**（LLM 不理提示也不爆；旧 `scope=auto` 本就未实现，无回归）。

## 3. 推论三：transcript → 只挂方法的窗（不渲内容）

把 context 里唯一"不是窗"的 transcript 收进唯一模型——但**只作句柄**：

```
<window id="transcript" class="transcript" status="open">
  <title>本 thread 对话与 tool-call 记录</title>
  <meta turns="N" approx_tokens="~X"/>
</window>
```
- `compress` 在 `<class name="transcript">` 声明（= 旧 `scope=events`，折叠旧轮）。
- **真实对话轮照旧原生渲染（role=user/assistant 轮）；窗本身不出内容**——否则同一份信息渲两次。

**守住的线（防过度抽象）**：transcript 窗只是 event log 多了 `id + compress + 一个 renderer`，**不是新抽象**；原生轮结构（LLM 训练所依赖）不动。

**连带一致性检查**：现有 creator talk_window 渲 `<transcript>`，而这些 `say` 又进原生 events——**可能已双渲**。实现时一并定清：每条信息在 LLM input 只出现一次，talk_window 与原生 events 谁渲对话、谁只留句柄。

---

## 4. 收敛后的最小模型

```
primitive:   ContextWindow（唯一；= 方法挂载点，内容可选）
原语:        exec(window, method) · close · wait          ← 3 个
开线程/通信: talk(target)  —— user / peer / self-new(=do) / super
缩容:        各窗的 compress 方法（含 transcript 窗）
框架职责:    thinkable 只做 容量检查+提示 + 被动 budget 兜底
```

LLM 心智：从「exec/close/wait/compress + do + talk + 一堆"X 窗" + 一个非窗 transcript」
→ **「我有一组窗；在窗上 exec 方法；talk 开线程；满了 compress 窗」**。

### 名词收敛（接上一轮 grill）

真正不可约的 primitive ≈ **Object(/Agent) · ContextWindow · class(+parentClass) · method · thread · knowledge · exec/close/wait**。其余按 grill 处置：
- **别名去掉**：身份=instructions=self.md、历史=transcript=events、环境=context。
- **relation 不是 window kind**：self/成员/peer/creator 是窗的**关系 tag**，不再当独立"X 窗"名词。
- **实现层不进 agent 词表**：pipeline/snapshot/renderer/budget/relevance、object-method vs window-method（LLM 不需区分）、ui_method、source=protocol|activator|explicit。
- **保留的合理新名词**：`_builtin/agent`、`root`、`ooc.members`(组合)、`agency`、`tool-object`——各编码 Object/Agent/HAS-A 的一个真实区分。

---

## 5. 这套收敛同时修掉的旧问题

- **A（self 窗 agency 不可见）**：公理重定义"窗可空内容、不可空方法"→ 问题缩小为单一明确缺陷；根因（`computeVisibleMethodSet` 不走 parentClass 链）必须修，让 self 窗 surface 继承来的 agency。
- **B（exec 缺省/方法挂哪 三个版本打架）**：随 do→talk + 公理回流 `interaction-core.md` / `world-vocabulary.md`（builtin + 对象树 seed）一次性统一。
- **C3（3 vs 4 原语）**：compress→method 后明确是 **3**。
- **C1（open_knowledge 双 class）/ C2（self 窗无 about）**：C2 由公理解释为"对的"；C1 顺手收。

---

## 6. 分阶段实现计划（每阶段 Tier A 确定性 + Tier B 真 LLM，可回滚）

> blast radius 跨 collaborable(do/talk) + executable(compress/exec) + thinkable(context 组装/transcript 渲染) + 多维测试，与拆 root god-object 同量级。**新建 feat 分支做，不在 main 上手术**；分支基 ooc-6/main HEAD。

- **S0 公理 + 词表回流**（低风险，先做）：把第一公理 + 名词收敛钉进对象树 `world-vocabulary` glossary；回流 `interaction-core.md` / `world-vocabulary.md` 的 exec-缺省/方法归属（顺带修 B）。
- **S1 修 A**：`computeVisibleMethodSet` 沿 parentClass 链合并方法；加 Tier A 断言「self 窗 window_classes 含 agency(do/plan/todo/end)」。**这步独立可先落**（不依赖大重构，且补回结构化 affordance）。
- **S2 compress → window method**：compress 降为各窗方法 + 默认 impl；thinkable 改容量检查+提示；删 compress tool（原语 4→3）；reframe compress 相关测试。
- **S3 transcript → method-only 窗**：events 包成句柄窗 + compress；核 talk_window/原生 events 不双渲；删 `scope=events`。
- **S4 do → talk**：talk 支持 `target=self-new` + `share_windows` arg；do/do_window 收编；reframe do 测试；creator-reply 不变。
- **S5 收尾**：全量 verify + Tier B 端到端 + 名词/文档终审 + 合并 PR。

每阶段独立可回滚；S0/S1 风险最低、收益即时，建议先行。

---

## 7. 边界与风险

- **过度抽象红线**：transcript 窗 = 句柄 + compress，**不得**膨胀成新抽象。
- **不双渲红线**：每条信息在 LLM input 只出现一次（transcript 窗、talk_window、native events 三者划清）。
- **target 语义红线**：`exec`=同步在场调用、`talk`=异步开线程，二者不可再混淆（这是 do→talk 的全部价值所在）。
- **prompt-cache / 兼容**：transcript 渲染方式变更影响每轮 LLM input 结构，须验证不退化对话质量。
