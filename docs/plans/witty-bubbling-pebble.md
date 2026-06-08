# Plan — Relation 升级为专属 window type + flow 层 + edit/scope

## Context

当前 OOC 把 "self 对某 peer 的 relation" 仅以 `knowledge_window(source="relation")` 的形式由 `deriveRelationKnowledge` 合成进 context（src/thinkable/knowledge/synthesizer.ts:268）。两个不足：

1. **类型贴标错误**：relation 是协作关系的核心载体，被混在通用 knowledge_window 里没有专属命令面；LLM 想更新 relation 只能通过文本 hint 调用 `write_file`，弱 prompt、易遗漏。
2. **只支持 stones/**：relation 文件硬编码到 `stones/<self>/knowledge/relations/<peer>.md`——这是**长期跨 session 认知**的位置。本 session 临时形成的 relation 没有可落地的归宿，要么不写、要么污染长期文件。

本计划：
- 引入 `relation` 这个新的 ContextWindow type（与 `talk` / `issue` / `knowledge` 并列）；
- 文件层增加 flow 层 relation：`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`；
- relation_window 注册 `edit` command，通过 `scope: "session" | "long_term"` 参数路由：
  - `scope=session`：直接写 flow 层文件（本 session 即时生效，不污染长期）；
  - `scope=long_term`：通过 talk-delivery 派一条消息给 super（self-reflection 分身），由 super flow 正常处理长期 relation 的编辑（即写 `stones/<self>/knowledge/relations/<peer>.md`）。

设计决策（已与 user 对齐）：
- 双层呈现：**单 window 合并 body**，两段 markdown 标题分别为 `## long_term (stones/...)` 与 `## session (flows/...)`，缺失的段显示占位提示。
- edit 语义：**整文件替换**（与 `write_file` 一致），不支持 patch。
- super 通道：**talk-delivery 直送**——优先复用 thread.contextWindows 中已有 `target=super` 的 talk_window；没有则在 edit exec 内构造一个**临时** TalkWindow 对象（不挂到 thread）调用 deliverTalkMessage。临时 talk_window 不污染长期 context，但 caller.outbox / callee 都会正常落盘。

---

## 变更范围（Critical Files）

### persistable 层（flow relation 文件 IO）

- **src/persistable/common.ts**：新增 `flowKnowledgeDir(ref: FlowObjectRef)` / `flowRelationsDir` / `flowRelationFile` 路径辅助。也可放到 flow-object.ts，保持与 stone-object.ts 对称即可。
- **新增 src/persistable/flow-relation.ts**（与 stone-object.ts 中 `readRelation/relationFile` 同形态）：
  - `flowRelationFile(ref: FlowObjectRef, peerId: string): string`
  - `readFlowRelation(ref, peerId): Promise<string | undefined>`
  - `writeFlowRelation(ref, peerId, content): Promise<void>`（mkdir -p 后写入）
- **src/persistable/index.ts**：re-export 上述三个 API。

### executable.windows 层（新 window type + edit command）

- **src/executable/windows/types.ts**：
  - `WindowType` union 增加 `"relation"`；
  - `generateWindowId` 的 prefix map 加 `relation: "w_rel"`；
  - 新增 `RelationWindow` interface：
    ```ts
    interface RelationWindow extends BaseContextWindow {
      type: "relation";
      status: "open" | "closed";
      /** 对端 objectId（去重 key）。 */
      peerId: string;
    }
    ```
  - 把 `RelationWindow` 加入 `ContextWindow` discriminated union。
  - 注释里说明：与 talk_window peer 同源；不持久化（每轮重派生），id 稳定为 `w_rel_<peerId>`。

- **src/executable/windows/registry.ts**：注册 `"relation"` 空契约（与 `"issue"` 同形态）。

- **新增 src/executable/windows/relation.ts**（**核心**，参考 src/executable/windows/issue.ts 结构）：
  - 注册 `edit` command：
    ```ts
    paths: ["edit", "edit.session", "edit.long_term"]
    match(args): args.scope === "session" → ["edit","edit.session"]; "long_term" → ["edit","edit.long_term"]; 否则 ["edit"]
    knowledge(args, formStatus):
      basic = "edit 用于更新本 relation_window 对应 peer 的 relation 文件。
              参数:
              - content: 必填,relation 文件完整正文（整文件替换语义）
              - scope: 必填,'session' | 'long_term'
                - session: 写 flows/<sid>/objects/<self>/knowledge/relations/<peer>.md（仅本 session 生效）
                - long_term: 派一条消息给 super flow,由 super 写 stones/<self>/knowledge/relations/<peer>.md（跨 session 长期生效）
              典型用法: open(parent_window_id='<rel_window_id>', command='edit',
                          args={ content: '...', scope: 'session' })"
      formStatus=open 且 content/scope 缺失 → 注入 input 提示
      scope === "long_term" → 追加 "long_term 路径详解" knowledge（说明会被转 super flow 处理）
    exec(ctx) → executeRelationEdit(ctx)
    ```
  - `executeRelationEdit`：
    - 校验 parent window type=relation；取 `peerId`、`content`、`scope`；
    - `scope === "session"`：调 `writeFlowRelation({baseDir, sessionId, objectId: self}, peerId, content)`，返回 `"[relation.edit] 已更新 session 层 relation flows/.../{peer}.md"`；
    - `scope === "long_term"`：
      1. 在 thread.contextWindows 找 `talk_window.target === SUPER_ALIAS_TARGET`；若没找到则构造临时 TalkWindow（id=随机、parentWindowId=root、target="super"、title="relation update"、conversationId=同 id、status="open"），**不**挂到 thread；
      2. 拼 content：`请把我对 \`${peerId}\` 的长期 relation（stones/${self}/knowledge/relations/${peerId}.md）更新为：\n\n---\n${content}\n---`；
      3. `await deliverTalkMessage({ caller: { thread, talkWindow }, content: composed, source: "talk" })`；
      4. 返回 `"[relation.edit] 已派送 long_term relation 更新请求到 super flow（callee thread: ${result.calleeThreadId}）。super 会写入 stones/.../{peer}.md。"`
    - 错误（IO / 缺 persistence / 派送失败）按 issue.ts 风格返回 `"[relation.edit] ..."` 文本。
  - 同时导出 `RELATION_WINDOW_BASIC_KNOWLEDGE`：说明 relation_window 的命令面（只有 edit）和典型用法。`registerWindowType("relation", { commands: { edit: ... }, basicKnowledge })`.

