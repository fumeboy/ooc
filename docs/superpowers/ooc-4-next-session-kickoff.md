# OOC-4 续作：新会话发起指南

> 用途：在新的 Claude Code 会话里继续 ooc-4 的架构层实装。当前已完成「宪法 + executable/readable.md 两个目录归一增量」，剩余是 L2-L8 架构层。
> 维护：每完成一个架构层，更新本文「下一层」与发起提示词里的层号。

---

## 直接复制下面这段作为新会话的第一条消息

```
分支 ooc-4。先读这五份建立上下文，再开工：
1. docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md（伞 spec，L0-L8 全貌）
2. docs/superpowers/specs/2026-05-30-ooc-4-L4-live-prototype-resolution-design.md（**L4 设计 spec**，已 brainstorm 定稿：活路径 prototype-chain 解析 + command→method 归一 + method 可见性；含 L4.0-L4.3 拆分与开放点）
3. meta/object.doc.ts 的 root.patches.ooc4_object_model（4 子节点 prototype_chain/ab_classification/context_tree/method_visibility，权威概念锚点）
4. docs/superpowers/ooc-4-next-session-kickoff.md（本指南：进度、roadmap、纪律）
5. 你的项目记忆 project_ooc4_direction_increment1.md + feedback_agent_facing_voice

已完成：宪法 + 目录归一 + **L2 原型链引擎**(6dd10cf2) + **L3 builtin objects**(d5a840a7) + **L4.0 command→method**(52beb485+7ecd71bf) + **L4.1 活路径机制+skill_index**(53ccb737) + **L4.2 A 类 method+转写**(a912d7f2) + **L4.2c windows→base 搬迁**(c499a8e5) + **L5a 自视切片机制+todo 塌缩**(b538d6ae) + **L5b plan 塌缩**(52d5b9b5) + **L5c talk 塌缩 A+B+C**(edf920b2+0b4a97ff) + **L6a relation 塌缩**(4d1b3480) + **L6b do 塌缩**(本次)。tsc 全仓 0，bun test src/ **1078 pass/0 fail/3 skip**，后端 e2e（do reload-crossing 安全网 + agent↔agent + route-audit）全绿。机制详见 project_ooc4_direction_increment1。

**B 类塌缩进度**：todo✓ plan✓ talk✓ relation✓ do✓——**5 个 B 类全部 agent-facing 塌缩完成**（owner flow 文件 + renderSelfView `<self_view>` 切片 + root 方法 + render-skip 范式立住）。**剩 L6c registry 终结**：talk/do 走 **keep-not-delete**（TalkWindow/DoWindow 类型 + renderXml hook + continueCommand/filterMessagesForDoWindow + share/move + service.ts user 入口 + 前端 formatter 全保留作内部数据，L6c 才擦）。关键认知沉淀：跨 object 唤醒在 **worker.ts:syncCrossObjectCalleeEnds**（talk，已改读 talks.json）；do 是**同 object**（scheduler.emitChildEndNotifications 向下迭代 childThreads，reload 安全，不碰 worker）；do 的 child→parent 显式回报依赖运行时 `_parentThreadRef`，reload 后由 **readThread 在 persistable 层重建**（兑现 helpers.ts:52-53 契约）。

本次目标：**L6c registry 终结 + 类型擦除**。范围（综合 L5c Phase D + L6b keep-not-delete 残留）：①删 `getWindowTypeDefinition`/`WindowRegistry`（B 类塌缩后 per-type registry 已空壳）②**TalkWindow 类型全擦除**（service.ts 3 处 user chat 入口 + web/src/domains/chat/formatter.ts 迁 talks.json + creator talk_window 路由）③**DoWindow 类型 + renderDoWindow hook 擦除**（continueCommand/filterMessagesForDoWindow/share_windows/move 的 agent 面收编或删；do 的 share/move agent 入口迁移决策）④`onClose`/`compressView` 沿链解析（接 behavior.ts，脱离收缩 registry）⑤command_exec→method_exec 改名 + custom/feishu/root 原型吸收。**先读** L5-6 spec §5（registry 终结）+ L6b plan 的「review 消解表」（哪些 keep 到 L6c 擦）+ context-compression-p0c-typed.test.ts 的 talk/do compressView skip（L6c 擦 compressView 时一并清理：要么改直测 hook、要么随类型删）。

> command_exec→method_exec / custom 吸收 / L4.3 method 可见性 均 forward-looking，本就规划在 L6c 一并处理。L7（context/ 物理树，window 状态迁出 thread.json）会顺带根治 do 的 standalone-child 持久化 staleness（L6b 仅 readThread 重建 _parentThreadRef 覆盖主路径，truly-standalone 边缘靠 notify 兜底）。

按这个节奏走，不要跳步：
1. 用 superpowers:brainstorming 对齐 L5c 根决策（**worker.ts cross-object wake 怎么从 talks.json 读路由**=最关键 / callee 回信路由 talks.json[caller].targetThreadId / pairing 用 conversationId / talks.json routing-only vs message-log / 保留 TalkWindow 类型边界）。**这是并发核心，关键路径 agent↔agent wait/wake 无现有 e2e——务必先补双向 e2e 再改，否则 caller 卡死测不出。**
2. 用 superpowers:writing-plans 写 implementation plan，存 docs/superpowers/plans/。
3. plan 写完**先派 feasibility reviewer 对抗式审查再执行**（硬纪律——每轮都抓 2+ Critical；尤其穷举 seed/knowledge/协议里的字面 command）。
4. 执行：sub agent 派单（CLAUDE.md Supervisor 模型），派单 prompt 末尾注明「不要自己 commit」，由你整合提交；commit 带 co-author footer。
5. harness 回归：bun test src/ 全绿（**当前基线 1094 pass**）+ RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 跑 route-audit + agent↔agent wait/wake e2e（新补）+ 确定性 e2e。
6. 每改一个 meta/*.doc.ts 立刻 bun tsc --noEmit 验证。

两条贯穿纪律：①改持久层/加载器约定或 agent-facing 协议的增量先 feasibility review 再执行；②给新增 HTTP 路由在 tests/e2e/backend/route-audit.e2e.test.ts 补永久 gate。

注意约束：app server 启动必须显式 --world ./.ooc-world；harness 回归用全新 world dir（旧 .ooc-world + bootstrap 幂等会假绿）；测试 session 用 _test_<agent>_<timestamp> 前缀并清理；builtin/base 对象归 src/extendable/base/ 源码、绝不用 ensure 写 world；agent-facing 文件（self.md/readable.md/knowledge）用 Object 口吻、不写上帝视角实现旁白。
```

