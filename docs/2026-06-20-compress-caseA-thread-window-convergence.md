# compress Case A —— 自视折叠载体收敛到 thread 窗（设计 spec）

**状态**：设计已敲定（两轮 grill 锁定统一模型），待分增量实现。
**性质**：架构债收口 + 概念退潮，不是新功能。
**入口**：`docs/2026-06-20-compress-overview.md` §4.2（Case A）；设计权威 `.ooc-world-meta/.../children/thinkable/knowledge/compress.md`（Case A + 3.4）与 `context.md`（核心 9/10、3.7）。
**前置已落**：events compress 机制（`48b285c5`）、transcript 纳预算（`9376ffd8`）、应急钳制（`53c9d502`）、Case B tool-pair 吸附（`503c933e`）。

---

## 一、目标与边界

### 目标
把 **self 视角 events 折叠态的载体**从 **self 门面窗**（`isSelfWindow`、非持久化、靠写盘后门、stone 冷启动丢窗）收敛到 **「自己视角 thread 窗」**（`THREAD_CLASS_ID`、inline 天然持久化）。兑现 `context.md` 核 9/10 的归宿。

### 锁定的统一模型（两轮 grill 的结论）
**没有"creator 窗"这个概念**。一条 thread 恰好一个 **thread 窗**（= current thread = 过程），**creator 对话是它内建的上游通道**（有就有、没有就空）。今天代码里的"creator 窗"从来就是这个 thread 窗，只是按它的上游端点（creator）误命名了。

| 主体 | 窗 | class | 内容 | 是否持久化 folds |
|---|---|---|---|---|
| **自己**（identity） | self 门面窗 | `objectId` | self.md（POV-keyed） | —（不承载 folds） |
| **当前过程** | **thread 窗**（always 注入，含 self-driven root） | `THREAD_CLASS_ID` | thread.events + （可选）creator 对话通道 | ✅ `win.summarizedRanges`（inline 落 thread-context.json） |
| peers/subs | 各自 `talk` 窗 | `THREAD_CLASS_ID` | 与对端的 messages | ✅（messages 坐标，已落地） |

**关键推论**：self-driven root 不再是特例——它就是"上游通道为空的 thread 窗"，而非"合成一个特殊窗"。

### 新设计下的 context 组成 + 「自己 / 过程」三表达
`buildInputItems` 的 `input[]`：`<context>` XML（含 `<self>` 标记 + `<thread>` wrapper：`<window_classes>` 方法契约 + `<context_windows>` 各窗 + `<context_overflow>`）→ budgetWarning? → `[ooc:paths]` → clampMarker? → transcript（thread.events message 流，按 **thread 窗** win.summarizedRanges 折叠）。

| 表达什么 | 载体窗 | 在哪渲 | 怎么调 |
|---|---|---|---|
| **self.md**（身份） | self 门面窗 `objectId` | `<context_windows>` 该窗 self 视角内容（`resolveProjection`→`readSelf`；peer 视角换 `readable.md`）+ 根 `<self>` 标记 | 不可调 |
| **self methods**（agency：evolve_self/create_object/custom） | self 门面窗 `objectId` | `<window_classes>` 按 class=objectId 聚合一次；**exec 无 window_id 默认打它** | exec(method=…) object method |
| **过程**（events + creator 对话 + **folds**） | thread 窗 `THREAD_CLASS_ID` | `<context_windows>` 渲**句柄**（只 methods）；内容（events）进 message 流；**folds 存其 win** | exec(window_id=thread 窗, compress scope=events) |

> **「自己」(self.md + agency) 留 self 门面窗，「过程」(transcript + folds) 归 thread 窗**——即 self≠thread 主体之分落到三表达。
> **关键事实（破我此前含糊）**：self 门面窗**不是"纯 identity"**——它仍是自我命令面 = self.md + self methods，exec 默认目标不变；它**唯一失去的是会话/events 折叠承载**。
> **已知漂移（待回流）**：`context.md` 3.1 表称「instructions = self.md 正文，唯一身份来源」**已与代码不符**——`index.ts:474`/`xml.ts:317` 明确 self.md 不进 instructions、只作 self 门面窗 self 视角内容渲入 `<context>`。

