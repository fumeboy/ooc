# 工作记录：ContextWindow 公理收敛 —— S1/S2 实现 + 剩余事项

> 2026-06-14 · 分支 `feat/context-window-axiom`（基 main `fc73b4ae`，已推 origin，**未合 main**）
> 设计依据：`docs/2026-06-14-context-window-method-mount-axiom.md`（第一公理 + 三推论 + S0–S5 计划）
> 验证物：`tmp/context-after-s1s2.xml`（重启 backend 加载新代码后，真实会话 `_test_ctxcheck_1781372461` 的 LLM 输入快照）

---

## 一、已完成（实现 + 真实会话验证）

### S1 —— window_classes 沿 parentClass 链合并方法（修 A：self 窗 agency 不可见）

commit `62ba5ecb`。公理判据「窗须投影它的 Object 实际拥有的面」的兑现。

- `computeVisibleMethodSet`（`renderers/xml.ts`）改为沿 `resolveParentClassChain` 合并方法（子类覆盖父类），与 `resolveMethod` 同语义。self 窗 `class=objectId`、自身无 methods、agency 继承自 `_builtin/agent` → 现在 surface。
- 窗类型（do/talk/file/knowledge/search/program/plan/todo/pr/reflect_request/skill_index/feishu_*/example）`parentClass` 由 undefined（默认→root）改为显式 **null**：它们是 ContextWindow 的种类、各自方法直接注册，不该被 root misc（example/feishu）污染。只有 `_builtin/agent` 与 agent 对象继承 root。
- 锁定测试：`render-methods-node.test.ts` 新增「agent 类窗 surface agency」+「tool-object/窗类型不继承」。

**真实会话验证**：`tmp/context-after-s1s2.xml` 里出现了修复前不存在的 `<class name="supervisor">`，含完整 agency（do/talk/plan/todo/end + example + feishu）。agent 实跑 `exec(filesystem,grep)` → `exec(creator,say)` → `exec(end)`（window_id 缺省→self 窗），端到端通。self 窗节点"仅 title/meta"——内容外移到 instructions，符合公理（窗可空内容）。

### S2 —— compress 从顶层 tool 降为 exec 调用的方法（原语 4→3）

commit `749c80f6`。推论二：compress 是"调整信息展示"的方法（与 set_viewport 同类），不是原语。

- `OOC_TOOLS` 删 `COMPRESS_TOOL` → 3 个稳定原语 **exec / close / wait**；`TOOL_HANDLERS` 删 compress。
- `exec.ts` 拦截 `method="compress"`（与 expand 对称）→ 复用 `handleCompressTool` 全部逻辑（scope=windows 折窗 / scope=events 折事件流），window_id 缺省=self 窗。
- agent-facing 回流：exec 方法描述增 compress/expand；budget 提示改 `exec(method="compress")` 形式；`world-vocabulary` 「4 个 OOC_TOOLS」→「3 原语，compress 是方法」（顺带修 root-window/缺省口径）。
- 测试 reframe：`tools.test` 4→3 + compress 经 exec；`context-compression-p0b/p0f` e2e 经 `exec(method=compress)`；修一处 pre-existing stale 断言（p0b 期望 `name="expand"` 方法节点，实际只渲就地 hint）。

### 门禁

`tsc` 干净 / core+builtins **976 pass 0 fail** / storybook Tier A **63 pass** / backend e2e compression **7 pass** / silent-swallow·deprecated-symbols·doc-drift·anchor-drift 全 OK。

---

## 二、剩余事项

