# OOC-6 能力维度索引

> OOC Agent 由 **8 个能力维度**组合而成（概念权威：`packages/@ooc/meta/object.doc.ts`）。
> 本目录为每个维度维护一份**能力迭代文档**：`docs/ooc-6/<dim>/<date>-iteration-NN.md`，
> 一次迭代一份，按时间追加。每份文档统一模板（维度定位 / 能力现状 / 本次迭代记录 / 边界与未决），
> 断言锚定真实代码 `file:行号`。本 index 是全局入口 + 状态盘点。

## 8 维度速览（迭代 01，2026-06-06）

| 维度 | 一句话定位 | 状态 | 本次迭代 |
|---|---|---|---|
| [thinkable 思考](./thinkable/2026-06-06-iteration-01.md) | 与 LLM 交互、构造 context、按 trigger 激活 knowledge、运行可并行可恢复的 Thread Tree 与单轮 thinkloop | 最小闭环 | window::root trigger always-on（修 reflectable 召回断裂：memory 只写不读） |
| [executable 执行](./executable/2026-06-06-iteration-01.md) | LLM 经 4 个稳定 tool 原语（exec/close/wait/compress）在 ContextObject 上调 Method 改变世界 | 最小闭环 | write/edit/program-shell 收敛到 session worktree |
| [collaborable 协作](./collaborable/2026-06-06-iteration-01.md) | Object 间以「消息 + 持续会话窗口」协作，跨 thread 影响必经显式 inbox/outbox（peer 平等轴） | 最小闭环 | inbox 拆 per-message 存储，根治并发回报丢正文竞态 |
| [observable 观测](./observable/2026-06-06-iteration-01.md) | thinkloop 周围加观测点，每轮 LLM 输入输出/tool/context 可记录可查可暂停可回放 | 最小闭环（人类面完整） | 可观测三件套：log-aggregator + /api/runtime/activity + harness 超时快照 |
| [reflectable 反思](./reflectable/2026-06-06-iteration-01.md) | 经受保护的 super session 改写自身身份文件与 sediment knowledge，下一轮自动生效的自我演化 | 最小闭环 | evolve_self 重做为「session worktree 即演化单元」 |
| [programmable 元编程](./programmable/2026-06-06-iteration-01.md) | Object 持有并演化自身自定义 ContextWindow + 命令表，写 executable/index.ts 即热更 | 最小闭环 | program shell $OOC_SELF_DIR 接入 worktree 统一模型 |
| [visible 可见](./visible/2026-06-06-iteration-01.md) | Object 持有并演化自身 UI 页面（stone visible/index.tsx + flow pages），人类经 HTTP callMethod 交互 | 最小闭环 | client-source-url endpoint 接入 worktree 预览 |
| [persistable 持久化](./persistable/2026-06-06-iteration-01.md) | 把身份/事实/产物落到 stone(持久+git)/pool(持久+不git)/flow(ephemeral) 三子树，离开内存可恢复 | 最小闭环 | stone identity 收敛到 session-worktree 统一模型（回收 plain overlay） |

## 本轮系统演化主线（2026-06）

两条横切主线贯穿本轮 8 维度迭代：

1. **session-worktree 统一模型**（横切 persistable / executable / programmable / reflectable / visible）：
   stone identity 的会话内试验层从 plain overlay 升级为「从 main lazy 派生的 git worktree 分支」。
   业务 session 改 self/executable/visible → 落 `stones/session-<sid>/`（完整副本，读写收敛同一目录、
   裸读可见），super flow `evolve_self` = commit session 分支 → ff-merge main → GC。五访问通道
   （write·edit·open / program-shell `$OOC_SELF_DIR` / loadSelf·object_stone_dir / visible endpoint）
   统一经 `resolveStoneIdentityRef`，plain overlay 已回收。设计权威：
   `docs/2026-06-05-stone-flow-overlay-versioning-design.md`；落地复盘：
   `docs/2026-06-06-worktree-and-observability-retrospective.md`。

2. **可观测增强**（observable）：由 harness programmable 反复 TIMEOUT「盲等」触发——
   log-aggregator 去重限流（370× 刷屏→限流计数）+ `GET /api/runtime/activity` 系统活动快照
   + harness 超时前抓快照。把「盲 TIMEOUT」变成「随时可诊断」。方法论（超时是 observability
   症状，应增强可观测而非干等）已纳入 harness 循环常设环节（`engineering.harness.doc.ts`
   `experience_sedimentation`）。