### 非目标
- 不改 events compress 机制本身（`summarizedRanges` / 两 scope / 三层防溢出 / tool-pair 吸附）。
- 不动 peer 视角 messages 折叠（`filterTalkMessages` / `conversation-render`，已对称落地）。
- 不把 compress 重做成 tool 原语（稳定原语恒 3 个：exec/close/wait）。
- 不让框架自动推进持久压缩态（auto 兜底只做瞬态钳制）。
- 不改 thread 窗 id 字符串 `w_creator_<threadId>`（保持持久化兼容；字符串清理列为可选 cosmetic 收尾）。

---

## 二、核心设计：两个谓词拆分（退潮主轴）

今天 `isCreatorWindowId(id)` 被**两种语义共用**——因为 root 根本没有 thread 窗，二者恰好同真。收敛后 root 有了 thread 窗，必须拆开：

1. **`isSelfThreadWindow(id)`**（自视检测，id-based）：这是不是本 thread 那**唯一一个** thread 窗。`creatorWindowIdOf` 重命名为 `threadWindowIdOf`，仍生成 `w_creator_<threadId>`；`isCreatorWindowId` 重命名为 `isSelfThreadWindow`，仍判 `w_creator_` 前缀。**root 的 thread 窗用同一 id 模式 → 自视检测对 root 自动成立、零特例。**

2. **`hasCreatorChannel(w)`**（上游通道存在，data-based）：本 thread 窗有没有真正的上游 creator（`data.target` 存在 或 `data.isForkWindow`）。**creator 特有的 affordance 一律 gate 在此谓词上**，而非 gate 在"是不是 thread 窗"。root 的空通道 thread 窗 → `hasCreatorChannel=false` → 不触发任何 creator affordance。

> 这条拆分是本次的**根**：把"过程窗（自视、承载 folds）"与"上游通道（可 say/可 wait 的 creator）"两个被 `isCreatorWindowId` 揉在一起的概念分开。对现存派生线程**行为完全不变**（它们 `hasCreatorChannel` 恒真）；唯一新行为是 root 多一个空通道过程窗。

### 谓词归属表（实现清单）

**用 `isSelfThreadWindow`（自视；含 root）：**
- `projection-class.ts:35` —— 自视 → `thread`/`reflect_request`（super）。
- `context/index.ts:73` `resolveInboxWindowId` —— 优先选自己的 thread 窗。
- `context/index.ts:91` `isCreatorWin` —— 主线消息全文（强 attend）。
- `context/index.ts:454`（读侧折叠源）—— **从 thread 窗读 `summarizedRanges`**（原来读 self 门面窗，本次改）。
- `flows/service.ts:508/817` —— 从 peer/talk 列表里排除自己的 thread 窗。
- `thread/readable/index.ts:77`、`conversation-render.ts` —— handle vs transcript 判定。

**用 `hasCreatorChannel`（有上游；root 为假）：**
- `wait.ts:46/181` —— "等 creator 发新消息" 的 IO 源（root 无通道 → 不是合法 wait 目标，承接旧 `!hasRealCreator` 守卫的目的）。
- `method.end.ts:39` `findCreatorWindow` —— end({result}) auto-reply 目标（root 无通道 → 维持今天"忽略 result"的优雅降级）。
- `talk-delivery.ts:106` `isCreatorReply` —— 回 creator 的派送分流。
- `protocol.ts:130` —— creator-reply 协议知识窗只对有通道的 thread 窗生成（root 不生成）。
- `thread/readable` `thread` 投影菜单 —— `say` object_method 仅在 `hasCreatorChannel` 时 surface（root 的过程窗无 creator 可 say）。

---

## 三、各区改动

### A. init.ts —— 始终注入 thread 窗
- 把今天 `!hasRealCreator` 的**早退**（init.ts:115-119）改为：**仍注入 thread 窗**，只是**creator 通道 data 条件化**。
  - id = `threadWindowIdOf(thread.id)`（= `w_creator_<threadId>`），class = `THREAD_CLASS_ID`。
  - `hasRealCreator` → data 带 `target/targetThreadId/isForkWindow`（与今天 creator 窗一致）。
  - self-driven root → data **不带**这些（纯过程窗）。
- `win`：保留 `transcriptViewport`；folds（`summarizedRanges`）落此 win。
- `user.root`（`isUserRootThread`）维持今天行为（非 agent、不在本次范围）。
- 幂等：reload 后 hydrate 已从 thread-context.json 还原该 thread 窗（inline 持久化）→ init 幂等检查 id 存在即跳过 → 持久化的 win（含 folds）存活。

