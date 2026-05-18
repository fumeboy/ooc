---
type: feat
origin: docs/brainstorms/2026-05-18-object-relation-knowledge-activation-requirements.md
created: 2026-05-18
status: completed
shipped_commit: 97ce6b9
shipped_branch: feat/object-relation-activation
---

# feat: Object relation knowledge auto-activation

> **状态**: active (2026-05-18)
> **Origin**: `docs/brainstorms/2026-05-18-object-relation-knowledge-activation-requirements.md`
> **类型**: feat —— 在现有 `KnowledgeWindow` 派生管线上加第三种来源 `source="relation"`,
> 由 talk_window 触发,自动注入 peer readme + self relation 文档(或占位提示)
> **不含**: relation.update 专用命令、close hook、全局 relation 聚合 API

---

## 1. Summary

把 `meta/object/collaborable/relation/` 已成型但悬空的 spec 落地到 runtime:每轮
render context 时,扫 `thread.contextWindows` 的所有 `talk_window`,按 `target` 派生
两条 `KnowledgeWindow`(`source="relation"`):

- `stones/{peerId}/readme.md` — peer 公开自述
- `stones/{selfId}/knowledge/relations/{peerId}.md` — 自己对 peer 的关系记录;
  缺失时合成**占位 KnowledgeWindow**(body 含可复制的 `write_file` 提示,
  替代弱 prompt 提示驱动 LLM 写入)

read 侧 + 占位驱动 write 侧 + e2e 度量,一并落地。详见 origin §1 关于 "identity 移动"
的策略承认 — OOC 第一次让"objects with persistent asymmetric memory of each other"
成为用户可见行为。

---

## 2. Problem Frame

- spec `meta/object/collaborable/relation/index.doc.ts` 已完整定义 relation 概念
  (有向 / 局部 / 单文件 / 按需激活),但 `grep -r relations src/` 零实现命中
- LLM 与同一 peer 多次对话时,认知不会跨 session 持久;每次都得从历史里现学
- 写侧没有触发器:没有占位 / hook / 专用命令时 LLM 不会主动去 `stones/<self>/
  knowledge/relations/<peer>.md` 写文件

---

## 3. Scope Boundaries

### 含

- `KnowledgeWindow.source` 加 `"relation"` 字面量
- 派生函数 `deriveRelationKnowledge(thread)` 在每轮 render 派生最多 2N 条
  knowledge_window(N = 去重后 peer 数);**不持久化**进 thread.contextWindows
- self relation 文件缺失 → **占位 KnowledgeWindow**(读侧驱动写侧的核心机制)
- `root.talk.exec` 加 target stone 存在校验,失败 → command-error,不创建 window
- `TALK_WINDOW_BASIC_KNOWLEDGE` 追加 "relation 文件更新" 段
- `meta/object/collaborable/relation/index.doc.ts` sources 接到实际实现模块
- 单元测试覆盖 4 种文件存在组合 + target 校验回归
- 1 个 e2e 集成测试度量 LLM 是否真的写 relation 文件

### Deferred for later (origin §7)

- close talk_window 时 inject "新认知请更新 relation" 软提醒
- relation 文件按 frontmatter `activates_on` 走现有 activator 路径(本期是按
  talk_window 派生,与 activator 是两套独立触发源)
- 跨 session 全局 relation 聚合 view(spec 反对原语,但 UI 可作为只读 view)
- relation 文件结构化:加 frontmatter `last_observed_at` / `confidence`
- user stones/user/ 的自动初始化(本期 user 走与其他 peer 相同路径 — stones/user/
  不存在时 target 校验会拒绝;改善由后续切片做)

### Deferred to Follow-Up Work

- 本切片不需要;所有 unit 都在本计划闭环

### Outside this product's identity

- 全局 relation 索引 / 共享 relation 表(spec `globalNote.noGlobalIndex` 明确反对)
- 强制对称 relation(spec `directedLocal.asymmetryAllowed` 明确反对)

---

## 4. Key Technical Decisions

1. **派生不持久化** —— 与现有 `source="protocol"` / `"activator"` 同模式;每轮 render
   时合成。优势:peer 文件改了自动反映,talk_window close 后自动消失
