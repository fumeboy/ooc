# OOC 系统认知工程审计报告（2026-06-10）

> 性质：体验官式深度审计复盘。5 个并行审计 Agent 下沉源码逐条验证（要求 file:line 证据），Supervisor 汇总裁决。
> 行号锚以 ooc-6 分支当日代码为准；个别推断标注「需复核」。
> 配套文档：[2026-06-10-ideal-design.md](./2026-06-10-ideal-design.md)（由本报告问题反射出的理想机制设计）。

## 0. 方法论

把种子问题泛化为四个**提问生成器**，对每个机制都问：

1. 这个知识/能力**从哪来**？
2. **边界上**行为是什么？
3. 承诺的**闭环真的可达**吗？
4. **不一致处**有无原则依据？

展开为 27+ 问，按 5 簇（thinkable 知识系统 / executable 行动协议 / collaborable+reflectable 闭环 / programmable+persistable 持久与演化 / readable+visible+class 外观继承 + observable+app 运行时）并行审计。

## 1. 两个种子问题的确切答案

### 1.1 child object 激活知识时是否包括 parent 的知识？

**分轨、且两轨语义相反**：

- **目录祖先链**（parent/child 嵌套）：**opt-in**——parent 知识必须显式 `inheritable: true` 才下传（`thinkable/knowledge/loader.ts:111-127`，严格 `=== true`）。
- **parentClass 链**（class 继承）：**无条件**全量下传，不查 inheritable（`loader.ts:129-146`）。
- **sediment**（pool 沉淀）：**不参与任何继承链**——parent/child 互不可见对方 sediment（`loader.ts:51-52`）。

设计理由（目录嵌套=域边界要隐私契约；class=类设计天然流向实例）只活在代码注释里；`knowledge-activation.md` 对 parentClass 无条件下传零说明；混合场景（一个对象同时有目录 parent 和 parentClass）无测试覆盖。

### 1.2 object 执行 method 时怎么知道参数？

参数知识链**四级递降**：

1. `ObjectMethod.schema`：args 不齐 → method_exec form，readable 渲染 `<schema>`（参数名/类型/描述）+ `<fill_state>`（provided/missing/invalid）+ `<next_steps>`（`builtins/method_exec/readable.ts:25-77`）。
2. `onFormChange` guidance window（`windows/_shared/manager.ts:83-104`）。
3. knowledge activation（`method::<type>::<name>` trigger）。
4. 以上全无 → **纯靠方法名猜**。

两个硬发现：

- **schema 校验 fail-soft 不阻断**：invalid 仅标 fill_state，submit 照常执行（`manager.ts:235-242`）。
- **auto-submit 黑箱**：args 齐且不引入新知识 key 时 form 直接提交，LLM 看不到 form、无参数回显（`manager.ts:461-479`）。

## 2. 跨维度根因（40+ 条发现收敛为四类）

### 根因 A：「闭环靠 LLM 自觉」——承诺了闭环，没装闸门

| 闭环 | 缺的闸门 | 后果 |
|---|---|---|
| sediment 沉淀→下轮激活 | 写入期无 frontmatter 校验（loader 仅 warn 跳过） | 死知识，自演化静默断裂 |
| 业务改动→evolve_self 合入 | end 反思提醒是 hint 非 gate；无未合入堆积检测 | 改动湮灭在 session 分支 |
| context 超预算→compress | scope=auto 抛 not-implemented（`tools/compress.ts:372`）、emergency guard 已删、无最后防线 | 可直达 LLM 413 |
| 参数校验→正确执行 | schema fail-soft 不拦 submit | 无效参数照常执行 |
| 大结果→截断 | 仅 program 有 4KB 硬闸（`program/format.ts:1`） | 自定义 method 可打爆下轮 context |
| end({result})→父侧收到 | auto-reply continue 失败仅写子方 events，do_window 照样 archive（`method.end.ts:92-127`） | 父侧假死、零错误信号 |

### 根因 B：「双轨不同步」——同一资源两条路径各走各的

