# Object Relation — peer 知识激活切片需求

> **状态**：drafting (2026-05-18)
> **范围**:talk_window 触发的 peer readme + 自我 relation 文件自动注入;
> 不含 relation 写入专用命令、不含 close hook、不含全局聚合 API
> **前置**:`meta/object/collaborable/relation/index.doc.ts` 的 spec(有向 / 局部 /
> 单文件 / 按需激活)已成型;`KnowledgeWindow` 已支持 protocol / activator 双源派生

---

## 1. 上下文:为什么现在做

Relation 概念在 `meta/object/collaborable/relation/index.doc.ts` 已有完整 spec
——每个对象在 `stones/{selfId}/knowledge/relations/{peerId}.md` 维护自己视角下
对 peer 的关系记忆,有向、局部、允许不对称、无全局索引。

但目前 **spec 是悬空的**:
- `grep -r relations src/` 在实现层零命中
- 没有任何机制把 peer 的 readme 或自己写的 relation 文件自动塞进 context
- LLM 与同一 peer 多次对话时,认知不会跨 session 持久;每次都得从对话历史里
  现学对方是谁

这次切片把 relation 从"文档定义"变成"在对话时自动浮现的知识页",最小代价
让长期协作记忆生效。

### 关键设计选择

实现路径上有两条:
1. **每轮 render 时按 talk_window 派生 knowledge_window**(类似 protocol /
   activator,**不持久化进 thread.contextWindows**)
2. **talk_window 创建时一次性注入 knowledge_window 并持久化**

**采用 (1)**——理由:
- peer 文件改了之后 context 自动反映,不用做"刷新 / reload"操作
- talk_window close 后派生消失,没有"两套数据要同步"问题
- 与现有 `KnowledgeWindow.source = "protocol" | "activator"` 的合成派生模式
  自然对齐;新增 `source: "relation"` 区分来源即可

这条选择也匹配 `relation.peerFile.activationAsKnowledge` 文档里的原话:
"按 \`activates_on\` 在与 peer 的 talk 上下文中自动加载"——激活条件是 talk_window
存在,不是命令路径命中。

### 这是一次 identity 移动,不只是 plumbing

切片之前,OOC 的 object 是"持有 readme + 在 thread 内有 context 的实体"。
切片之后,object 是"在每次与同一 peer 对话时,自动浮现自己对 peer 的私有、
有向、不对称的长期印象"的实体。

这是 OOC 第一次让 **"objects with persistent asymmetric memory of each other"**
变成用户可见行为。承认这是 product trajectory 上的策略选择,不是技术管线:

- 后续路线图(全局 relation view、relation 写入 UX 改进、跨 session relation 演化
  追溯等)应**显式与本方向 cohere**,而不是各自演进偶然撞上同一空间
- 反向路线(例如把 relation 设计成只对 supervisor 可见的内部元数据、或退回到
  纯 thread-local context)如果后来被采纳,需要明确推翻本切片的位置 — 不要
  让两套设计语言并存

本切片不加 feature flag(spec 文档侧的 `relation` 概念已经 commit 了这个方向,
读侧自动激活只是把它兑现到 runtime;后续如果证伪,撤销 = 删除 derive 函数
+ 改 talk basic 提示,改动面有限)。

---

## 2. 用户故事

### 2.1 主路径:assistant 重新对话已熟识的 peer

1. assistant 之前与 critic 协作过几轮,写下了 `stones/assistant/knowledge/relations/critic.md`
   ("critic 偏好用『证据是否独立可复现』作为审视维度")
2. 新一轮任务里,assistant 创建 talk_window(target=critic)
3. 下一轮 LLM 调用时 context 自动包含两条 knowledge_window:
   - `stones/critic/readme.md`(critic 自述身份)
   - `stones/assistant/knowledge/relations/critic.md`(assistant 上次的认知)
4. assistant 不需要重新探路就能用合适语言对话

### 2.2 主路径:首次对话 + 后续记录

1. supervisor 第一次 talk 给 reviewer;两边都没有 relation 文件
2. context 中:reviewer readme 加载(public),relation 静默空
3. supervisor 与 reviewer 协作完一轮,通过既有 `open(command=write_file, path="stones/supervisor/knowledge/relations/reviewer.md", content=...)` 把要点写下
4. 下一个 thread 再 talk reviewer 时,relation 自动浮现

### 2.3 不在 scope 的故事

- "查看所有对象之间的关系网" — spec 明确反对全局聚合,不做
- "对端写了 relation 我能看到他对我的评价" — 关系是有向局部,A 不读 B 的 relations/
- "talk close 时强制收口写 relation" — 不加 hook,留给 LLM 自己判断