2. **派生 seam 在 `src/thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries`**
   (`src/executable/index.ts` 现在只是 17 行 barrel — 真实 seam 同日迁到了
   knowledge/ 子树),不是 executable/ 或 render 层。沿用现有 "3) activator" 那段的
   代码模式,加 "4) relation"
3. **self relation 缺失 → 占位而非跳过** —— 这是本切片唯一"主动驱动 write"的机制。
   占位 body 含可直接复制的 `write_file path="..." content=...` 提示。比 talk basic
   一段一次性 prompt 信号强得多
4. **`root.talk` open 时校验 target stone 存在** —— 把 "target typo 静默生效 →
   relation 全静默跳过 → LLM 跟幻 peer 对话" 这条无声失败链路在最早期切断。
   `super` alias 是预定义常量,豁免本校验
5. **`readme.md` 而非 `self.md`** —— self.md 是第一人称内部叙述,已经走
   `LlmGenerateParams.instructions` 注入给 self thread;readme.md 才是对外公开自述,
   relation channel 给 peer 用的就是"对方看自己应该看到的样子"
6. **`readRelation` 加在 `stone-object.ts`** 而不是单独 `stone-relations.ts` 文件 ——
   `relationsDir()` 已在 `stone-object.ts:31`,放一起边界小、import 链短
7. **观测:每次跳过调用 `console.debug("[relation] skip <peer> reason=<reason>")`** ——
   防 5 种 silent skip 同质化导致 debug 困难(origin A2)

---

## 5. Implementation Units

### U1. Extend `KnowledgeWindow.source` union with `"relation"`

**Goal**: 为新的派生来源新增类型字面量,让下游 narrowing / 序列化 / UI 渲染都识别它

**Requirements**: origin §3.3 (form), §6 (验收第 1 条)

**Dependencies**: 无

**Files**:
- `src/executable/windows/types.ts` (modify)

**Approach**:
- `KnowledgeWindow.source` 当前是 `"explicit" | "protocol" | "activator"`,扩展为
  `"explicit" | "protocol" | "activator" | "relation"`
- 在该字段的 JSDoc 注释里加一行说明 `"relation"` 的语义(由 talk_window 派生,
  非持久化,不可 close)
- 不动 KnowledgeWindow 其它字段;`body` / `presentation` 复用现状

**Patterns to follow**: 该 union 字段的注释已对前三种 source 各有一行说明
(types.ts:210-218 左右),沿用同样格式

**Test scenarios**:
- Test expectation: none — 纯类型字面量扩展,无运行时行为变化;由 U3/U7 派生测试间接覆盖

**Verification**: `bun tsc --noEmit` 通过;下游消费点(`makeKnowledgeWindow` 调用、
context-snapshot 前端类型) 无 narrowing 错误

---

### U2. Add `readRelation(self, peerId)` helper

**Goal**: 提供按 peer id 读 `stones/{self}/knowledge/relations/{peerId}.md` 的工具,
ENOENT 静默返回 undefined,与现有 `readReadme` 风格一致

**Requirements**: origin §4.1 (新增 helper)

**Dependencies**: 无

**Files**:
- `src/persistable/stone-object.ts` (modify — 加新函数,放在 `relationsDir` 附近)
- `src/persistable/__tests__/stone-object.test.ts`(若存在则补;不存在则跳过 — U3
  集成测试会覆盖)

**Approach**:
- 新增 `export function relationFile(ref: StoneObjectRef, peerId: string): string` —
  返回绝对路径 `relationsDir(ref) + "/" + peerId + ".md"`
- 新增 `export async function readRelation(ref: StoneObjectRef, peerId: string):
  Promise<string | undefined>` — 内部 `readFile + utf8`;catch ENOENT 返回 undefined,
  其他 IO 错误向上抛
- 不写"安全 peerId":由 caller(U3) 信任 peerId 来自 talk_window.target,目前没有
  路径越权场景

**Patterns to follow**: `src/persistable/stone-readme.ts:1-19` `readReadme` 是几乎
完全的模板 — 复制 + 改路径函数即可