---

## 给人看的速览（不必粘进会话）

### 已完成
- 伞 spec + 宪法（`object.doc.ts`：readable 第 9 维 + `ooc4_object_model` patch 锁定全部架构概念）
- Inc 1 `server/`→`executable/`、Inc 2 `readme.md`→`readable.md`（均 plan→review→执行→harness 闭环，1018 src 测试绿）
- **L2 原型链 standalone 引擎**（commit `6dd10cf2`，`src/executable/prototype/`）：extends 解析 + ObjectRecord registry（重复/悬空/环三重拒载）+ 通用沿链 resolve（一套 walk 三 probe）。plan→review(GO)→执行→回归（1049 绿）闭环。
- **L3 builtin objects loader**（`src/extendable/base/<proto>/` 仓库源码 + `src/extendable/base/index.ts`）：8 原型骨架作 committed 源码（与 lark/ 同级 extendable 集成层，**不写 world、不碰 live startup**）+ `loadBuiltinRegistry` 经 `import.meta.dir` 扫描入 L2 registry；逻辑寻址保持 `ooc://stones/_builtin/objects/<p>`；L2 ObjectRecord ref→dir 泛化。plan→review(GO)→执行→回归（1053 绿 + route-audit live e2e 绿）闭环。 〔v1 曾用 ensure 写 world，经 Supervisor 纠正重构为源码方案，commit d5a840a7〕