---

## 3. 行为规约

### 3.1 激活触发条件

对 thread `T`,每轮 render context 时:

1. 扫 `T.contextWindows`,挑出所有 `type === "talk"` 的窗口
2. 收集所有非空 `target`,按 peerId 去重
3. 对每个 peerId,尝试派生最多 2 条 `KnowledgeWindow`:
   - **peer readme**:`stones/{peerId}/readme.md`
   - **self relation**:`stones/{selfId}/knowledge/relations/{peerId}.md`
4. `selfId` = `T.persistence.objectId`(thread 所属 object)

### 3.2 跳过 / 占位规则

- peer 是 `super` alias(target === "super") → 自反场景,**全部跳过**(自己跟
  自己没有"关系"概念,readme 也无意义)
- peer stones 目录不存在 → 该 peer 全部两条都跳过
  - **不会发生在正常路径**:`root.talk` 在 open 时已校验 target 对应 stone 存在
    (见 §3.7);走到这里说明 target 在 talk_window 创建后被删,或绕过 root.talk
    构造的异常 thread.json
- peer readme 不存在 → 仅跳过 readme,relation 仍走占位路径
- **self relation 文件不存在 → 不跳过,合成占位 KnowledgeWindow**(见 §3.3 末段):
  - body = `"暂无对 <peerId> 的关系记录。可通过 open(command=write_file, path=\"stones/<selfId>/knowledge/relations/<peerId>.md\", content=...) 写入要点。"`
  - 让 LLM 每轮看到"我对这个 peer 没记录",自然产生写入动机;比 talk basic
    一段一次性 prompt 信号强得多。这是本切片唯一"主动驱动 write" 的机制
- 派生过程中 IO 出错 → 跳过该条;不阻断主 render 流程

**Dev mode 可观测性**(A2 finding):派生函数对每次"跳过"调用
`console.debug("[relation] skip <peer> reason=<reason>")`,让人能从 server log
区分"super 跳过 / IO 出错 / 文件不存在",避免 5 种 silent skip 同质化。

理由:spec `peerFile.pathConvention` "无文件即代表无关系记录"对**读侧**仍成立
——self relation 缺失时 LLM 看到的不是"对方不存在",而是"占位提示要去写"——
这是 spec 想要的行为(`peerFile.activationAsKnowledge` 说"自动加载"暗含
"加载的内容是有用的提示")。

### 3.3 KnowledgeWindow 形态

每条派生的 KnowledgeWindow:
```
{
  type: "knowledge",
  status: "open",
  source: "relation",          // 新增枚举值
  path: "<同上方文件路径>",
  body: "<文件全文 或 占位提示>",  // self relation 缺失时是占位文案
  presentation: "full",        // 注:实际受 render 8KB 限制(MAX_KNOWLEDGE_BYTES),
                               // 超出会被 truncateKnowledgeBody 截断 + 标记
                               // [truncated, original N bytes];readme 较长时需留意
  // 不持久化:不写进 thread.contextWindows
}
```

`id` 用稳定派生(如 `kn_rel_<peerId>_readme` / `kn_rel_<peerId>_self`),
方便 UI 在 ContextSnapshotViewer 中跨轮稳定显示。

**用 readme.md 而非 self.md 的理由**(A5 finding):stone 同时维护 self.md
(第一人称内部叙述,已由 `LlmGenerateParams.instructions` 注入给 self thread)
和 readme.md(对外公开自述)。relation channel 给 peer 的是"外面看自己应该看到的样子"
,所以用 readme.md;选 self.md 会泄露内部叙述视角且与 instructions 重复。

### 3.4 与 LLM 的接口:talk basic 知识扩写

`src/executable/windows/talk.ts` 中的 talk basic knowledge(注入到每个 talk_window
对应的 command_exec 时)增加一段约定说明:

> 你对 peer 的长期认知请写到 `stones/<self>/knowledge/relations/<peer>.md`
> (一个 peer 一份 md 文件,普通 markdown 即可)。与某个 peer 谈完一轮、
> 形成新认知时,通过 `open(command=write_file, path=..., content=...)` 或
> `open(command=open_file)+edit` 更新这份文件。下次再与该 peer 对话时,
> 文件会自动作为 knowledge 出现在你的 context。

不强制更新、不加 close hook;LLM 是否跟进自己判断。

### 3.5 跨对象只读边界

