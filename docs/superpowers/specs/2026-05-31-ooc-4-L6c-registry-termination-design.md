# OOC-4 L6c 设计：registry 终结 + 类型擦除

> 本 spec 基于 `ooc-l6c-scope-map` workflow（8 路并行 reader + 对抗综合，已核验 11 处 load-bearing 断言、剔除 reader stale claim）。Supervisor 已拍板 4 个开放点。驱动 L6c 的 plan 与分阶段执行。

## 0. 核验校正（地基，避免 scope 虚高）

reader 多处与现状不符，综合阶段已核验剔除：

- **L6c 类型擦除只剩 do + talk**。`todo`/`plan`/`relation` 早已塌缩为 root 方法（`root/command.{todo,plan,relation}.ts`），`WindowType` union（types.ts:20）无这三者，目录不存在。前端若有 todo/plan/relation 的 type key 是死代码，顺手清理非主线。
- **behavior.ts 无 resolveOnClose/resolveCompressView**（只有 renderXml/method/allMethods/basicKnowledge；文件头注释明写「onClose/compressView 仍走 registry，L4 排除」）。**接链是 L6c 新增工作，是真正前置**。
- **L6b 已落地**（render.ts:234 已 filter talk+do；root.do_continue/do_close 已存在）。L6c 在 L6b 绿态起步。
- **worker.ts 已 talks.json 权威**（:271-281），:283-293 仅过渡 fallback——TalkWindow 从 worker 移除 = 删 fallback 分支，非重写。
- **window-free `deliverMessage` 已存在**（talk/delivery.ts:112）。HTTP 入口改造是「换调用」非「造函数」。
- **`src/extendable/base/` 有 root/custom/command_exec/program/file/knowledge/search/skill_index proto；无 do/talk/feishu_chat/feishu_doc**——这是吸收分界的决定性证据。

校正后真实 scope：① onClose/compressView 接链（新增 resolver）② talk 类型擦除 ③ do 类型擦除（最复杂）④ registry 整体删 ⑤ command_exec→method_exec 改名 ⑥ root/custom/feishu proto 吸收边界 ⑦ 前端+测试清理。

## 1. Supervisor 拍板（4 个必决开放点 + 4 个默认）

### D1 — root/custom proto 吸收边界
**决策：custom 保留特例路径（不并入 base 链）；root 用 base/root proto（已存在）。**
- 理由：custom 的 `loadObjectWindow` 动态派生（Object 写 method，下一轮经 mtime 缓存即见，Proxy dispatcher 任意 key）是 OOC **自我迭代/元编程哲学的核心**。强制 chain 解析需 object `executable/index.ts` 显式 export 全部 method，会**杀死动态派生**。故 custom = object canonical proto 特例（self.ts:40-77 现有 loadObjectWindow 路径保留），不上 base 链。
- registry 删后 custom 的 renderXml/basicKnowledge 由 loadObjectWindow 直接提供（不经 getWindowTypeDefinition）。

### D2 — feishu_chat/feishu_doc plugin 边界
**决策：feishu_* 保留为独立 extendable plugin 注册机制（不进 base 链、不进核心 registry）。**
- 理由：base/ 无 feishu proto（证据）；feishu_* 是 extendable 集成 type（完整生命周期），哲学上**不构成 Object 的「自我」**（参 `extendable 是非能力维度` 拍板）。registry 删后，feishu_* 用一个**最小独立 plugin registry**（extendable 自管），与核心 window 解析解耦。
- L6c 实现：抽 `extendable/plugin-windows.ts` 持 feishu_* 的 renderXml；render/manager 对 extendable type 走 plugin registry 分支（少量、隔离）。

### D3 — share/move agent 入口去留
**决策：删 do_window.move 的 LLM 调用面注册；保留 applyInitialShare（fork 时 share_windows 糖）+ 内部 move 实现。不加 root.do_move。**
- 理由：keep-not-delete 一致；standalone 运行时 re-share 罕见，fork 糖覆盖常见场景；加 root.do_move 为罕见操作增 agent 表面不值。