**Test scenarios**:
- 文件存在 → 返回内容字符串
- 文件不存在(目录存在) → 返回 undefined
- 目录不存在(stones/{self} 整个缺失) → 也按 ENOENT 静默返回 undefined
- 文件路径里 peerId 含 `/`(异常) → 不专门 sanitize;依赖 caller 保证(本 unit 不测)

**Verification**: 单元测试通过;`readRelation(ref, "critic")` 在新建 stone 上返回
undefined(不抛)

---

### U3. Implement `deriveRelationKnowledge(thread)` and wire into executable seam

**Goal**: 在 `collectExecutableKnowledgeEntries` 内的 activator 之后加 "4) relation"
段,按 thread 的 talk_window 派生 peer readme + self relation(或占位)的
KnowledgeWindow

**Requirements**: origin §3.1, §3.2, §3.3, §6 (验收第 2-6 条)

**Dependencies**: U1 (新 source 字面量), U2 (readRelation helper)

**Files**:
- `src/thinkable/knowledge/synthesizer.ts` (modify — 在 `collectExecutableKnowledgeEntries`
  内 line ~225 activator 段末尾后加新段;**不是改 `src/executable/index.ts`**
  —— 后者现在只是 17 行 barrel,真实 seam 是 synthesizer.ts:151)
- `src/thinkable/knowledge/__tests__/relation-derive.test.ts` (new — 见 U7)

**Approach**:
- 在 `collectExecutableKnowledgeEntries` 内部新加一个内联段或抽到独立函数
  `deriveRelationKnowledge(thread, baseDir)`,返回 `KnowledgeWindow[]`
- 流程:
  1. 取 `thread.persistence`;没有就 return []
  2. 取 `thread.persistence.objectId` 作为 `selfId`
  3. 收集所有 `thread.contextWindows.filter(w => w.type === "talk")` 的 `target`
     字段,去重(set),过滤掉 `SUPER_ALIAS_TARGET`
  4. 对每个 peerId 并行(`Promise.all`)做两个尝试:
     - `readReadme({baseDir, objectId: peerId})` → 有就生成 readme 窗口
     - `readRelation({baseDir, objectId: selfId}, peerId)` → 有就生成 full;
       **无就生成占位** body
  5. console.debug 每次跳过 / 占位的原因(`[relation] skip <peer> reason=...`)
  6. 任何 IO 抛错 → 当作 missing 处理(已经 ENOENT 静默,其他错走 catch)
- 占位 body 模板:
  ```
  暂无对 <peerId> 的关系记录。

  可通过 open(command=write_file, path="stones/<selfId>/knowledge/relations/<peerId>.md",
  content=...) 写入对该 peer 的认知要点。文件会在下一轮 render 自动作为
  knowledge 出现在 context。
  ```
- KnowledgeWindow id 用稳定派生:`kn_rel_<peerId>_readme` / `kn_rel_<peerId>_self`
- `body` 长度走 `truncateKnowledgeBody(body)`(同 activator 段处理),长 readme
  超 8KB 被截断但不报错;占位 body 短不触发
- `presentation: "full"`
- `path` 字段填 actual file path(供 UI / 调试可读)
- **派生顺序**:在 activator 段后、`finalWindows` 拼接前。不与 explicit 重复时,
  把派生窗口 push 进 synthetic 数组同样的位置(让最终 `[...enriched, ...synthetic]`
  也含 relation 窗口)

**Patterns to follow**:
- `src/thinkable/knowledge/synthesizer.ts:212-235` activator 段是结构模板 —
  `for ... try ... synthetic.push({...makeKnowledgeWindow(...), presentation, ...})`
- `src/persistable/common.ts:deriveStoneFromThread(persistence)` 已有按
  ThreadPersistenceRef 派 StoneObjectRef 的工具(activator 段用过)— self ref 用它,
  peer ref 直接构造 `{baseDir: thread.persistence.baseDir, objectId: peerId}`
  (StoneObjectRef.baseDir = world root,与 ThreadPersistenceRef.baseDir 同义)
- `truncateKnowledgeBody` / `makeKnowledgeWindow` 同文件已是 private 工具
  (synthesizer.ts:240+),直接复用
