# OOC-4 续作：新会话发起指南

> 用途：在新的 Claude Code 会话里继续 ooc-4 的架构层实装。当前已完成「宪法 + executable/readable.md 两个目录归一增量」，剩余是 L2-L8 架构层。
> 维护：每完成一个架构层，更新本文「下一层」与发起提示词里的层号。

---

## 直接复制下面这段作为新会话的第一条消息

```
分支 ooc-4。先读这四份建立上下文，再开工：
1. docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md（伞 spec，L0-L8 全貌）
2. meta/object.doc.ts 的 root.patches.ooc4_object_model（4 子节点 prototype_chain/ab_classification/context_tree/method_visibility，是各架构层的权威概念锚点）
3. docs/superpowers/ooc-4-next-session-kickoff.md（本指南：进度、roadmap、纪律）
4. 你的项目记忆 project_ooc4_direction_increment1.md

已完成：宪法（readable 第 9 维 + ooc4 架构概念）、目录归一 executable/✓ readable.md✓（均过 harness 回归）。client→visible 已 DEFERRED 到 L8。

本次目标：实装 **L2 原型链（prototype chain）**——self.md frontmatter `extends:` 解析 + ObjectRecord registry + 方法/visible/readable 三者共用一套沿链 resolve（own 优先→沿 extends 向上→root 兜底）+ 循环检测（build registry 时拓扑校验，发现环拒载）。权威设计见伞 spec §3/§4.2 与宪法 prototype_chain 节点。

按这个节奏走，不要跳步：
1. 用 superpowers:brainstorming 把 L2 的开放设计点对齐（extends 解析位置、registry 数据结构、resolve 算法、与现有 src/executable/windows/_shared/registry.ts per-type 注册的过渡关系），落一份 plan 前先确认根决策。
2. 用 superpowers:writing-plans 写 implementation plan，存 docs/superpowers/plans/。
3. plan 写完**先派 feasibility reviewer 对抗式审查再执行**（这是硬纪律——前三轮 review 每轮都抓出 2+ Critical 漏改）。
4. 执行：能用 sub agent 派单就派（CLAUDE.md Supervisor 模型），派单 prompt 末尾注明「不要自己 commit」，由你整合提交；commit 带 co-author footer。
5. 程序开发完成后走 harness 回归：bun test src/ 全绿（基线 1018 pass）+ RUN_BACKEND_E2E=1 跑 route-audit 等确定性 e2e + 新能力补 e2e 场景。
6. 每改一个 meta/*.doc.ts 立刻 bun tsc --noEmit 验证。

两条贯穿纪律：①改持久层/加载器约定的增量先 feasibility review 再执行；②给新增 HTTP 路由在 tests/e2e/backend/route-audit.e2e.test.ts 补永久 gate（web 硬编码 URL 不走 endpoints.ts，是 e2e 假阳性盲区）。

注意约束：app server 启动必须显式 --world ./.ooc-world（否则污染源码树）；harness 回归用全新 world dir（现有 .ooc-world 有旧布局 + bootstrap 幂等早返回会假绿）；测试 session 用 _test_<agent>_<timestamp> 前缀并清理。
```

---

## 给人看的速览（不必粘进会话）

### 已完成
- 伞 spec + 宪法（`object.doc.ts`：readable 第 9 维 + `ooc4_object_model` patch 锁定全部架构概念）
- Inc 1 `server/`→`executable/`、Inc 2 `readme.md`→`readable.md`（均 plan→review→执行→harness 闭环，1018 src 测试绿）

### 架构层 roadmap（建议顺序，各自 fresh 会话）
| 层 | 内容 | 依赖 |
|---|---|---|
| **L2** | 原型链 extends 解析 + 共用链 resolve + 环检测 | — ← **下一层** |
| L3 | builtin objects loader（`stones/_builtin/objects/<proto>/`，A 类 7 原型） | L2 |
| L1 后半 | readable.ts 动态函数（renderXml 泛化为 per-object，headline 能力） | L2 |
| L4-6 | A-B 塌缩（talk/do/todo/plan→owner 字段；relation 删除→auto 注入） | L3 |
| L7 | context/ 物理树（window 状态迁出 thread.json） | L3 |
| L8 | visible 渲染重做 + client→visible 改名（一起做；Inc 3 plan 留有 C1-C3/H3 输入） | L2/L3 |

### 切层时更新本文
完成 L2 后，把「下一层」改为 L3，并把发起提示词里的「本次目标」段替换为 L3 的设计要点（参考宪法 `ab_classification`/对应 spec 段）。