### D4 — command_exec 持久化兼容
**决策：graceful 迁移（readThread 读旧 form.command → 写 form.method → 丢 command），仿 thread-json.ts:109 status 迁移。**
- 理由：dev 无生产数据，无长期双字段包袱。

### 默认（无需长 brainstorm）
- **D5** compressView skip 测试（p0c-typed.test.ts:257,349 do/talk describe.skip）→ L6c-7 直接删，compressView 行为迁 behavior 链测试。
- **D6** do_window 保留为内部 interface（type guard 从字面量 `w.type==='do'` 改 interface guard；helpers/deliver 仍用）。
- **D7** assertAllRenderHooksRegistered/CHAIN_PROVIDED_RENDER/markRenderXmlViaPrototype 随 registry 整体删（L6c-4）；boot 保护由 behavior 等价测试 + 运行期 stat-before-import 兜底。
- **D8** thread-json.ts listRegisteredWindowTypes 改内联硬编码已知 type Set + migration warning（graceful skip 旧 talk/do 数据）。

### compressView ↔ L8 visible 解耦判定（重要）
compressView **chain 解析（lookup 位置 registry→behavior 链）** 与 **compressView 渲染逻辑重做（L8 visible 改 hook 做什么）** 正交。L6c-1 只移 lookup（机制），不改逻辑；L8 改逻辑。故 **L6c 不被 L8 硬阻塞**，registry 删（L6c-4）可在 L6c 内完成。MEMORY「Inc3 client→visible 同做」指的是 naming+渲染逻辑，非 hook lookup 机制。

## 2. 依赖排序 DAG（硬阻塞边）

```
L6b 绿态（render-skip do/talk + root.do_continue/do_close）✓
   │
   ├── L6c-5 command_exec→method_exec 改名（正交，无依赖）
   ├── L6c-6 proto 吸收（D1/D2 已拍板，代码可并行）
   │
   └── L6c-1 onClose/compressView 接链（新增 resolver + A 类脱 registry）
          │  ← 硬阻塞：onClose/compressView 还在 registry 时删 do/talk type 会让
          │     manager.close/render.compressView 对已删 type 抛 not-registered
          ├── L6c-2 TalkWindow 擦除（substrate 全就位；trail-blazer 易）
          └── L6c-3 DoWindow 擦除（tree+share 最复杂）
                 │
                 └── L6c-4 registry 删除（总收口）
                        │  ← 硬阻塞：8 个 getWindowTypeDefinition 消费点
                        │     + listRegisteredWindowTypes + registerWindowType 全迁走
                        └── L6c-7 前端 + 测试清理
```
**8 个 getWindowTypeDefinition 生产消费点**（L6c-4 收口前全改链/守卫）：render.ts:82(已有 fallback✓),154 / manager.ts:92,368 / permissions.ts:141 / self.ts:42 / synthesizer.ts:90,181 / api.list-window-types.ts:44,49。

## 3. 子增量拆分（每个独立保绿）

推荐顺序：**L6c-6(设计已定,代码) → L6c-5(改名热身) → L6c-1(接链前置) → L6c-2(talk) → L6c-3(do) → L6c-4(registry 删) → L6c-7(前端+测试)**。talk 先 do 后（易→难）。