### 架构层 roadmap（建议顺序）
| 层 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| ~~L2~~ | 原型链 extends 解析 + 共用链 resolve + 环检测 | — | ✅ 已落地 |
| ~~L3~~ | builtin objects loader（`src/extendable/base/<proto>/` 源码，root + 7 A 类原型骨架；逻辑寻址 `ooc://stones/_builtin/objects/<p>`） | L2 | ✅ 已落地（骨架源码；behavior 待 L4） |
| **L4** | 活路径 prototype-chain 解析 + command→method 归一 + method 可见性（设计 spec：`2026-05-30-ooc-4-L4-live-prototype-resolution-design.md`；Option A 拆 per-type registry，无永久 shim）。拆 4 子增量↓ | L2/L3 | 进行中 |
| ├ ~~L4.0~~ | `command`→`method` 归一（内部符号 tsc 兜底 + agent-facing 措辞 + exec arg key command→method + loader 硬切防静默丢命令），行为不变 | — | ✅ 已落地（Pass A 52beb485 + Pass B 7ecd71bf；保留 command_exec 字面）|
| ├ ~~L4.1~~ | 核心机制（renderXml + basicKnowledge 沿链 + skill_index 端到端 + in-character + loadSelfInstructions 剥 frontmatter）。**method 解析推迟 L4.2**（skill_index 无 method；避 refine 同步 async） | L4.0 | ✅ 已落地（commit 53ccb737；behavior.ts stat-before-import + 同步 chain-aware assert）|
| ├ L4.2 | A 类 method 解析沿链 + 转写 program/search/file/knowledge | L4.1 | ✅ 已落地（commit a912d7f2；method 消费点全接链 + refine/permissions sync→async）|
| ├ ~~L4.2c~~ | windows→base 实现搬迁（5 entity 原型 skill_index/program/search/file/knowledge 代码住 base，windows 退薄壳；共享 helper runtime/viewport 留 executable）| L4.2 | ✅ 已落地（commit c499a8e5；兑现「windows 大部分程序搬 base」方向）|
| ├ L4.2-tail | command_exec→method_exec 改名 + custom 吸收（forward-looking，当前无消费者）| L4.2 | 延 registry endgame（≈L6）|
| ├ L4.3 | method 可见性 public/for_ui_access（forward-looking，当前无跨 Object method 调用）| L4.2 | 延（按需）|
| └ L4.3 | method 可见性 public/for_ui_access + dispatcher 鉴权 | L4.2 | 设计就绪 |
| L1 后半 | readable.ts 动态函数（renderXml 泛化为 per-object，headline 能力） | L2 | |
| ~~L5a~~ | 自视切片机制 + todo 塌缩（todos.json + todo_* + `<self_view>`）| L4 | ✅ b538d6ae |
| ~~L5b~~ | plan 塌缩（plan.md + plan_set/clear）| L5a | ✅ 52d5b9b5 |
| ~~L5c A+B~~ | window-free deliverMessage + talks.json 路由 + **worker.ts cross-object wake 改读 talks.json**（并发核心拆险，additive）| L5b | ✅ edf920b2（安全网 e2e Good）|
| ~~L5c C~~ | talk agent-facing 塌缩（root.talk 合一 + 自视 talks 切片 + 删 say/wait/close/renderTalkWindow + wait.ts 重设计）| L5c-A/B | ✅ 0b4a97ff（安全网 e2e 仍 Good）|
| L5c D | TalkWindow 类型全擦除 + service.ts user 入口 + 前端 formatter 迁 talks.json | L5c-C | 延 L6c（类型擦除连 registry 死）|
| ~~L6a~~ | relation 删除→siblings/children+talks.json-peer auto 注入 + relation_note(deliverMessage)| L5c | ✅ 4d1b3480 |
| ~~L6b~~ | do agent-facing 塌缩（root.do_continue/do_close + 自视 active_children/parent_task 切片 + render-skip + wait 迁 childThreadId + readThread 重建 _parentThreadRef）；keep-not-delete（类型/hook/share/continueCommand 延 L6c）；同 object 不碰 worker | L6a | ✅ 本次（do reload-crossing 安全网 Good）|
| **L6c** | registry 终结（删 getWindowTypeDefinition + TalkWindow/DoWindow 类型擦除 + renderXml hook 删 + onClose/compressView 接链 + command_exec→method_exec + custom/feishu/root 收编 + service.ts/前端 formatter 迁移 + compressView skip 清理）| L6b | ← **下一层**（设计 spec §5）|
| L7 | context/ 物理树（window 状态迁出 thread.json） | L3 | |
| L8 | visible 渲染重做 + client→visible 改名（一起做；Inc 3 plan 留有 C1-C3/H3 输入） | L2/L3 | |

> onClose / compressView 的沿链解析、registry 彻底删除均不在 L4（onClose/compressView 仍由收缩 registry 服务；registry 删 = L6 B 类塌缩后）。

### 切层时更新本文
完成一层后，把该层标 ✅、「下一层」箭头移到后继层，并把发起提示词里的「本次目标」段替换为后继层的设计要点（参考宪法对应节点 / spec 对应段）。L4 要点：spec §4（方法可见性）+ §5.1（A 类迁移）+ 接活路径——把 L2 的 `resolveAlongChain` 真正接进 render/command dispatch，用 L3 物化的 builtin registry 兜底。