1. **自写方法试错环路断裂（最重）**：session 内 write_file 改 `executable/index.ts` 落 worktree，但 LLM `exec` 经全局 registry cached definition——loader 无 session-aware 路由（`runtime/server-loader.ts` 接口不含 sessionId）；且 **evolve_self 合入后无 registerStone 重注册**（HTTP 直写有，`modules/stones/service.ts:259-264`；evolve 路径无）。「写文件即热更」只对 program shell `$OOC_SELF_DIR` 成立。agent 写完方法当场测不了，合入了也要等重启/显式重注册。
2. **stone 高隔离 vs pool 零隔离**：身份有 worktree+evolve+PR-Issue 三重把守；sediment 业务 session 直接 write_file 进 pool **即写即全局生效**，不进 git、无 review、无回滚，且可写**别人的** pool（`persistable/pool-object.ts:54`，write_file 无 pool 闸门）。
3. **继承四轨不一致**：method ✓（`object-registry.ts:249`）、window method ✓（`:269`）、knowledge ✓（loader Step 1b）沿 class 链回退；**readable/visible 文件级不回退**（`renderers/xml.ts:192-208` 仅 registry 级）——继承类实例「能调父类方法、看协议知识，却渲染不出父类名片和 UI」。另 `self.callMethod` 不走 resolveMethod，sandbox 脚本调不到继承方法（`executable/object/self.ts:31-59`）。
4. **derived 窗口两套真相**：trigger 求值只扫 `thread.contextWindows`（`triggers.ts:177-237`），pipeline 派生窗口不可被 trigger 命中；budget overflow 摘要里的知识窗口是 synthetic id（`activator-windows.ts:24-28`），LLM 按 id 去 open 必然失败且无恢复指引。

### 根因 C：「无终态仲裁、无后台治理」——所有等待都可能变成永恒

- **wait 死等**：waiting thread 唯一唤醒条件 = inbox 增长（`scheduler.ts:96-108`），无超时、无心跳、无 callee-failed 检活——卡死的 callee 可冻结整棵 thread 树。
- **waiting 不可观测**：`/api/runtime/activity` 只看 job（`modules/runtime/service.ts:201-210`），waiting thread 完全不在快照内。与上一条叠加 = 死锁既会发生又看不见。
- **queued job 仅内存**（`job-manager.ts:29`），重启丢队列；running job 无超时降级；scheduler_yielded 续跑链路断在中间则 thread 卡 running 无人救。
- **GC best-effort**：evolve 分支删除失败仅 warn（`evolve-self.ts:177-184`）；orphan worktree 仅启动期 prune（`versioning.ts:748`）；loop debug 文件无上限无轮转（长跑数百轮可至百 GB 级，`debug-file.ts` 无任何配额）。
- **permission ask 无人值守永久阻塞**：ask → thread paused 等 HTTP decision（`thinkloop.ts:328-349`）；sub thread 触发 ask 时无人能 approve，无 fallback。

### 根因 D：parity 公理的兑现度

盘点出 **17 个 HTTP 端点无 agent 等价路径**：ui_methods `/call_method`（已知最大债）、pause/resume、enable/disable-debug 等 4 个、global-pause 3 个、resolve-pr-issue、rollback、client-source-url 等。反向 parity（compress / create_object / evolve_self 为 agent 独占）多数为合理非对称。结论：parity 不是一个缺口而是**一类**缺口，需一次性契约设计。

## 3. 高严重度问题 Top 10

| # | 问题 | 维度 | 证据锚 |
|---|------|------|--------|
| 1 | 自写方法 session 内不可测 + evolve 后 registry 不重注册 | programmable×persistable | `server-loader.ts:24-43`、`evolve-self.ts:133-175` 无 registerStone |
| 2 | sediment 零隔离 + 写入期无校验 + 可写他人 pool | reflectable×persistable | `pool-object.ts:54` |
| 3 | wait 无超时 × waiting 不可观测 = 死锁不可见 | collaborable×observable | `scheduler.ts:96-108`、`runtime/service.ts:201-210` |
| 4 | context 超硬阈值无最后防线 | thinkable | `compress.ts:372`、`thinkloop.ts:432` |
| 5 | end({result}) auto-reply 失败被吞、父侧假死 | collaborable | `method.end.ts:92-127` |
| 6 | permission ask 无人值守永久阻塞 | executable | `thinkloop.ts:328-349` |
| 7 | 未合入 worktree 改动湮灭无提醒 + GC best-effort | reflectable×persistable | `evolve-self.ts:177-184` |
| 8 | loop debug 体积无上限、queued job 不落盘 | observable×app | `debug-file.ts`、`job-manager.ts:29` |
| 9 | 继承四轨不一致 + self.callMethod 不走继承链 | class×readable×programmable | `xml.ts:192-208`、`self.ts:31` |
| 10 | parity 17 端点缺口 | visible×app | `app/server/modules/` 端点清单 |

## 4. 中低严重度发现（按维度）

### thinkable

- 混合继承（目录链 × class 链同 idPath 知识叠加）无测试覆盖（中）。
- `object::knowledge` 类自指 trigger 无检测，循环激活语言层未禁止（低）。
- intent hook 缺失时知识激活路径静默降级为方法名；form status 变化不重算 intent（中）。
- budget overflow 摘要行的 synthetic id 可被 LLM 误当可 open 对象，失败后无恢复指引（中）。
- show_description 态知识无「如何展开正文」的标准动作引导，open_knowledge 可发现性靠 LLM 先验（低-中）。
- KnowledgeProcessor 与 ActivatorProcessor 执行顺序、同 path 产出去重规则文档未定（低）。
- BudgetManager score 无得分分解输出，「为什么被排除」不可诊断（低）。

