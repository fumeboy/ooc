# OOC-4 L6a：relation 删除 → 自动注入（自视 relations 切片）

> ✅ **阻塞已解（L5c Phase C 完成 0b4a97ff）**：talk 塌缩后 **talks.json peers 可用**（`Object.keys(readTalks(ref))`）+ **window-free `deliverMessage` 已存在**（delivery.ts）。C1/C2 解法：
> - **C1（peer 集）**：relations 切片 peer 集 = `discoverStoneHierarchicalPeers`（siblings/children）**∪ talks.json peers**（含主导的 user/critic 等 talk peer）。**含 talk peers**才不丢 relation-window-edit-session.e2e（user）+ relation-write-on-talk.integration（critic）。
> - **C2（long_term deliver）**：relation_note long_term 用 **deliverMessage**（window-free，L5c 已落地）派 super——不再需 TalkWindow。
> 必处理（前次 review）：**H1** service.ts:135 `type==="relation"` 删 type 后 tsc-break + compress.ts:406 `w_rel_` 死逻辑；**H2** relation-derive.test 是**重写非 migrate**（talk-peer 派生 + peer_readme 测试整段删，改 renderSelfView relations 切片测试）；**M1** deriveRelationWindow 推的是 **RelationWindow 非 KnowledgeWindow**——删 deriveRelationWindow（synthesizer.ts:330-442）+ 调用点（:300-301）+ 废 shim（:444-459）+ synthesizer.ts:41 RelationWindow/TalkWindow import；**M2** web relation 渲染（RelationWindowDiff + registry.test「9 种」+ OtherRenderers.test）不在后端 gate，须连带改或显式 defer（注「9→8 种」）；**M3** meta relation_window DocTreeNode（:1680-1780 + sources 指向被删 windows/relation/ → 改指 self-view.ts/command.relation.ts）。
> **注**：L5c 仍保留 TalkWindow 类型（Phase D 才擦除），故删 RelationWindow 时确认 relation 不依赖 TalkWindow 擦除。

> 执行 sub-agent **不要自己 commit**。复用 L5a/b 自视切片机制 + L5c talks.json/deliverMessage。

**Goal:** 删 relation_window（每轮 derive 的 window type）+ deriveRelationWindow；改为 **siblings + stone children/ 自动注入自视 relations 切片**（spec §5.3，各 peer 走 readable.md + relations 文件）。relation.edit（window 方法）→ root 方法 `relation_note(peer, content, scope)`。

**关键解耦判定**：spec §5.3 relation 塌缩 = **siblings + children 自动注入**（**非** talk-peer 派生——那是旧 window 行为）。故 relations 切片 peer 集 = discoverStoneHierarchicalPeers（siblings+children），**与 talk 解耦**（不依赖 talk_window/talks 文件）。relation_note 的 long_term 走 deliverTalkMessage（talk/delivery.ts 模块，独立于 talk_window）。→ L6a 可独立于 talk（L5c）先做。

**Architecture（镜像 L5a/b）**：renderSelfView 加 `<relations>` 切片（移 deriveRelationWindow 的 per-peer 渲染逻辑进来，但 peer 集 = siblings/children）。relation.edit → root.relation_note。删 relation WindowType + RelationWindow + renderRelationWindow + RELATION_WINDOW_BASIC_KNOWLEDGE + editCommand + deriveRelationWindow + windows/relation/。

**基线**（L5b 后）：1094 pass / 0 fail / 3 skip，tsc 0。

---

## 设计决策
### D1 自视 relations 切片（peer = siblings/children）
renderSelfView 加 `renderRelationsSlice(thread)`：`discoverStoneHierarchicalPeers(selfStone)` → siblings+children peer 集；对每 peer 渲染（移自 deriveRelationWindow + renderRelationWindow）：
- `<relation peer_id=...>`：peer 的 readable.md（peer_readme，读 stones/<branch>/objects/<peer>/readable.md，截断 KNOWLEDGE_BODY_BYTES）+ self_long_term（pools/<self>/knowledge/relations/<peer>.md，exists 才渲）+ self_session（flows/<sid>/objects/<self>/knowledge/relations/<peer>.md，exists 才渲）。
- 空（无 siblings/children）→ 不渲 `<relations>`。
- 插进 `<self_view>`（与 plan/todos 段并列，定序：plan→relations→todos 或合理序）。

### D2 relation_note root 方法（替换 relation.edit）
ROOT_METHODS 加 `relation_note(peer, content, scope)`（B 类 root 方法，count 19→20）：
- session：`writeFlowRelation({baseDir,sessionId,objectId:self}, peer, content)`。
- long_term：`deliverTalkMessage` 派 super（复用 relation/index.ts 现 long_term 逻辑：构造 super talk message 请 super 写 pools/<self>/knowledge/relations/<peer>.md）。
- 返回值 + in-character knowledge（`internal/executable/relation_note/basic` >20 字符 + scope=long_term 时补 long_term 详情）。
- 〔注：spec §1 表说 relation「无 root 方法」，但 write 能力须存（session 写 flows + long_term 经 super sediment），故落为 root.relation_note；spec §4 的「write_file」不适用（relations 在 flows/pools 非 stones）。记此偏离。〕