- `SUPER_ALIAS_TARGET` 从 `src/executable/windows/super-constants.ts` import

**Test scenarios** (单元测试在 U7 单独写):
- 见 U7 的 4 种组合 + super alias 跳过 + 去重 + 无 persistence ref 行为

**Verification**:
- thread 含 `[talk(target=critic)]` 且 stones/critic/readme.md 存在 + relation 缺
  → render 出的 contextWindows 含 2 个 source=relation 窗口,一个 readme full body,
  一个 relation 占位 body
- thread 含 `[talk(target=critic), talk(target=critic, conversationId=other)]` →
  仍只生成 2 条 window(去重)
- thread 含 `[talk(target=super)]` → 0 条 relation 窗口

---

### U4. `root.talk` validates target stone exists

**Goal**: 在 `executeTalkCommand` 创建 talk_window 之前校验 `stones/{target}/`
目录存在(super alias 豁免);不存在 → 返回 command-error,**不创建** window

**Requirements**: origin §3.7, §6 (验收 "root.talk open 时 target 对应 stone 不存在
→ command-error")

**Dependencies**: 无(独立于 U1-U3 的派生路径)

**Files**:
- `src/executable/windows/root/talk.ts` (modify — 在 `executeTalkCommand` 函数体
  顶部加校验)
- `src/executable/__tests__/root-talk.test.ts` 或 `src/executable/__tests__/
  step2-windows.test.ts` (modify — 加 1 个 test case)

**Approach**:
- 在已有 target / title 参数检查后、`generateWindowId` 之前插入校验:
  ```
  if (target !== SUPER_ALIAS_TARGET) {
    const ref = { baseDir: thread.persistence?.baseDir, objectId: target };
    if (!await stoneDirExists(ref)) {
      return `[talk] target \`${target}\` 不存在(stones/${target}/ 目录未找到)。
              请检查 target 拼写是否正确;若是新对象,先创建 stone object 再 open talk_window。`;
    }
  }
  ```
- `stoneDirExists` 可以用 `await stat(stoneDir(ref))` then `info.isDirectory()`,
  ENOENT → false。放在 `src/persistable/stone-object.ts` 或就近在 `root/talk.ts`
  内部定义;**倾向就近定义**(只此一处用,避免提早抽象)
- thread.persistence 没有 baseDir 时(测试场景):跳过校验(向后兼容,不破现有
  单元测试)
- `super` alias 来自 `SUPER_ALIAS_TARGET` 常量

**Patterns to follow**:
- `src/persistable/common.ts:stoneDir(ref)` 已有路径函数
- `src/executable/windows/root/talk.ts:79-87` 已有 target/title 校验返回 `[talk]
  缺少 ...` 的 error pattern,沿用 prefix

**Test scenarios**:
- target = 不存在的 objectId,`stones/{target}/` 不存在 → 返回 `[talk] target ...
  不存在` 字符串;thread.contextWindows 不新增 talk window
- target = 已存在的 stone objectId → 创建成功,行为不变
- target = "super" → 跳过校验,直接创建(super 自反场景)
- thread.persistence === undefined → 跳过校验(测试 fixture 友好)

**Verification**:
- `step2-windows.test.ts:38` 和 `:215` 两处都用 `target: "bob"` 但**没建 bob stone**
  → 新校验会让它们失败。**实现 U4 时同步在这两个 test setup 里加
  `await createStoneObject({ baseDir: tempRoot, objectId: "bob" })`**。
  `commands-execution.test.ts` 中 `target: user/researcher` 的测试不受影响,
  因为它们用 `makeThread({ id })` 没传 persistence,会走 "no persistence → skip 校验"
  的 fixture-friendly 安全网

---

### U5. Append relation update guidance to `TALK_WINDOW_BASIC_KNOWLEDGE`

**Goal**: 在 talk_window 的 basicKnowledge 字符串末尾加一段 "如何更新 relation
文件" 的说明,作为辅助 prompt(主要 driver 仍是 U3 的占位)

**Requirements**: origin §3.4, §6 (验收 "talk basic knowledge 包含 'relation 文件
更新' 段")

**Dependencies**: 无(独立于 U1-U4)

**Files**:
- `src/executable/windows/talk.ts` (modify — `TALK_WINDOW_BASIC_KNOWLEDGE` 常量)

**Approach**:
- 在 `TALK_WINDOW_BASIC_KNOWLEDGE` 字符串末尾追加段落(中文,与现有内容风格对齐):
  ```
  ## 关系记录(relation)

  你对每个 peer 的长期认知请写到
  `stones/<self>/knowledge/relations/<peer>.md`(普通 markdown,一个 peer 一份)。
  与某个 peer 谈完一轮、形成新认知时,通过 `open(command=write_file, path=...,
  content=...)` 或 `open(command=open_file)+edit` 更新该文件。
  下次再与该 peer 对话时,文件会作为 knowledge 自动出现在你的 context。

  没有记录时,context 会显示一份占位提示,提示你按上述路径写入。
  ```
- 不动 commands 表 / wait 提醒等既有段

**Patterns to follow**:
- `src/executable/windows/talk.ts:32` `TALK_WINDOW_BASIC_KNOWLEDGE` 字符串结构,
  各段用 `## 标题` 分