- **src/executable/windows/index.ts**：把 `relation.ts` 加入 side-effect import 列表（参照 issue.ts 是怎么被 register 的）。

### thinkable.knowledge 层（synthesizer 改造）

- **src/thinkable/knowledge/synthesizer.ts**：
  - 把 `deriveRelationKnowledge` 拆为两个 derive：
    1. **deriveRelationWindow**（新）：返回 `RelationWindow[]`——每个 peerId 一个，id=`w_rel_<peerId>`、status=open、不持久化；
    2. **derivePeerReadmeKnowledge**（重命名旧 readme 派生）：仍生成 `KnowledgeWindow(source="relation")`，仅 peer readme 部分（self relation 不再走 knowledge_window）。
  - 由于 RelationWindow 现在自带 edit 命令面，self relation 文件正文应该作为 knowledge 一并暴露给 LLM——通过 `basicKnowledge` 通道做不到（basicKnowledge 是 type 级常量）。两条路径：
    - **采用**：仍合成一个伴随的 `KnowledgeWindow(source="relation", path="...union path...")`，body 就是合并后的双层 markdown（long_term + session）。LLM 在 context 里同时看到 `relation_window`（带 edit 命令）和这条 knowledge_window（提供正文）。两者通过同一 `peerId` 隐式关联。
    - **替代**（评估）：扩 `RelationWindow` 加 `body` 字段，render 层为 relation type 注入 body 显示。更紧凑，但要改 render.ts。
    - **决定**：第一版走"采用"——伴随 knowledge_window；后续若发现 LLM 容易混淆再迁到 render 层注入。
  - relation knowledge_window 的 body 构造：
    ```
    ## long_term (stones/<self>/knowledge/relations/<peer>.md)
    <stone relation 内容>  OR  "(暂无;通过 relation_window.edit(scope='long_term') 写入)"

    ## session (flows/<sid>/objects/<self>/knowledge/relations/<peer>.md)
    <flow relation 内容>  OR  "(暂无;通过 relation_window.edit(scope='session') 写入)"
    ```
    每段独立 8KB 截断（沿用 truncateKnowledgeBody）。
  - 占位提示 `buildRelationPlaceholder` 删除或改为上述新格式。
  - `collectExecutableKnowledgeEntries` 里 `deriveRelationKnowledge` 调用拆为两个 push（RelationWindow + KnowledgeWindow）。