| 子增量 | scope 摘要 | 依赖 | 风险 | 前端 e2e |
|---|---|---|---|---|
| **L6c-5** | command_exec→method_exec：form.command→form.method 字段（type 字面量 command_exec 不改）；37 处读写点 tsc 兜底穷举；thread-json graceful 迁移 | 无 | low（宽面易漏） | 触类型镜像 |
| **L6c-6** | feishu_* 抽 extendable/plugin-windows.ts；custom 确认 loadObjectWindow 特例路径不经 registry | D1/D2 | medium | 否 |
| **L6c-1** | ObjectWindowDefinition 加 onClose?/compressView?；behavior.ts 加 resolveOnClose/resolveCompressView；render.ts:159/manager.ts:368 改链解析；A 类 hook export 进 base、删薄壳 registerWindowType | L6c-6 | **high**（manager.close 同步→async 传染） | 否 |
| **L6c-2** | 删 union "talk"+TalkWindow export+talk/registerWindowType；service.ts HTTP 入口改 deliverMessage；init 删 creator talk_window；worker 删 fallback；end.ts 删 talk 分支；wait.ts 删 talk-window 候选 | L6c-1 | **high**（跨栈） | 是（F4/multi-turn） |
| **L6c-3** | 删 union "do"+DoWindow export+do/registerWindowType；filterMessagesForDoWindow→自视切片通用 do 消息查询；end.ts autoReplyAndArchiveDo 解耦 DoWindow 类型；保留 helpers/deliver/tree/scheduler | L6c-1 | **high**（tree+share） | 是 |
| **L6c-4** | 删 registry.ts 全文件 + windows/index re-export；8 消费点改链/守卫；thread-json 内联 type Set；分 2 commit（先消费点容错→再删函数） | 1∪2∪3∪5∪6 | **high**（assert 删失 boot 保护） | 间接 |
| **L6c-7** | 前端 do/talk 详情面板/diff renderer 删；registry.test 计数改；删 compressView skip 测试；multi-turn-followup talk filter 改 talks.json | L6c-4 | medium（selector 漂移） | 是 |

## 4. 风险热点 + de-risk

- **L6c-1（onClose 接链）最隐蔽**：`manager.close` 当前同步，onClose 同步调用；接 async resolver 会传染 async（或保留 registry 兜底则 close 不脱 registry → 阻塞 L6c-4）。**先验证 close 路径调用方是否全可 await**；不能则 onClose 接链需更大改造，compressView 部分可考虑 forward-look。**先补 behavior.test 等价测试（A 类 onClose/compressView 链解析 == registry 旧值）**。
- **L6c-2/3（类型擦除）跨栈/并发**：核验已收窄（worker 已 talks.json 权威；scheduler/childThreads 树/_parentThreadRef 持久化不涉 type）。**先跑绿三组回归基线 agent-to-agent-wait-wake / do-fork-and-collect / sharing 再动**。
- **L6c-4（registry 删）**：分 2 commit（先全消费点改容错保留 registry 跑全绿，再删函数隔离回滚）。
- **L6c-5（改名）**：改字段定义后 `bun tsc --noEmit` 让编译器穷举读写点。

## 5. 跨面冲突（同文件多面触碰，须串行勿并行 dispatch）

- **`service.ts`**：TalkWindow 入口 + DoWindow creator + extractTalkPeers——L6c-2 一次性改完（含 do creator 调整），勿分两批。
- **`render.ts`**：onClose/compressView(L6c-1) + talk/do filter(L6c-2/3) + getWindowTypeDefinition(L6c-4)——4 面碰核心渲染，**串行**。
- **`types.ts:20` union**：talk(L6c-2)/do(L6c-3) 各删一字面量同行——按顺序避 merge 冲突。
- **`manager.ts`**：onClose(L6c-1) + getWindowTypeDefinition(L6c-4) + form.command 改名(L6c-5)——改名可先做不冲突；接链+删 registry 串行。
- **`end.ts` findCreatorWindow**：talk(L6c-2)+do(L6c-3) 同函数 guard，talk 先 do 后。

## 6. 与「complete L6」的关系
L6c-4（registry 死）= L6 完成的标志。L6c-1~7 全绿后 L6 完整收官。本 spec 把 L6c 拆成 7 个独立保绿子增量，每个走 plan→feasibility review→执行→harness 回归 的纪律；high-risk 子增量（1/2/3/4）先补回归基线 e2e。compressView 与 L8 解耦已判定，L6c 不被 L8 阻塞。
