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

已完成：宪法（readable 第 9 维 + ooc4 架构概念）、目录归一 executable/✓ readable.md✓、**L2 原型链引擎**（commit 6dd10cf2，src/executable/prototype/）、**L3 builtin objects**（commit d5a840a7，作 src/extendable/base/<proto>/ 源码、非 world、loadBuiltinRegistry 经 import.meta.dir 扫描入 L2 registry）。tsc 全仓 0 error。

本次目标：实装 **L4.0 — `command`→`method` 术语归一**（L4 设计 spec §4/§12 第一子增量）。三层同步改、行为不变：①内部符号（CommandTableEntry→MethodEntry / commands→methods / lookupCommandEntry→lookupMethodEntry / command-types.ts→method-types.ts / ROOT_COMMANDS→ROOT_METHODS）②form 原型 command_exec 是否随改 method_exec（agent-facing + base dir 改名）③**agent-facing 协议**（LLM emit 的 open(window, command, args) 的 command arg + 所有 knowledge 文本里的「command」措辞→「method」）。**凡 LLM 按字面 emit 的都 load-bearing、unit test 测不到、只在 harness 暴露**——必须三层同步，半改是陷阱（readme→readable 教训）。L4.0 后续是 L4.1（核心机制 + skill_index 端到端）/L4.2（转写其余 6 A 类）/L4.3（method 可见性）。

按这个节奏走，不要跳步：
1. 用 superpowers:brainstorming 对齐 L4.0 开放点（command_exec 是否改名、agent-facing 字面量穷举清单），落 plan 前确认根决策。
2. 用 superpowers:writing-plans 写 implementation plan，存 docs/superpowers/plans/。
3. plan 写完**先派 feasibility reviewer 对抗式审查再执行**（硬纪律——每轮都抓 2+ Critical；尤其穷举 seed/knowledge/协议里的字面 command）。
4. 执行：sub agent 派单（CLAUDE.md Supervisor 模型），派单 prompt 末尾注明「不要自己 commit」，由你整合提交；commit 带 co-author footer。
5. harness 回归：bun test src/ 全绿（**当前基线 1053 pass**）+ RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 跑 route-audit 等确定性 e2e + agent-facing 协议 e2e + 新能力补 e2e。
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
| ├ L4.1 | 核心机制：window.prototype + dir-based proto loader + resolveMethod/RenderXml/Readable/BasicKnowledge 沿链 + 热路径分流改写；最简原型 skill_index 端到端 + in-character 文件 + loadSelfInstructions 剥 frontmatter | L4.0 | ← **下一层** |
| ├ L4.2 | 转写其余 6 A 类（program/search/file/knowledge/**command_exec→method_exec**（含 type 字面量+目录+canonical id 改名）/custom）behavior + in-character 文件 | L4.1 | 设计就绪 |
| └ L4.3 | method 可见性 public/for_ui_access + dispatcher 鉴权 | L4.2 | 设计就绪 |
| L1 后半 | readable.ts 动态函数（renderXml 泛化为 per-object，headline 能力） | L2 | |
| L5-6 | B 类塌缩（talk/do/todo/plan→owner 字段；relation 删除→auto 注入）；registry 彻底删 | L4 | |
| L7 | context/ 物理树（window 状态迁出 thread.json） | L3 | |
| L8 | visible 渲染重做 + client→visible 改名（一起做；Inc 3 plan 留有 C1-C3/H3 输入） | L2/L3 | |

> onClose / compressView 的沿链解析、registry 彻底删除均不在 L4（onClose/compressView 仍由收缩 registry 服务；registry 删 = L6 B 类塌缩后）。

### 切层时更新本文
完成一层后，把该层标 ✅、「下一层」箭头移到后继层，并把发起提示词里的「本次目标」段替换为后继层的设计要点（参考宪法对应节点 / spec 对应段）。L4 要点：spec §4（方法可见性）+ §5.1（A 类迁移）+ 接活路径——把 L2 的 `resolveAlongChain` 真正接进 render/command dispatch，用 L3 物化的 builtin registry 兜底。