### 测试

- **新增 src/thinkable/knowledge/__tests__/relation-derive.test.ts** 更新覆盖（旧文件已存在，按矩阵改）：
  - 现有矩阵 4 种 readme×relation 组合 → 调整为 readme×stone_relation×flow_relation 8 组合（或保留 4 主组合 + 补 flow_relation 的关键差分）；
  - 新增断言：每个 peer 产出 1 个 RelationWindow（type=relation,peerId,id=`w_rel_<peer>`）+ 1 个伴随 KnowledgeWindow（source=relation,body 含双层 fence）；
  - super alias 仍跳过整组派生。
- **新增 src/executable/windows/__tests__/relation-window.test.ts**：
  - `edit(scope="session")` 落到 flow 文件；
  - `edit(scope="long_term")` 触发 deliverTalkMessage：caller.outbox 多出一条，callee thread 在 super session 创建/复用，写盘成功；
  - 已有 super talk_window 时复用其 id，不在 thread 多挂临时 window；
  - 缺 content / scope / 非法 scope 返回错误文本。
- **e2e（engineering.testing 覆盖）**：在 `tests/e2e/backend/` 添加 `relation-window-edit-session.test.ts`（直接调 Elysia handle 跑一轮 LLM 模拟）。frontend 改动若由后续 AgentOfVisible 触发，再补 frontend 用例。

### meta 文档

- **meta/object.doc.ts** `collaborable.children.relation_knowledge` 节点（行 876-899）：
  - title 调整为 "relation_window - peer 关系的专属 window type"；
  - content 重写：双层（long_term/session）+ relation_window.edit(scope) 命令面 + 派 super 路径；
  - sources 锚定 `src/executable/windows/relation.ts` + `src/thinkable/knowledge/synthesizer.ts:deriveRelationWindow`；
  - 改完立刻 `bun tsc --noEmit meta/object.doc.ts` 验证。
- **meta/object.doc.ts** `persistable.stone` 节点提到 relations/ 的地方补一句"另有 flow 层 relation 见 collaborable.relation_window"。

### web 前端（评估为主，按需改动）

- **web/src/app/layout/RightPanel.tsx / ThreadHeader.tsx / ContextSnapshotViewer.tsx**：现在 git status 已有改动（与本任务无关）。新 `relation` window type 会出现在 ContextSnapshot 中。
  - 评估问题：默认渲染分支若 fall through 到 generic window block，UI 不会崩，但 type label 显示 "relation" 缺图标。
  - 决定：本计划**不**主动改前端；由 AgentOfVisible 在评估后单独决定是否补 RelationWindow 的专属 chip / icon。后端 contextSnapshot 输出本身天然带 `type: "relation"`，前端 fall through 不影响功能。