| # | 事项 | 状态 | 卡点 |
|---|---|---|---|
| **1** | **会话内容双渲**（talk/do 窗 `<transcript>` 与原生事件/function_call 重复同一消息全文） | **方案 B 已定，待实现** | 已定：会话留 message 流、talk/do 窗退句柄（用户拍板，因 LLM 标准输入/attention）—— 详见第三节 |
| 2 | transcript 包成"只挂 compress 的句柄窗"（S3 句柄部分） | 待实现 | 与 #1 同一改动单元；会话归 talk 窗（句柄）、动作日志归 transcript 句柄窗，都在 message 流、XML 只留句柄 |
| 3 | `open_knowledge` 在 `knowledge_base`（成员）与 `knowledge`（打开的知识窗）两个 class 重复（C1） | 未做 | 轻量；旧 root.open_knowledge 同时落到知识窗。可顺手收 |
| 4 | do → talk（do = talk(target=self-new)，推论一/S4） | 未做 | **xlarge + 10 个未决设计抉择**（跨 session self-fork？调度同 job vs 跨 job？回报路径统一？share_windows？）。map 见 workflow `axiom-impl-surface-map`。本会话无 do 窗故 context.xml 不显 |

> #1+#2 是同一改动单元（去双渲必然要定 transcript 怎么渲）。#3 独立轻量。#4 自成一阶段、需先定设计。

---

## 三、剩余问题 1 详述：会话内容双渲

### 现象（`tmp/context-after-s1s2.xml` 实证）

supervisor 的 thread 输入里，**同一份会话内容出现两次**：

| 信息 | 出现位置 1 | 出现位置 2 |
|---|---|---|
| user 任务消息全文 | `[0]` `<context>` → creator talk 窗 `<transcript><message source="user">` | `[2]` system 事件 `[context_change:inbox_message_arrived] … \n<全文>` |
| agent 回复全文 | `[0]` creator talk 窗 `<transcript><message source="talk">` | `[5]` `say` function_call 的 `arguments.args.msg`（全文） |

LLM 输入项实测结构（无原生 role=user/assistant 轮，会话全走 system + function_call）：
```
[0] system  <context>（含 talk 窗 transcript 两条全文消息）
[1] system  [ooc:paths]
[2] system  [inbox_message_arrived] msg_id=… \n<user 任务全文>     ← 与 [0] transcript 重复
[3] function_call        exec(filesystem, grep)
[4] function_call_output grep 结果
[5] function_call        exec(say, args.msg=<回复全文>)             ← 与 [0] transcript 重复
[6] function_call_output say 结果
```

### 根因（两套独立渲染路径覆盖同一数据）

- **事件日志路径**：`thread.events` 逐条 → `processEventToItems`（`thinkable/context/index.ts`）。inbox 到达、say 调用都是 event，渲成 system / function_call 项，**带全文**。
- **talk/do 窗 transcript 路径**：窗的 readable hook（`windows/do/index.ts` `renderDoWindow` / `windows/talk/index.ts` `renderTalkWindow`）把与对端的消息过滤后**内联渲**成 `<transcript><message>`，**也带全文**。
- 两条路径**不在同一去重链**上：现有 `consumedMessageIds`（`xml.ts`）只过滤 XML 顶层 inbox fallback，**不动事件日志**。于是 inbox 事件 + talk transcript 各渲一份。

这正是第一公理「同一份信息只渲一次」的真实违反——也是设计文档把它列为推论 3（transcript 句柄化）前置清理项的原因。

### 这违反公理、且代价随规模放大

- 单 peer 线程：每条往返消息 ×2，纯浪费 token。
- 多 peer / 长会话：事件日志把多个对话**交织**在一条流里，talk 窗按 peer **分组**——两份信息不仅重复，还以不同结构呈现，LLM 要自己对账"哪条 inbox 对应哪个窗"。

### 设计抉择：会话内容"谁渲一次"（**这是要拍的根问题**）

会话内容有两种表征被同时保留，必须二选一为 canonical、另一方退成"句柄/标记"：