**Test scenarios**:
- Test expectation: none — 纯 prompt 文案变更,无可测断言。在 U8 e2e 测试中作为
  环境组成部分被间接验证(LLM 看到这段后是否更愿意写 relation 文件)

**Verification**: `bun tsc --noEmit` 通过;手动查看渲染出的 protocol KnowledgeWindow
含新段

---

### U6. Wire `meta/object/collaborable/relation/index.doc.ts` sources to implementation

**Goal**: 把 RelationConcept 的 `sources` 字段从只指 stoneObject / stoneData 扩到
也指向新加的派生函数模块;在 description 标注 "as knowledge 激活" 已落地

**Requirements**: origin §4.1, §6 (验收 "meta/object/collaborable/relation/
index.doc.ts 的 sources 接到实际实现")

**Dependencies**: U3 (派生函数存在)

**Files**:
- `meta/object/collaborable/relation/index.doc.ts` (modify)

**Approach**:
- 在 `RelationConcept.sources` type 加新字段(如 `relationSynth: typeof relationSynth`);
  对应的 value 字段也加:`import * as relationSynth from "@src/thinkable/knowledge/synthesizer"`
  (派生函数所在文件;**不要写 `@src/executable/index`** 那是 17 行 barrel)
- 把 `peerFile.activationAsKnowledge.content` 末尾加一句:"(已实现:由
  `src/thinkable/knowledge/synthesizer.ts:collectExecutableKnowledgeEntries` 在
  render 时按 talk_window 派生)"
- description 字段可加一行 "implementation status: read-side + placeholder
  derivation shipped 2026-05-18"

**Patterns to follow**:
- `meta/object/collaborable/relation/index.doc.ts:1-15` 已有 stoneObject /
  stoneData import 模式

**Test scenarios**:
- Test expectation: none — 纯文档/类型边界更新

**Verification**:
- `bun tsc --noEmit` 通过 — RelationConcept 类型对齐
- doc walker 仍能解析该节点(若有 doc-types 校验)

---

### U7. Unit tests for `deriveRelationKnowledge` (4 file-existence combinations)

**Goal**: 单元测试覆盖 read/relation 两个文件的存在/缺失全 4 种组合 + super alias
跳过 + 多 talk 同 peer 去重

**Requirements**: origin §4.2, §6 (验收 "新增单元测试覆盖 4 种文件存在组合")

**Dependencies**: U3 (派生函数), U2 (readRelation)

**Files**:
- `src/thinkable/knowledge/__tests__/relation-derive.test.ts` (new)

**Approach**:
- 用 `mkdtemp` 建临时 baseDir;`createStoneObject` 建 self + 2 个 peer(critic /
  reviewer)
- 通过直接 `writeFile(readmeFile(ref), ...)` / `writeFile(relationFile(self, peer), ...)`
  控制每种组合的文件存在性
- 调 `collectExecutableKnowledgeEntries(thread.contextWindows, thread)` 并断言返回
  的 contextWindows 含正确数量的 `source="relation"` KnowledgeWindow,内容正确