### D3 删 relation_window（tsc 枚举）
- WindowType union 去 `"relation"`；删 `RelationWindow` interface + generateWindowId 前缀（`w_rel`）。
- 删 `registerWindowType("relation")` + `REGISTRY.set("relation")` 静态 seed + renderRelationWindow + editCommand + RELATION_WINDOW_BASIC_KNOWLEDGE + windows/relation/ 目录 + windows/index.ts import。
- 删 **deriveRelationWindow**（synthesizer.ts:330-442）+ 其在 collectExecutableKnowledgeEntries 的调用点 + 它合成的 relation KnowledgeWindow 逻辑（relations 内容现由自视切片直接渲，不再走 KnowledgeWindow）。
- tsc 枚举所有 `type:"relation"`/`RelationWindow`/`w_rel_`/deriveRelationWindow 引用补齐。

### D4 持久化迁移
relation_window 本就不持久化（每轮 derive），故无 thread.json 迁移问题（不像 todo/plan）。relations 文件（flows/pools relations/<peer>.md）不变（仍 read/write）。

---

## File Structure
```
src/thinkable/context/self-view.ts                # 改：renderSelfView 加 <relations> 切片（移 deriveRelationWindow 渲染逻辑）
src/thinkable/knowledge/synthesizer.ts            # 改：删 deriveRelationWindow + 调用点 + relation KnowledgeWindow 合成
src/executable/windows/root/command.relation.ts    # 新增：relation_note 方法（session=writeFlowRelation / long_term=deliverTalkMessage）
src/executable/windows/root/index.ts              # 改：ROOT_METHODS 加 relation_note + ROOT_KNOWLEDGE 表
src/executable/windows/_shared/types.ts           # 改：WindowType 去 "relation"，删 RelationWindow + 前缀
src/executable/windows/_shared/registry.ts        # 改：删静态 REGISTRY.set("relation")
src/executable/windows/relation/                   # 删：整目录（index.ts + types.ts）
src/executable/windows/index.ts                   # 改：去 import "./relation/index.js"
src/thinkable/knowledge/basic-knowledge.ts        # 改：scrub relation_window prose + window::relation 触发示例（若有，仿 L5b H2）
meta/object.doc.ts                                 # 改：method 表 + relation_window 描述/节点
# 测试迁移：relation-derive.test / relation-window.test / relation-write-on-talk.integration /
#   relation-window-edit-session.e2e / commands.test / commands-execution.test / context.test / 任何 relation_window 断言
```

---

## Task 1：自视 relations 切片
- [ ] self-view.ts 加 renderRelationsSlice（discoverStoneHierarchicalPeers → per-peer readable.md + relations 文件，移自 deriveRelationWindow）。插 `<self_view>`。
- [ ] 单测：有 siblings/children 的 thread → `<self_view><relations><relation peer_id=...>`；无→不渲。

## Task 2：relation_note root 方法
- [ ] 新建 command.relation.ts：relation_note（session/long_term，复用 writeFlowRelation + deliverTalkMessage）+ in-character knowledge。
- [ ] ROOT_METHODS 加 relation_note（count 19→20）；ROOT_KNOWLEDGE 表。

## Task 3：删 relation_window + deriveRelationWindow
- [ ] 删 windows/relation/、registerWindowType/REGISTRY.set、WindowType "relation"、RelationWindow、generateWindowId 前缀、windows/index.ts import。
- [ ] 删 synthesizer.ts deriveRelationWindow + 调用点 + relation KnowledgeWindow 合成（relations 现走自视切片）。
- [ ] tsc 枚举补齐。basic-knowledge.ts scrub relation prose + window::relation 触发示例（若有）。

## Task 4：测试迁移 + meta + 回归
- [ ] grep `type:"relation"`/RelationWindow/deriveRelationWindow/`method="edit"`(relation)/relation_window 的测试迁移：relation-derive.test（→自视 relations 切片断言）、relation-window.test、relation-write-on-talk.integration（relation.edit→relation_note）、relation-window-edit-session.e2e、commands.test（sorted toEqual 加 relation_note count 20 + per-method knowledge）、commands-execution.test、context.test。
- [ ] meta/object.doc.ts：method count→20 + relation 描述 + relation_window 相关节点/window-type list。tsc 该文件。
- [ ] `bun test src/`（0 fail）、`bun tsc --noEmit`（0）、`bun tsc --noEmit meta/*.doc.ts`、route-audit e2e。

---

## 验证 gate
- [ ] relations 自视切片：siblings/children 自动注入（peer readable + relations 文件）；无 peer 不渲。
- [ ] relation_note：session 写 flows relations；long_term 派 super。
- [ ] relation_window type 彻底删（WindowType 无 "relation"，windows/relation/ 删，deriveRelationWindow 删，tsc 0 残留）。
- [ ] bun test src/ 0 fail；tsc 0；meta tsc PASS；route-audit PASS。

## 开放点（feasibility review 核查）
1. relations 切片 peer 集 = siblings/children only（spec §5.3），不含 talk-peer——是否丢「与非 sibling/child 的 talk peer 的 relation 展示」（旧 deriveRelationWindow 含 talk peer）？这是刻意收敛还是丢功能？
2. relation_note 作 root 方法 vs spec「无 root 方法/write_file」的偏离——session relations 在 flows/、long_term 经 super sediment，write_file（stones/）不适用，root.relation_note 是否最faithful？
3. deriveRelationWindow 删除后，原合成的 relation KnowledgeWindow（body 含 long_term+session 两段）的消费者（有无别处依赖该 KnowledgeWindow）？
4. relation_note long_term 用 deliverTalkMessage——L5c talk 塌缩后 deliverTalkMessage 是否仍在（delivery 模块独立于 talk_window？须确认 L5c 不删 delivery）。
5. peer readable.md 读取的 branch 解析（stones/<branch>/objects/<peer>/readable.md 的 branch 来源）。