**方案 A：talk/do 窗 `<transcript>` 为 canonical；事件/function_call 退成标记**
- 入站消息：`inbox_message_arrived` 事件**去全文**，只留标记（`msg_id` + `window_id`，"消息已到 talk 窗 X，去那读"）。
- 出站消息：`say` function_call 仍是动作记录（保留），但其 `args.msg` 全文与 transcript 重复——可让事件日志侧的 say 只留"已发往窗 X"，正文在 transcript 读。
- **优点**：会话按 peer 分组（多 peer 不串台）；talk 窗就是会话视图；契合"everything is a window"+ 公理。
- **代价**：会话内容只在窗里、不在线性事件流；LLM 读"我刚做了什么"时，对话动作要去窗里看（但 grep 等非会话动作仍在事件流）。

**方案 B：事件流为 canonical；talk/do 窗 transcript 退成句柄**
- talk/do 窗只渲句柄（peer + status + 方法 say/wait/close/compress），**不内联消息**；会话内容在事件流（inbox 事件 + say function_call）读。
- **优点**：talk 窗成纯方法挂载点（与 transcript 句柄窗的公理完全一致——内容外移到事件流）；线性流是 LLM 熟悉的顺序历史。
- **代价**：多 peer 会话在事件流里交织、不按 peer 分组；丢"干净会话视图"，多对象协作时 LLM 要自己分辨消息归属。

### 决定：方案 B（用户 2026-06-14 拍板，决定性因素 = LLM 标准输入/attention）

> 起初倾向 A（talk 窗 transcript canonical、事件去标记），但**被用户否定**：thread.events 本就处理成 LLM Input 的
> **message items**（`[2]` inbox 事件、`[5]` say function_call 都是独立 item，被 LLM 标准 attention 覆盖）。
> 若把会话内容留在 context XML（A）而从 message 流剥掉，等于**埋进大 system blob、与 LLM 标准输入不匹配、易丢 attention**。
> 故反向：**会话内容只留 message 流，context XML 里的 talk/do 窗退成句柄**。

**复核**：会话内容**已经在 message 流里**（`[2]` 入站事件全文、`[5]` 出站 say function_call 全文）。真正冗余的是
`[0]` context XML 里 talk 窗 `<transcript>` 的**内联拷贝**。去掉它即同时满足：①去双渲；②匹配 LLM 标准输入、保 attention；
③契合第一公理（talk 窗内容外移到 message 流，窗=方法挂载点+在场，与推论 3 transcript 句柄窗完全一致）。

**职责切分（B 的本质）**：
- **context XML（单条 system 环境快照，作引用读）**：窗结构 + 方法契约 + 非会话状态。**不含会话内容**。
- **message-item 流（原生顺序，重点 attend）**：会话（入站事件 / 出站 say function_call）+ 动作（grep/program 等 function_call+output）。

### 落地形态（方案 B）

1. talk/do 窗的 readable hook（`renderDoWindow`/`renderTalkWindow`）**不再内联 `<transcript><message>` 正文**，改渲句柄：peer/target + status + 轻量 meta（消息条数 / 最近一条 from 谁）+ 方法（say/wait/close/compress）。
2. 会话内容保持在 message 流（`processEventToItems` 的 inbox 事件 + say function_call 不变）——**这是被 attend 的 canonical 副本**。
3. 顺势把线程自身动作日志（transcript）按推论 3 包成**句柄窗**（#2）：会话+动作都在 message 流、context XML 只留句柄，各渲一次。
4. `set_transcript_window`（per-talk-窗 viewport）与事件流 compress（折叠中段）职责重叠——B 下 talk 窗无内联 transcript，viewport 失去对象；待评估是否并入 events-compress（一处控历史长度）。
5. 测试：新增「同一 msg_id / 同一消息正文在 LLM 输入只出现一次」断言（锁死公理）；reframe 依赖 talk 窗内联 transcript 的现有测试。

> 风险：改 talk/do readable + 真实会话回归，验证句柄化后 LLM 仍能正确跟进多 peer 会话（attention 反而应更好——内容在原生 message 流而非 XML blob）。prompt-cache：context XML 变小且更稳定（不随每条消息膨胀），利于缓存。