实现派生时要跨 object 读 stones:
- `stones/{peerId}/readme.md` —— peer 公开自述,LLM 可见无争议
- `stones/{selfId}/knowledge/relations/{peerId}.md` —— 自己的文件,无新边界

**A 不读 B 的 `relations/` 目录**(spec 决议:有向局部)。实现里只读上面两条
确切路径,绝对不要扫 peer 的 knowledge 子目录。

### 3.6 UI 反映

- ContextSnapshotViewer 的 left tree 在 "knowledge (N)" 分组下应能看到这些
  `source=relation` 的 knowledge_window
- 不需要额外 UI 改造;复用 knowledge window 的现有渲染(已支持 source / path /
  body / presentation 字段)

### 3.7 root.talk 创建 talk_window 时的 target 校验(A4 finding)

`root.talk` 命令 open 时(在 talk_window 写入 contextWindows 之前)增加一道
校验:`stones/{target}/` 目录必须存在。否则**不创建 window**,返回 command-error:

> talk target `<target>` 不存在(stones/<target>/ 目录未找到)。请检查 target
> 拼写是否正确;若是新对象,先创建 stone object 再 open talk_window。

这把"target typo 静默生效 → 整轮 relation 派生全静默跳过 → LLM 跟幻 peer 对话"
这条无声失败链路在最早期切断。`super` alias 是预定义常量,豁免本校验。

**peer = user 的特殊情况**:user 通常没有 stones/user/。两个选项:
1. **MVP 默认**:不豁免;LLM 想 talk user 时如果 stones/user/ 不存在,先用
   `create_stone` 之类创建(本期不要求 LLM 干这事 —— 实际上 control plane 的
   user→assistant 初始化时已经创建对应 assistant stone,user stone 的初始化
   由后续切片负责)
2. 暂时给 user 一个豁免名单,绕过 stone 存在校验。MVP **不采用**,因为这会与
   §3.2 "peer stones 目录不存在 → 跳过"的行为重叠,失去 A4 校验的价值

---

## 4. 实现要点(给 ce-plan 的输入,非最终设计)

### 4.1 改动文件预估

- `src/executable/windows/types.ts` — `KnowledgeWindow.source` 加 `"relation"` 字面量
- `src/executable/index.ts` — 在 `collectExecutableKnowledgeEntries`(目前已派生
  protocol + activator 两源 KnowledgeWindow)旁加 `deriveRelationKnowledge(thread)`
  步骤,产出 KnowledgeWindow 数组与既有两源汇合。**不是改 `context/render.ts`**:
  render 层只消费已合成的 windows,实际派生 seam 在 executable 层
- `src/persistable/stone-readme.ts` 已有 `readReadme(StoneObjectRef)`(ENOENT 静默);
  `src/persistable/stone-object.ts` 已有 `relationsDir()`,需补一个
  `readRelation(self, peerId)` 薄 helper(也按 ENOENT 静默)
- `src/executable/windows/root/talk.ts` — `root.talk` open 时校验 target 对应
  stone 存在(§3.7)
- `src/executable/windows/talk.ts` — 在 `TALK_WINDOW_BASIC_KNOWLEDGE` 字符串里
  追加 "relation 文件更新" 段落
- `src/executable/windows/super-constants.ts` — 引用其 `SUPER_ALIAS_TARGET`
  做 self-reflexive 跳过判断
- `meta/object/collaborable/relation/index.doc.ts` —
  把 sources 接到真实的实现模块(派生函数 + stone-data 读取),把 spec 中
  "as knowledge 激活" 状态标为已落地

### 4.2 单元 / 集成测试要点

- 单元测试:`deriveRelationKnowledge(thread)` 在四种文件存在组合下分别返回
  正确数量的 KnowledgeWindow:
  - **00**(readme 缺 + relation 缺):返回 1 条 = relation 占位 KnowledgeWindow
  - **01**(readme 缺 + relation 在):返回 1 条 = relation full body
  - **10**(readme 在 + relation 缺):返回 2 条 = readme full + relation 占位
  - **11**(readme 在 + relation 在):返回 2 条 = readme full + relation full
- 集成测试:thread 有 talk_window(target=critic),render context 后 XML 中
  能看到对应 knowledge 节点;`target="super"` 时不生成
- 回归测试:多 talk_window 同 peer 去重正确
- 回归测试(A4):`root.talk open` 时 target 对应 stone 不存在 → 返回
  command-error,**不写 talk_window 进 contextWindows**

### 4.3 e2e 测试场景(A7 finding)