### executable

- form 卡 executing 无 watchdog/timeout，完全信任 method 作者 async 纪律（高）。
- 同 type 双 `kind:"constructor"` 行为未定义（取 Object.values 首个命中，无注册期断言）（中）。
- close 后 form 状态（accumulatedArgs/refine 历史/failed result）不可恢复；close 不校验未消费消息/executing form（高）。
- close 内 persistObjectAfterChange 异步不被 await，内存删除与磁盘更新可不一致（中）。
- auto-submit 无参数回显，result 为空时 LLM 无法确认（中）。

### collaborable / reflectable

- talk 多对一回报的归并展示语义未设计（self.md 已自列待办）（低）。
- do_window.move：ref 快照陈旧（owner 继续 live 演化）；move 归还单向覆盖、无版本号无冲突合并（中）。
- end 反思提醒仅在 end form open 且 msg 为空时注入，early-end 路径可能不触发（低）。
- `_parentThreadRef` 内存指针无 parent 重读逻辑，跨 worker 改动可致过期指针（中，需复核）。

### programmable / persistable

- nested objectId（含 `/`）的 self-scope 前缀判定代码正确（`versioning.ts:212-214` 用 nestedObjectPath），但 evolve merge 分类无 nested 测试（低）。
- worktree eager 全量 checkout，大 world 下 session 创建成本；rebase-conflict 返回后上层无处理策略（低）。
- data.json setData 经 serial-queue 串行（`flow-data.ts:75-95`）无 lost-update，但同 key last-write-wins 无警告、无 temp-file 原子写、无多 key 事务（低）。
- create_object 的 worktree 新对象：同 session 可读身份；其它 session talk 可建 flow 但读不到身份；`/api/stones` 不可见（stone-registry 只扫 main+builtin）（中）。
- 建对象权限：authorObjectId 不校验，全靠事后 PR-Issue（中）。

### readable / visible / class

- 整条 readable 链 miss 时返回诊断占位符（好设计）；但链部分失败（renderXml 抛错）被 `catch {}` 静默吞（中）。
- displayName 派生正则 `^#+\s+(.+)$`，self.md 第一行格式被 agent 改坏 → 静默降级 objectId 无提示（中）。
- self.md 快照漂移（class 升级后实例旧身份描述旧 API）无任何检测，运行时症状为 agent 反复试错 METHOD_NOT_FOUND（中）。
- `_builtin/<id>` 与 bare id 双目录语义（class 只读 / instance 可写）合理但易误导（低）。

### observable / app

- pause 只能在 LLM 返回后、tool dispatch 前生效；LLM 请求中无 abort；长跑 handler 运行中忽略 pause（中）。
- PauseChecker 与 permission-decision 是两套并行机制；多 ask 批量决议无协调（中）。
- resume 前置只查 status=paused 不查 llm.output.json 存在性，文件缺失会 crash（中）。
- 前端 4s 轮询 + waitForJob 同步等待，无 SSE；网络抖动下 UI 可见性间隙最大 ~8s（中）。文档「10s polling-job」与代码 4s 出入（需复核归一）。
- callee failed → parent 须等下轮 scheduler tick 才见 inbox 通知；lastError 在 resume 后不清空（中）。
- log-aggregator 采样丢弃无「已丢 ×N」对用户标记（低）。
- scheduler_yielded 过渡态对 activity 不可见（低）。

## 5. 立项建议（Supervisor 拍板）

- **P0「自演化闭环加固」**（合并立项）：① sediment 写入期 frontmatter gate + pool 写边界收紧（reflectable×persistable）；② 自写方法生效链修复——loader session-aware 路由 + evolve_self 后 registerStone（programmable×persistable）；③ 未合入改动检测——end 前 evolveSelfDiff 检查 + orphan worktree 周期 GC。
- **P1「等待与资源治理」**：wait 超时 + waiting thread 进 activity + callee failed 即时通知 parent；queued job 落盘 + running job watchdog；loop debug 轮转上限；context 硬阈值最后防线。
- **P2「一致性与 parity」**：继承四轨补齐（readable/visible 文件级回退 + callMethod 走 resolveMethod）；agent-native parity 契约一次性设计（17 端点分级）；ask 档 sub-thread 上浮/deny-safe。

按 harness 规约，本报告发现应回流各维度对象 self.md「已知问题」节，高严重度项落 e2e 场景。