- 用 `makeThread({persistence: {...}, contextWindows: [{type:"talk", target:"critic", ...}]})`
  构造测试 thread

**Test scenarios**:
- **00**(readme 缺 + relation 缺)→ 返回 1 条 = relation 占位 KnowledgeWindow,
  body 含 "暂无对 critic 的关系记录"
- **01**(readme 缺 + relation 在)→ 返回 1 条 = relation full body
- **10**(readme 在 + relation 缺)→ 返回 2 条 = readme full body + relation 占位
- **11**(readme 在 + relation 在)→ 返回 2 条 = 都是 full body
- **super skip**:thread 有 `talk(target="super")` → 0 条 relation 窗口
- **dedup**:thread 有 `[talk(target="critic"), talk(target="critic")]` → 仍只 2 条
  (按 peerId 去重)
- **multi-peer**:thread 有 `[talk(target="critic"), talk(target="reviewer")]`,
  两个 peer 都 11 状态 → 4 条
- **no persistence**:thread.persistence === undefined → 0 条(不报错)
- 每条 KnowledgeWindow 的 `id` 稳定:`kn_rel_critic_readme` / `kn_rel_critic_self`

**Verification**: `bun test src/thinkable/knowledge/__tests__/relation-derive.test.ts` 全绿

---

### U8. E2E integration test: `backend-relation-self-write-on-talk`

**Goal**: 度量"占位提示 + talk basic 段是否真的驱动 LLM 写 relation 文件";结果
作为 origin §5 fallback 决策的载体(若达不到 Good 频率,upgrade 为 close hook)

**Requirements**: origin §4.3, §6 (验收 "新增 1 个 e2e 集成测试")

**Dependencies**: U1, U2, U3, U4, U5 全部上线(LLM 看到的完整环境组合)

**Files**:
- `tests/integration/relation-write-on-talk.integration.test.ts` (new)

**Approach**:
- 沿用 `tests/integration/_fixture.ts` (`setupTempFlow` / `bootstrapInboxFromPrompt` /
  `llm`),`describe.skipIf(!hasLlmEnv)` 防 LLM env 缺失时本地 fail
- 流程:
  1. 建临时 baseDir;`createStoneObject(assistant)` + `createStoneObject(critic)`
  2. critic 的 readme.md 写一段身份说明(用 marker 字符串,如 `marker-rev91`)
  3. `createFlowObject(assistant, session=s)` + root thread + 初始 inbox 消息要求
     assistant "向 critic 发一条征求 design review 的消息,然后基于回复更新自己对
     critic 的认知"
  4. `runScheduler` 跑若干轮(maxTicks ~10),让 LLM 走 root.talk → say → critic →
     回报 → update relation
  5. 检查 disk:`stones/assistant/knowledge/relations/critic.md` 是否存在 + 非空
- 三档判定打到 stdout(参考 `meta/engineering/how_to_test/strategy.md`):
  - **Good**: thread.status === "done";relation 文件存在 & 非空;LLM 用 write_file
    创建(可从 llm.input.json 轨迹看到 `command=write_file path=stones/assistant/
    knowledge/relations/critic.md`)
  - **OK**: 文件存在但是占位文案回写、或 LLM 用 edit 改了不存在的文件再写、或
    write_file path 不完全标准但落在 relations/ 下
  - **Bad**: 文件不存在,或 thread 卡 running/waiting,或文件落在错路径(如
    `relations/<self>.md` 反向)
- 断言:**≥ OK** 视为通过;Bad 失败;同时把命中的档 + 关键观察值 console.log 到
  stdout 便于看 CI 趋势

**Execution note**: 这是 LLM-dependent integration test,本地必须有
`OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL` env vars 才跑(由
`tests/integration/_fixture.ts:11-13` 的 `hasLlmEnv` 守门);CI 暂用 skip。
本 unit 完成不要求本地 LLM 跑过 — 完成 = 测试代码写对(`bun tsc --noEmit` 通过,
test 在 `hasLlmEnv=false` 环境会 skip)