### B. 写侧 —— 能力归属（Q2 拍板）
- **events-compress 归 thread class**：把 `compress`/`expand` 的 `scope=events` 分支声明进 `thread/readable/index.ts` 的 `window[]`（`thread`/`talk`/`reflect_request` 三投影都挂），与 `set_transcript_window` 并列。
- **universal default 只留 `scope=windows`**（`default-window-methods.ts`：compress/expand 保留 compressLevel 档位；`scope=events` 在通用层返回**自然报错**「此窗无过程/会话 transcript 可折，events 折叠属你的 thread 窗 <id>」——silent-swallow-ban idiomatic）。
- 后果：**写读对齐成为能力归属的自然结果**——agent 只在 thread 窗菜单看到 events 折叠 → 只能 `window_id=thread 窗` 调它 → folds 落对窗。**exec default 完全不动**（无 window_id 仍默认 self 门面窗，object-method 命令面不回退）。错窗调 events-compress 得自然报错，非硬编码 redirect。

### C. 读侧 —— 折叠源改 thread 窗
- `context/index.ts:454`：`find(w.win?.isSelfWindow===true)` → `find(w => isSelfThreadWindow(w.id))`，从 thread 窗读 `summarizedRanges`。其余（`snapRangesToToolPairs` + `projectSummarizedRanges` 折 `thread.events`）不变。

### D. 持久化 —— 删后门 + 冷启动洞消失
- 删 `thread-persist.ts:73-82` 的 **self 门面窗带 summarizedRanges 就 inline 落盘**后门（folds 不再挂 self 门面窗 → 后门永不触发）。
- folds 现挂 `THREAD_CLASS_ID`（`isInlinePersisted=true`）→ 整窗 inline 落 thread-context.json，**无后门**；`THREAD_CLASS_ID` 是 builtin 类**恒注册** → hydrate 不再 `registry.has=false` 丢窗 → **冷启动丢 folds 洞消失**（builtin 类无碍，stone 对象的 thread 窗同样安全因为载体是 builtin thread 类而非 stone class）。
- `isSelfWindow` 标记**保留**：self 门面窗仍非持久化（`isNonPersistedWindow`）+ 确定性重建 + xml POV 渲身份。它只是**不再承载 folds**。

### E. self 门面窗 —— 保留 identity + agency，仅卸下 folds
- **仍是自我命令面**：self.md（POV-keyed 渲染 `xml.ts:324` `isSelfView`→`readSelf`/`readReadable`，不动）+ self methods（class=objectId 在 `<window_classes>` 聚合，不动）+ exec 无 window_id 默认目标（不动）。
- **唯一变化**：不再承载会话/events 折叠、不要持久化后门。menu 上 events-compress 因 §B 移走而消失（只剩 scope=windows 档位）。

### F. root 涟漪（逐钉，统一规则：creator affordance gate 在 `hasCreatorChannel`）
- `end`：`findCreatorWindow` 用 `hasCreatorChannel` → root 仍返回 undefined → 维持"忽略 result、仅记 endSummary"（method.end.ts:113-124 既有降级路径不变）。
- `wait`：creator 分支 gate `hasCreatorChannel` → root 过程窗不是合法 wait 目标（替代 `!hasRealCreator` 不注入窗的旧守卫）。
- `protocol.ts:130`：creator-reply 知识只对 `hasCreatorChannel` 的窗生成 → root 不生成。
- `thread` 投影菜单：`say` 仅 `hasCreatorChannel` 时 surface → root 过程窗无 `say`。
- 自检：self-driven root 怎么 `end`（无通道 → 走 endSummary 路径，已验）；root 过程窗渲染（handle、菜单 = `set_transcript_window` + compress/expand，无 say）。

---

## 四、坐标系与视角隔离（不变量，确认不冲突）
- self 视角：thread 窗 `summarizedRanges` = **events 坐标**，`buildInputItems` 折 `thread.events`。thread 窗自视渲**句柄**（`renderTranscriptOrHandle` isCreator/self=true），不内联 transcript → conversation-render **不**用它折 messages → **同一窗在自视下 summarizedRanges 只服务 events 折叠，无坐标系混用**。
- peer 视角：talk 窗（**另一 thread context 里的另一实例**）`summarizedRanges` = messages 坐标，conversation-render 折 messages。per-view 隔离（core4）→ 与自视 thread 窗各持各 win，零污染。
- ⚠ 实现期必须复核：自视 thread 窗走 handle 分支时 conversation-render **确实不读/不渲** `summarizedRanges`（否则与 events 折叠抢同一字段）。