---

## 复用清单（不要重复造轮子）

| 复用对象 | 位置 |
|---------|------|
| `StoneObjectRef` / `FlowObjectRef` / `deriveStoneFromThread` | src/persistable/common.ts |
| `readRelation` / `relationFile` / `relationsDir` | src/persistable/stone-object.ts |
| `SUPER_ALIAS_TARGET` / `SUPER_SESSION_ID` / `isSuperSessionId` | src/executable/windows/super-constants.ts |
| `deliverTalkMessage(input)` + 临时 TalkWindow shape | src/executable/windows/talk-delivery.ts |
| `registerWindowType` + `WindowTypeDefinition` | src/executable/windows/registry.ts |
| `truncateKnowledgeBody` / `KNOWLEDGE_BODY_BYTES` | src/thinkable/knowledge/synthesizer.ts 已有内部函数（私有，将复用） |
| `WindowManager.insertTypedWindow` | src/executable/windows/manager.ts（若新代码要挂 window 时复用） |
| 测试基础设施（mkdtemp + writeFile 矩阵） | src/thinkable/knowledge/__tests__/relation-derive.test.ts 现有 fixture 模式 |

---

## 角色派发（harness）

- **Supervisor（主会话，本计划）**：拍板设计 + 派单 + meta 文档更新 + tsc 校验。
- **AgentOfCollaborable + AgentOfExecutable + AgentOfPersistable（合成 sub agent）**：实施所有 src/ 改动 + bun:test 单测。**单一 general-purpose sub agent**，prompt 内嵌完整设计 + 文件锚点 + reuse 列表；约束自验证 session 必须用 `_test_relation_<ts>` 前缀。
- **AgentOfVisible**：在后端落地完成后单独评估前端是否需要 RelationWindow chip / icon。若需要再发第二个 sub agent prompt。
- **AgentOfExperience**：实施完毕后跑一遍 backend e2e（已写的用例）+ 一轮真实 talk → 验证 LLM 看到 relation_window 后能正确发出 edit。

---

## 验证（end-to-end）

1. `bun test src/thinkable/knowledge/__tests__/relation-derive.test.ts` ——派生矩阵全绿
2. `bun test src/executable/windows/__tests__/relation-window.test.ts` ——edit 双 scope 全绿
3. `bun tsc --noEmit` ——全仓 type-check（types.ts union 改动会触发 exhaustive switch）
4. `bun test tests/e2e/backend/relation-window-edit-session.test.ts` ——backend e2e
5. `bun tsc --noEmit meta/object.doc.ts` ——meta 文档校验
6. 手动跑一轮: 启动 app server `--world ./.ooc-world-test`,在 web UI 创建一个 `_test_relation_<ts>` session,发起 talk → 看 contextSnapshot 出现 relation_window；触发 edit(scope=session) → 看 flows/.../relations/ 文件落盘；触发 edit(scope=long_term) → 看 super flow 收到一条 inbox。
7. 自验证完毕清理 `_test_relation_*` session 目录（engineering.harness § test_session_hygiene 强制要求）。

---

## 不做的事（明确划界）

- **不**支持 patch / append edit 语义——第一版整文件替换；后续若有强需求再加 ops。
- **不**自动创建持久 super talk_window——edit(long_term) 使用临时 talk_window，避免 contextWindows 多出一个常驻通道。
- **不**改 render.ts 的 RelationWindow XML 形态——第一版伴随 knowledge_window 提供正文；render 层 fall through 到 generic 渲染即可。
- **不**做前端 RelationWindow 专属 chip——AgentOfVisible 评估后再单独立项。
- **不**做向后兼容 thread.json 迁移——RelationWindow 不持久化，旧 thread 不带 relation field 完全 OK。
- **不**做 stone relation 直接写（绕过 super）——长期 relation 必须经过 super flow，保证 reflectable 的元编程闭环不被绕。