**Patterns to follow**:
- `tests/integration/knowledge-activation.integration.test.ts:23-90` 是几乎相同
  shape 的 LLM-in-the-loop 测试(setup stone + knowledge file + 跑 scheduler +
  断言文件状态)
- `tests/integration/multi-object-persona.integration.test.ts` 有跨 object talk
  setup 模板

**Test scenarios** (本 unit 本身就是一条 e2e test case):
- Covers F1 (用户故事 §2.1: assistant 重新对话已熟识的 peer);也覆盖了§2.2 写入
  路径
- happy path: LLM 完成 talk + 写 relation
- 度量信号: 见三档判定

**Verification**:
- `bun test tests/integration/relation-write-on-talk.integration.test.ts` 在
  `hasLlmEnv=true` 时 ≥ OK;`hasLlmEnv=false` 时 skip
- stdout 输出格式 `[relation-write-on-talk] grade=<Good|OK|Bad> file_exists=<bool>
  file_bytes=<n> ...`

---

## 6. System-Wide Impact

- **派生在 executable 之外** — 新的 derive 段写到
  `src/thinkable/knowledge/synthesizer.ts`(与 protocol/activator 同文件,同函数),
  不增加新 module / 新接口,只是把同一函数从 3 个 source 扩到 4 个

- **LLM context token 占用** — N peer × 最多 2 full doc;readme 长时受
  `MAX_KNOWLEDGE_BYTES=8192` 截断保护
- **前端 ContextSnapshotViewer** — knowledge type 分组下会出现 `source=relation`
  条目;当前 UI 已支持 source / path / body / presentation 渲染,但 source label
  渲染若硬编码 `explicit | protocol | activator` 三值会显示空白。本计划**不主动改
  UI**;若启用后发现 label 空白,在 follow-up 加 UI label 映射(成本 < 10 行)
- **debug logging** — server 日志多出 `[relation] skip ...` debug 行;非 debug
  级别不影响 prod

---

## 7. Risks & Open Questions

### Risks

1. **LLM 不主动写 relation 文件**(origin §5 已 identify) — U8 e2e 是早期度量
   手段;5-10 次跑 < 30% Good 则触发 fallback (close hook)
2. **target stone 校验破已有测试** — `step2-windows.test.ts:38 + :215` 两处
   `target: "bob"` 测试 setup **没建 bob stone**;U4 实现时同步加
   `createStoneObject({ baseDir: tempRoot, objectId: "bob" })`(已在 U4 verification
   写明)。`commands-execution.test.ts` 中类似场景因 `thread.persistence === undefined`
   会走安全网,不受影响

### 已显式 deferred

- A6 "A 不读 B 的 relations/" 负向测试 — 当前实现只读两条固定路径,代码层面已不
  会扫 peer 的 relations 目录;留待未来加 lexical 边界 helper 时一并加测试
- A3 8KB 截断的 `presentation: "full"` 误导性 — origin §3.3 已加注释说明,
  不改行为(行为本就存在,本切片不引入新损失)

---

## 8. Verification & Done

按 origin §6 验收 checklist 全 11 条:

- [ ] `KnowledgeWindow.source` union 加 `"relation"`(U1)
- [ ] 单元测试 4 种文件组合 + super 跳过 + 去重(U7)
- [ ] target="super" 跳过 relation knowledge(U3, U7)
- [ ] `root.talk open` target 不存在 → command-error(U4)
- [ ] 每次跳过 `console.debug("[relation] skip ... reason=...")`(U3)
- [ ] 不写 error/inject 进 thread.events(U3 implementation 隐式保证)
- [ ] self relation 缺失 → 占位 KnowledgeWindow(U3)
- [ ] talk basic 包含 "relation 文件更新" 段(U5)
- [ ] meta doc sources 接入(U6)
- [ ] e2e 测试 `backend-relation-self-write-on-talk` 三档判定可见(U8)
- [ ] render 输出 XML 含 `source="relation"` 节点(U3, U7 集成验证)

`bun tsc -b --noEmit` + `bun test src/` + `bun test tests/integration/` 全绿
(LLM-dependent 测试在无 `OOC_API_KEY` / `OOC_BASE_URL` / `OOC_MODEL` env 时 skip)
