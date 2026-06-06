# OOC 自我迭代前沿分析（self-iteration frontier）

> 跨 8 维度的设计分析：OOC 的设计哲学，以及它是否足以「通过运行 OOC 迭代 OOC 源代码」。
> 维护：断言锚定真实代码 `file:行号`；这是 evolving 分析（非一次性复盘），随能力推进更新。
> 上游：`packages/@ooc/meta/object.doc.ts`（概念权威）、`engineering.harness.doc.ts:patches.bootstrapping`（dogfooding 目标）。

## 1. 设计哲学（统一命题）

OOC 的根本赌注：**OOP 是组织 LLM 上下文与 multi-agent 的正确隐喻**——曾经组织大型*软件*系统的纪律（封装/消息传递/反射/继承），也是组织大型*认知*系统的纪律。落成五个动作：

1. **封装即上下文边界**：Object 封装身份 / 方法 / 知识 / 界面；LLM "作为"某 Object 运行时看到有界自洽 context，而非铺开 prompt。
2. **窗口是感知与行动的统一单元**（最 novel）：`ContextWindow` 同时是 LLM 看到的（渲染 XML）和能操作的（窗口挂 command）。典型框架里 context 与 tools 是两套注册表；OOC 塌缩成一个对象——**看见某物即拥有作用于它的动词**。哲学核心。
3. **Object 间消息传递、非函数调用**：经 talk/do 窗口 + inbox/outbox 协作，不调对方函数、不共享内存（`object.doc.ts:1746`）。peer 轴只能说服不能支配——multi-agent 靠协商组合。
4. **自我修改是一等公民**（programmable + reflectable）：Object 在运行时改写自己的方法/身份/UI，带治理闸门（super flow `evolve_self`）。OOP 反射/元对象协议推到极限。
5. **持久化即身份连续性**：从 stone+pool+flow 重建的 Object 仍是"同一个"。worktree 模型把"试穿新自我 vs 已提交自我"做成 git 分支——身份有版本控制，自我演化是 commit+merge。

统一命题：**Agent 是自描述、自修改的 Object，其感知与行动统一在可调用 context-window 里，持久化身份，靠消息传递协作，经反思闸门演化自己。**

## 2. 自我迭代的两个层次（关键区分）

"通过运行 OOC 迭代 OOC 源代码"混了两件**范畴不同**的事：

- **层次 A — Object 自我迭代**：Object 改自己的 stone（self.md / 自己的 executable / visible）。Agent 作为 Object 演化自己。
- **层次 B — 系统自我迭代（真 dogfooding）**：Object 改 **OOC 运行时源码**（`packages/@ooc/core/...`）。框架改框架。问题真正问的是 B。

## 3. 层次 A：闭环成立 ✅（已验证）

write_file/edit → session worktree → super flow `evolve_self` commit+merge main → 下一轮新 thread 见新身份/新方法。stone executable 还能 mtime 热更（`packages/@ooc/core/runtime/server-loader.ts:21` 动态 import）。

证据：2026-06-06 persistable harness **Good**——agent 改 self.md→worktree→evolve_self（`packages/@ooc/core/programmable/evolve-self.ts:124`）→main→新 session 见新身份。层次 A 的循环真的能闭。

## 4. 层次 B：尚不成立 ❌——三个结构性缺口

| # | 缺口 | 锚点 | 说明 |
|---|---|---|---|
| 1 | **边界** | `packages/@ooc/core/executable/windows/_shared/session-path.ts:51` | OOP-native 写原语被 world-clamp（拒逃出 world 根）；OOC 核心源码在 world 之外的 repo，**没有被建模成 world 内可编辑的 Object**，OOP-native 路径够不着。唯一能碰的是 `program(shell)`（`executable/program/shell.ts:7` cwd=process.cwd() 不 clamp）——非 OOP、未沙箱的逃生舱。 |
| 2 | **重载（杀手）** | `packages/@ooc/core/runtime/server-loader.ts:21` | 热更只覆盖 *stone* executable（叶子、动态 import）。OOC **核心**进程启动时加载一次，改了不热更、必须重启。Object 改核心源码无法在自己运行的进程里生效——"改核心→看效果→再改"在进程内闭不上。 |
| 3 | **治理** | `packages/@ooc/core/programmable/versioning.ts`（scope/merge/rollback） | scope/merge/rollback 模型是 stone 形状的（self-scope ff-merge / cross-scope PR-Issue）。核心源码"无主"，没有哪个 Object 拥有它，scope 模型不适用。 |

与项目自陈一致（CLAUDE.md：dogfooding 是长期目标，短期 Claude Code 暂行，`stones/agent_of_X/` 尚未创建）。**反讽**：连迭代 OOC 本身都是用 Claude Code 当 Supervisor + sub-agent，不是用 OOC 跑 OOC——**dogfooding 一次都还没真正发生过**。

## 5. 元循环地板：B 是渐近的，不是布尔的

OOC 已有"自修改代码热更"的*范式*——programmable：stone executable 是叶子动态模块。它对 stone 成立、对核心不成立，仅因 stone 方法是**被 import 的**、核心是 **importer**。

closing B 的架构路径设计已隐含指向：**把越来越多框架行为推进 Object 拥有的、热更的 stone 方法里**，直到框架只剩薄内核——正是 `engineering.harness.doc.ts:patches.bootstrapping` 设想的"每个 AgentOfX 是有自己 stone 的 OOC Object"。

但有个**永远无法变成 stone 的硬内核**（加载 stone、跑 thinkloop、连 LLM 那部分）——bootstrap 循环。所以"完全自我迭代"是渐近线，与任何自举编译器一样有元循环地板。这不是缺陷，是反射系统的本性。

## 6. 统一洞察：B 可归约为 A

把 AgentOfX 的 stone 设成**框架源码的一个切片**（如 AgentOfThinkable 的 stone = thinkable 源码），层次 B 就归约为层次 A：「Object 迭代自己的 stone，只是这个 stone 恰好是框架源码」。**ownership = scope**，evolve_self / 治理模型直接复用。这也正是 bootstrapping patch 的愿景。

于是三缺口收敛为两个真问题：
- **(1) 边界**：stone 的领土能否是 world 外的框架源码？（world 布局问题）
- **(2) 重载**：核心能否自重载？（内核重启 affordance / 把核心模块化到可热更——把内核推到尽可能薄）

治理（3）随归约自动复用 A 的 scope 模型。

## 7. 判断

- **哲学上**：OOC 是*为*自我迭代而设计的，且哲学自洽到让 closing B 是延续而非违背。
- **工程上**：层次 A 成立且已验证；**层次 B 尚未闭环过一次**；三缺口都是与设计一致的工程前沿，非矛盾。
- **诚实的风险**：「自我迭代潜力」目前是断言多于证明。B 被闭合一次（哪怕一个 trivial 改动）之前，"足以自我迭代"未经检验。

## 8. 建议：把哲学问题变成经验问题

**最小 dogfooding 探针**：选一个 trivial 的框架改动，让一个 OOC Object 端到端走一遍（够源码→改→验证→重载生效→治理），看它**究竟在哪一步断**。预判断在 **#2 重载**（缺核心自重启 affordance）和 **#1 边界**（world-clamp + 核心非 Object）。一次失败的 dogfooding 比十页哲学更能定位下一个该建的能力。