3. **class 一等继承抽象**（2026-06-07，横切 persistable / thinkable / executable·collaborable /
   visible）：把 `class` 提升为与 `object` 平级的一等概念、作为**唯一**继承机制（彻底剔除 prototype）；
   builtin = 类（`_builtin/<id>` 寻址、从框架包解析），world = 实例（`objects/<id>`，`ooc.class`
   继承）。`instantiate_with_new_world` 让 builtin class 在新 world 幂等实例化出可交互 object——
   supervisor 现在是真实例，自动加载 self.md 身份 + 全部 seed knowledge（经 class 链继承），不再靠
   LLM 即兴演角色；welcome 默认无门槛，移除 `withBuiltinTalkTargets` 过渡逻辑。详见
   [class-abstraction.md](./class-abstraction.md)。

## 跨维度未决（backlog 聚合）

各维度文档「边界与未决」的高价值跨切项：

- **[observable 中] stone executable 顶层 console 泄漏 server stdout**：ServerLoader 进程内
  `import()` 动态加载的 stone executable，其顶层 `console.log` 进服务端 stdout（未沙箱/未捕获）。
- **[executable/programmable 中] 自改命令集的边界与生效**：自改 `stones/<self>/executable/index.ts`
  无硬 deny（仅 metaprog/write_file 弱 ask）；命令集/readable 为全局 main-canonical，per-session
  改须经 evolve_self 合入 main 后重注册才生效。
- **[visible 中] agent-native parity 缺口**：`ui_methods` 仅经 HTTP 暴露给前端，agent 端无等价
  tool 路径（parity 公理下的显式技术债）；loop_timeline 的 agent 自查 server method 等价路径未实现。
- **[reflectable/observable 中] 写入期校验缺口**：sediment knowledge frontmatter 靠 LLM 自觉，
  写错仅 warn 跳过；csv-pool 不校验 row 与 header 一致——均缺写入期闸门。
- **[executable 中] compress tool 仅 scope=windows**：scope=events/auto 抛 not-implemented。
- **[persistable 低] abandoned worktree GC**：写后未 evolve 的 session worktree 仅 evolve_self
  路径回收，长跑可能堆积。

## 跨维度分析

- [self-iteration-frontier.md](./self-iteration-frontier.md) —— OOC 设计哲学 + 是否足以「运行 OOC 迭代 OOC 源码」：
  层次 A（Object 自我迭代）已闭环；层次 B（框架自我迭代）尚不成立，三缺口（边界/重载/治理）+
  渐近路径（B 归约为 A）+ 最小 dogfooding 探针建议。
- [dogfooding-probe-design.md](./dogfooding-probe-design.md) —— 最小 dogfooding 探针实验设计：
  trivial 核心改动（activity 加 probeMarker）+ 5 阶段插桩协议 + 预判结果矩阵（断点定位三缺口）+
  可落地的确定性探针脚本。把"足以自我迭代"从断言变成有矩阵支撑的事实。
- [class-abstraction.md](./class-abstraction.md) —— OOC Class 一等继承抽象（横切变更记录）：
  builtin=类 / world=实例、剔除 prototype、`instantiate_with_new_world` 自动实例化、knowledge 经
  class 链无条件继承。supervisor 从「即兴演角色」变为「真实例化、完整加载身份+知识」。
  含动机→设计→实现(commit 链)→端到端验证→维度落点→未决(generality backlog)。
- [storybook/framework-design.md](./storybook/framework-design.md) —— 体系化系统端到端测试框架：
  把 storybook 升级为 OOC**统一能力目录**，每个能力（8 维度 + class）一个可运行 story，同时给
  **控制面确定性验证**（可 CI gate）+ **agent-native 过程可见演示**（真 LLM）。收编 harness playbook
  场景、复用 e2e fixture/scoreScenario。Phase 1（9 特性 Tier A 全绿）已落；覆盖矩阵见
  [storybook/dashboard.md](./storybook/dashboard.md)。

## 文档约定

- **一次迭代一份**：下次某维度迭代写 `docs/ooc-6/<dim>/<date>-iteration-02.md`，不覆盖旧迭代——
  保留演化轨迹。本 index 的「本次迭代」列与状态随之更新。
- **统一模板**：维度定位（锚 object.doc 节点）/ 能力现状（file:行号）/ 本次迭代记录（动机→设计→
  实现→验证，锚 commit）/ 边界与未决。
- **接地**：源代码与文档分歧时信任源代码（CLAUDE.md）；概念权威是 `meta/object.doc.ts`。
