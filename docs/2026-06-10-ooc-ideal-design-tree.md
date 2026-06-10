# OOC 理想设计全貌（v2：Core 闭环优先，2026-06-10）

> 性质：理想 OOC 的完整形态陈述，最终对照基准。
> v2 修订：经第二轮 grill 与一次根本纠偏重构——**OOC 是少数简单设计的叠加，丰富的智能从叠加中涌现，不是机制的堆砌**。本版把真正的 core 闭环提取在前，权限/跨对象评审/健壮性等次级工作单独排在 core 之后。
> 姊妹文档：[审计报告](./2026-06-10-cognitive-audit-report.md)（问题事实）/ [理想机制设计](./2026-06-10-ideal-design.md)（机制推导 + 两轮 grill 定案）。

---

## 总信条

1. **简单叠加，涌现智能**：core 是六个简单设计的叠加；每个单独看都平平无奇，叠加在一起让 LLM 能为自己维护知识、实现能力、与用户互动——智能来自涌现，不来自框架的聪明。
2. **LLM 足够聪明**：框架不替 LLM 决策、不替它兜底、不防着它。框架的全部职责是把世界整理成 LLM 能看懂、能操作、能改写的形态。
3. **写入自由，合入设闸，失败响亮，事后治理**：边缘处零拦截零兜底；core 的硬闸门**只有两道**（知识写入 gate、evolve 合入闸）；其余位置只设信号不设闸门；保护性机制让位于可观测与事后治理。

---

# Part I — Core：OOC 闭环

## C0 一切是对象

**系统里任何东西，要么是一个 Object，要么是 Object 之间的一条关系。**

- 一个 Object = 五件套（self.md 身份 / readable 名片 / executable 方法 / visible UI / knowledge 知识）+ 运行起来的 thinkloop。
- **ContextWindow = Object 出现在 context 中的形态**：既是信息展示单元，又是行动挂载点。Context 是视角不是归属——同一对象可出现在多个 thread 的 context，状态只存一份。
- **user 也是一个 object**：人不是系统外的特殊存在，是对象图中的一员。
- **万物隐式继承 root**：任何对象天然拿到 talk / do / plan / todo / program / open_file / write_file / glob / grep——一出生就会思考、行动、协作、写文件。

这一条免费买到三件事：人机对话 = 对象间对话（同一套 talk）；GenUI = 对象的 visible 件（同一套五件套）；上下文工程 = 对象引用表管理（同一套 window）。

## C1 思考-行动环（每一轮）

```
渲染对象引用表 → LLM 思考 → 调一个 tool 原语 → method 改变世界 → 窗口重新渲染
```

- **4 个 tool 原语固定**（exec / close / wait / compress），永不增加；一切新能力 = 新 method 或新对象。LLM 的世界接口恒定，能力无限生长。
- **意图先行，渐进披露**：method 平时只露名字和一句意图，不占 context；缺参 → 自动开表单 → schema 逐字段弹提示、知识随执行激活（像填电子表单，填哪项弹哪项的说明）；执行完，表单与知识自动回收。
- **context 由 LLM 自管**：compress 是它的决策。超预算 = 发送前本地失败 + 错误引导它自救（hard 阈值留物理余量保证引导可达）；屡救不应 → thread failed，失败响亮。**系统不兜底压缩**。

## C2 知识环（学习）

```
知识激活 → 行动 → 经验沉淀 → 下次激活 → 行为改善
```

- **双源**：seed（人类预置，stone，进 git）+ sediment（运行时自沉淀，pool，写就生效）。同名 sediment 覆盖 seed——后天经验修正先天设定。
- **按需激活**：`activates_on` 五类 trigger（object / method / object_id / intent / super），执行到哪、知识到哪；`audience: self | children | instances` 声明可被谁继承。
- **核心闸门 ①——知识写入 gate**：frontmatter 最小必填集（title / description / activates_on）缺失即 deny + 回灌模板。这是学习环的 A1 保证：沉淀必可被再激活，**死知识无法产生**，学习环永不静默断裂。gate 归 core 协议层，开放扩展字段留给格式创新。

## C3 演化环（自我改写）

```
session worktree 试穿新我 → 当场生效 → 写→测→改 → 满意 → evolve 合入 → 下个 session 的我已是新我
```

- **session 真相原则**：每个 session 是 stones/main 派生的 git worktree；session 内五件套读取（含 method 解析、UI 预览、shell env）一律指向 worktree——改身份、改方法、改界面**当场生效当场可测**（loader 按 mtime 自动刷新，零监听成本）。
- **session 内零拦截**：一切写（含改别的对象、建新对象）直接落 worktree，不做写时检查——session 即信任域，编辑自由优先。
- **核心闸门 ②——evolve_self**：身份进入 canonical 的唯一通道（super flow 里 commit + merge 回 main）。**git 是终极保险**：历史、回滚、追责全由 git 承担，框架不另造保险。
- **不 end 即放弃**：遗弃的 session 改动随 worktree 回收，这是写明的约定语义——end 时才有显式处置。

## C4 协作环（multi-agent）

```
talk/do 派消息 → 对方思考行动 → 回报落 inbox → 我被唤醒
```

- **协作即消息投递**：thread 间不共享内存，一切影响经 inbox/outbox——链路天然可观察、可回放。
- **回报必达**：投递 = inbox 目录 append-only 文件写（幂等、对方死活不影响写入成功）；`end({result})` 直接落 creator inbox，不经任何方法模拟；收尾动作（archive）归收方自治。
- **终态必传播**：callee done/failed，waiter 即刻收到通知（含原因）——「等一个死人」在 core 里不可表示。
- peer 平等（talk 只能说服）/ 父子层级（do fork 分身）/ 自我（target="super" 进自己的反思通道）——对象关系三轴跑在同一套消息机制上。