参照 `meta/engineering/how_to_test/strategy.md` 的两个观察孔 + 三档评分;
新增**一个** e2e 场景到 backend 入口(放 `tests/integration/`,沿用 `_fixture`
约定),命名 `backend-relation-self-write-on-talk`:

**用户故事**:user → assistant 创建 talk,assistant 用 root.talk 创建指向
critic 的 talk_window;触发 LLM 跑一轮 say,然后 close talk_window;断言
**事后磁盘上** `stones/assistant/knowledge/relations/critic.md` **被写出来了**。

**Good / OK / Bad 判定**:

| 档 | 条件 |
|---|---|
| **Good** | thread.status=done;`stones/assistant/knowledge/relations/critic.md` 文件存在,非空;LLM 用 `open(command=write_file, path=stones/assistant/knowledge/relations/...)` 写入(轨迹可见) |
| **OK** | 文件存在但内容是占位文案的回写,或 LLM 用 file_window.edit 改了一个不存在的文件再写(机制有点绕但完成了) |
| **Bad** | 文件不存在,或 thread 卡在 running/waiting,或 LLM 把 relation 写到错路径(如 `relations/<self>.md` 反向) |

这个场景同时验证两条断言链:
1. **read 侧**:talk_window 创建后,下一轮 context XML 含 `<knowledge source="relation" path="stones/assistant/knowledge/relations/critic.md">` 节点,body 是占位文案
2. **write 侧**:LLM 看到占位文案,自然走 write_file 写入(占位的 "写入提示
   性"是触发器)

如果 write 侧达不到 Good 频率(例如 5 次跑里少于 2 次 Good),回到 §5 的
fallback——升级为 close talk_window hook。本 e2e 是这个度量的载体。

---

## 5. 已显式接受的限制

- **不做 user 的 stones/ 自动初始化** — peer=user 时如果 stones/user/ 不存在就
  静默跳过两条。用户决策时选了"把 user 当普通对象",但 stones/user/ 由谁/何时
  创建留给后续切片
- **多 talk_window 占 context 上涨** — N peer × 2 full doc 累计 token 上涨在
  N≤3 时可接受;若实际观察 N 经常 ≥5 或 readme 经常 > 4KB,后续切片再考虑
  退到 `readme=summary` 或加全局上限截断
- **没有专用 relation.update 命令** — 写入完全靠既有 `write_file` / `edit`;
  prompt 在 talk basic 里加一段提示。如果 LLM 在 1-2 周观察后明显不主动更新,
  再升级为 close hook

---

## 6. 验收标准

- [ ] `KnowledgeWindow.source` union 加 `"relation"`
- [ ] 在 thread 有 talk_window(target=existing-stone-objectId) 时,
      render 输出的 XML 包含 `source="relation" path="stones/{peer}/readme.md"`
      或 `path="stones/{self}/knowledge/relations/{peer}.md"` 两条 knowledge 节点
- [ ] **self relation 文件不存在时,渲染出占位 KnowledgeWindow**,body 含
      "暂无对 `<peer>` 的关系记录" 与可复制的 `write_file path=...` 提示
- [ ] target="super" 时不生成 relation knowledge(super 自反跳过)
- [ ] **`root.talk` open 时 target 对应 stone 不存在 → 返回 command-error,
      不创建 talk_window**(A4)
- [ ] 派生函数对每次跳过调用 `console.debug("[relation] skip ... reason=...")`(A2)
- [ ] peer / readme / IO error 等失败场景**不写 error/inject 进 thread.events**
      (只 console.debug);self relation 缺失走占位而非跳过
- [ ] talk basic knowledge 包含 "relation 文件更新" 段
- [ ] `meta/object/collaborable/relation/index.doc.ts` 的 sources 接到实际实现
- [ ] 新增单元测试覆盖 4 种文件存在组合(`00/01/10/11`,见 §4.2)+
      `root.talk open target 不存在` 校验回归
- [ ] **新增 1 个 e2e 集成测试** `backend-relation-self-write-on-talk`
      (见 §4.3),三档判定可在 stdout 看到

---

## 7. 后续可能演进(本期 explicit 不做)

- close talk_window 时给 LLM inject "新认知请更新 relation" 软提醒
- relation 文件按 frontmatter `activates_on` 走现有 activator 路径(本期是按
  talk_window 派生,与 activator 是两套触发源,但都生产 KnowledgeWindow)
- 跨 session 全局 relation 聚合 view(spec 反对原语,但 UI 可以作为只读 view)
- relation 文件结构化:加 frontmatter `last_observed_at` / `confidence` 等