---

## 五、测试与验收

### 改/补
- **跨 job e2e gate（新，核心交付）**：把 `tests/e2e/backend/context-compression-p0f-events.test.ts`（`describe.skip`、测退役 `_foldedBy`）改为**活 gate**：agent compress(scope=events) 经 thread 窗写 `summarizedRanges` → `scheduler_yielded → reload`（参考 `backend-reflectable-sediment.e2e.test.ts:67+` + `_fixture.ts:529` `waitForSuperFlow` / `thread-context-bypass-reload.test.ts` writeThread+readThread）→ 断言 reload 后 folds 存活、投影仍折叠。**含 self-driven root 用例**（root 过程窗 folds 跨 reload 不丢）。
- `context.test.ts`（thinkable/__tests__:710+ events compress self-view fold）：读侧改从 thread 窗取 folds；补 root 过程窗折叠用例。
- `storybook/stories/L2_thinkable.stories.ts`（L2-COMPRESS-EVENTS）：write-side 断言 events-compress 解析到 thread class（非 universal）。
- `real-compress.test.ts`（`RUN_REAL_COMPRESS_TEST`）：真 LLM 经 thread 窗 `window_id` 折 events；验证菜单可发现性（thread 窗句柄渲 compress + id）。
- rename 波及的 `__tests__`（isCreatorWindowId/creatorWindowIdOf 用例）随符号改。

### 验收
- `bun run verify` 全绿（含 check:doc-drift / check:deprecated-symbols / check:anchor-drift）。
- 真 LLM（`.env`，`RUN_REAL_COMPRESS_TEST=1`）：自压缩 + **跨 job reload 折叠不丢**。
- 不破坏 peer 视角 / attention 分层 / fork / reflect_request / 持久化。

### 工作方式
中间增量**打破存量测试只登记账本**（不逐步修）；源码全改完**统一跑绿**。派 sub-agent 须明确"不修测试只登记账本"。

---

## 六、增量顺序（喂给 writing-plans）

1. **纯重命名**（行为不变）：`isCreatorWindowId→isSelfThreadWindow`、`creatorWindowIdOf→threadWindowIdOf`（id 字符串不动），全树 + 测试。跑绿。
2. **引入 `hasCreatorChannel` + 拆谓词**：wait/end/talk-delivery/protocol/thread-readable-`say` 由 `isSelfThreadWindow`→`hasCreatorChannel`。现存线程恒真 → 行为不变。跑绿。
3. **init 始终注入 thread 窗**（creator 通道条件化）→ root 得空通道过程窗。登记坏测试。
4. **写侧能力归属**：events-compress 移入 thread class、universal 去 events scope。登记坏测试。
5. **读侧折叠源改 thread 窗**（index.ts:454）。登记坏测试。
6. **删持久化后门**（thread-persist.ts:73-82）+ 验冷启动洞消失。登记坏测试。
7. **统一修测试 + 新跨 job e2e gate**：修账本、改 context.test/storybook/real-compress、活化 describe.skip e2e。`bun run verify` 绿 + 真 LLM。
8. **文档回流**：`compress.md` Case A 标为已解 + 3.4 复核；`context.md` 3.7 两行迁移映射收尾 + **修 3.1 instructions 漂移**（self.md 不进 instructions、只作 self 门面窗 self 视角内容）+ 核 9/10 措辞与统一 thread 窗对齐；`overview` §4.2 → 已落。对象树 commit + push origin main（ooc-0）；docs/ 与代码同 commit。

---

## 七、风险与复核点
- **坐标系抢字段**（四节 ⚠）：自视 handle 分支必须不碰 `summarizedRanges`。
- **rename 影响面广**（~15 非测试点 + 前端镜像 `web/.../context-snapshot.ts` + 测试）：增量 1 隔离为纯机械改、先绿，降低后续语义改的噪声。
- **root 过程窗的渲染/菜单**：确认 `thread` 投影对空通道窗不崩、不误 surface creator affordance。
- **id 字符串 `w_creator_`** 保留（持久化兼容）；语义已由符号表达，字符串清理可选。
- **二手警惕**：实现期每条断言对代码复核（本 spec 锚点均第一手 + workflow 核验，但代码会漂）。