## C5 人机环（与用户互动）

- **同一对象，两个观众**：LLM 读 readable（给 AI 的 toString），人看 visible（给人的界面）——外观镜像对是 GenUI 的根。
- **类的脸即实例的缺省脸**：实例无自有 visible → 沿 class 链用类的组件按实例数据渲染（file viewer 服务所有 file 实例）；own 遮蔽 class；最终兜底 Stone fallback 自动名片。
- **控制面是翻译器不是第二状态源**：Web UI 只把 world/thread 既有状态译成人读界面；人发消息 = user object 的一次 talk——人机互动免费复用 C4。

## Core 小结

**六个简单设计 × 两道闸门，没有更多了。**

| 设计 | 一句话 | 涌现出 |
|------|--------|--------|
| C0 一切是对象 | 五件套 + 隐式继承 root | 统一的世界模型 |
| C1 思考-行动环 | 4 原语 + 渐进披露 | 无限能力、有限接口 |
| C2 知识环 | 激活↔沉淀 + gate① | 自我学习 |
| C3 演化环 | worktree 试穿 + evolve 闸② | 自我改写 |
| C4 协作环 | 消息必达 + 终态传播 | MultiAgent |
| C5 人机环 | user 是对象 + 外观镜像 | GenUI 与人机协作 |

9 维度是这六个环的**分析视角**（thinkable/executable 撑 C1，reflectable 撑 C2/C3，programmable/persistable 撑 C3，collaborable 撑 C4，readable/visible 撑 C5，observable 在环外旁路）；环是**运行视角**。两套视角描述同一个系统。

**检验标准**：Core 不依赖 Part II 的任何一项即可完整运转——一个只实现 Part I 的 OOC，已经是一个能学习、能自我改写、能协作、能与人互动的完整系统。

---

# Part II — 次级层（锦上添花，按需启用）

以下机制都是好的，但都不是 core 闭环的构成件。按启用动机分四组，每组写明「什么时候才需要」。

## II-A 健壮性 —— 系统变皮实（长跑/规模化时启用）

- **检活链与租约**：心跳 = 合法状态驻留（runtime 校验，waiting/LLM 在飞/queued 皆合法），检活沿等待链传递，环 = 死锁全环注入；长跑实体（job/form/worktree）租约化，orphan 周期 GC。
- **form 生命周期加固**：executing 租约超时翻 failed 可重试；close 留墓碑可恢复；constructor 注册期唯一性断言。
- **结果信封**：method 结果统一行级截断（保头尾 + 醒目标记 + 完整版落盘指针）。
- **job 队列落盘**：重启恢复 queued，僵尸 running 按租约回收；yield 即自入队。
- **evolve 冲突自愈**：rebase 冲突先文件级自动重放 → 真冲突由 super flow agent 自解（解自己身份的冲突是反思分内事）→ 解不了 defer。
- **观测数据预算**：loop debug 滚动上限、陈年 events 折叠、采样丢弃带计数标记。

## II-B 治理 —— 多方不信任场景（生产/多用户/外部 agent 入驻时启用）

- **permission 三档**（allow/ask/deny）+ 无人值守 deny-safe 降级；deny 档收自改方法集、越界写。
- **cross-scope 评审**：改别人子树/建新对象的合入转 PR-Issue 由 supervisor 决议（core 阶段 evolve 直接合入，git revert 兜底）。
- **rollback / resolve 治理端点**：人是 git 闸门的最终持有者。
- **观察者仪器**：debug/pause/global-pause/permission-decision 归观察者平面，agent 既不控制也不感知（旁路观测不改变行为）；agent 仅可在 super flow 读自己落盘的历史轨迹。
- **session 间身份隔离**（G1 标注的「暂时剔除」项归位处）：多方互不信任时，他者身份读 canonical、cross-object 改动降级为提案。

## II-C 生态 —— 规模化复用（对象数量/作者数量增长时启用）

- **class 完整体系**：用户自定义 class（`stones/<branch>/classes/`）、五件套全链文件级继承、own 快照 + 活继承 + 漂移检测（class 版本记录 + 过期提示，agent 自查自更）。
- **capability declaration**：业务能力声明一次、双面投影可达性兜底（agent method ↔ HTTP endpoint + 默认表单）；显式单面进登记表；观察者与治理平面不在其内。
- **extendable**：外部世界（飞书/notion/slack）按统一模板接入为 Window + dry-run gate，物理隔离不污染核心。
- **skills**：branch 级共享 / object 级私有的可复用操作模式，knowledge=被动激活、method=调用即执行、skill=主动选择。

## II-D 打磨 —— 体验（用户体感问题出现时启用）

- 多对一回报按来源分组渲染；displayName 派生失败双面提示；ooc:// 寻址；activity 全量快照与等待图渲染；loop Time Machine 与 window diff；move 窗口共享的版本语义与归还冲突显式化。

---

## 收束

OOC 的全部精妙在 Part I：**六个简单设计叠加，让足够聪明的 LLM 在一个能看懂、能操作、能改写的世界里，自己长出维护知识、实现能力、与人协作的智能**。Part II 的每一项都只回答一个问题——「系统更皮实/更安全/更可复用/更好看了吗」——它们调节的是工程品质，不参与智能的涌现。

设计裁决顺序因此固定：**任何提案先问「这是 core 闭环的构成件，还是 Part II 的哪一组」**——是构成件，按总信条三条检验；是次级件，排队等启用动机出现。实现与本文分歧时，要么改实现、要么经 grill 修订本文，不允许静默漂移。
