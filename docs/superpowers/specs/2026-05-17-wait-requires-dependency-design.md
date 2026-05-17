# Wait requires explicit IO dependency

**日期：** 2026-05-17

## 目标

把 OOC 的 `wait` 原语从"无约束的 idle 兜底"改造成"必须显式指向一个未来 IO 来源 window 的依赖声明"。

具体：`wait(reason: string)` → `wait(on: window_id, reason?: string)`，且 `on` 必须 resolve 到当前 thread 一个 open 状态、被允许产生未来 IO 事件的 ContextWindow（talk / do / 等）。若 thread 内没有任何这样的 window，wait 直接 reject，LLM 被引导到 `end` 或先创建 IO 依赖（如先 `say` 再 `wait(on=<talk>)`）。

## 背景

### 现象

真 LLM e2e（`tests/e2e/backend/backend-rename-symbol-via-edit.e2e.test.ts` S1）与多个 integration test 反复出现同一种行为漂移：LLM 完成实际任务（改对了文件 / 拿到了计数）后，**直接 `wait("...")` 卡进 waiting**，从不 `say` 回 creator、也不 `end` 收尾。结果：

- callee thread：用户收不到结果，对外等同于"没做"
- 自驱 root thread：永远挂 waiting，没人能"知道完成了"

加了多层文本 nudge 都只把 OK 率从"偶发漂"提到"1/3 OK"，没根除。

### 根因

`wait(reason: string)` 在 5 原语里是**唯一一个完全无 referent**的原语：

| 原语 | referent |
|---|---|
| `open(command, ...)` | 必须指定 command（注册在某 window 上） |
| `refine(form_id, args)` | 必须引用 form_id |
| `submit(form_id)` | 必须引用 form_id |
| `close(window_id)` | 必须引用 window_id |
| **`wait(reason)`** | **只有 free text** |
| `compress` | 元操作，无副作用 |

`reason` 是文档性字段（observability 用），不是 referent。这意味着 `wait` 在结构层面**允许 LLM 在任何状态下 idle**。Bug 不是 LLM 不守规矩，是规矩允许它这样。

protocol KNOWLEDGE 里写的"决策树"（先 say 再 wait / 自驱 root 应 end）是**软约束**，靠 LLM 自觉；运行时不阻拦。LLM 在文件修改类任务中（"我把文件改对了 = 我答复了"的本能心智下）会绕过软约束。

### OOC 哲学一致

OOC 的演化历史（见 `meta/iteration.doc.js` 阶段 9）核心叙事是把 `activeForms / windows / pinnedKnowledge` 三种概念**收敛到统一 ContextWindow**——"**任何持续存在的语义都应当挂在 window 上**"。

`wait` 当前破了这条：它表达的"我在等 IO"是一种**有状态、有 referent 的语义**，但没挂任何 window。`wait(on=window_id)` 把这个语义纳回 OOC 世界观——等的 IO 来源必须是 context 里已有的 window，wait 是 window 之间关系的一次显式声明。

## 关键决策

### 1. 新 schema

```ts
wait({
  title: string,         // 已有；一句话说明本次 wait 的语义
  on: string,            // 必填；指向当前 thread 内一个 open 状态、可产生未来 IO 的 ContextWindow id
  reason?: string,       // 可选；observability 用，不参与 dispatch
  mark?: ...             // 已有；inbox msg 标记
})
```

`on` 是必填、且必须 resolve。`reason` 降为可选（不再承担"决策入口"角色，纯日志）。

### 2. 合法 `on` 类型

只有以下 window 类型的 open 实例可以被 wait 引用：

| 类型 | 语义 | 合法性 |
|---|---|---|
| `talk_window` | 等对端发新消息到本 talk | open + 本 thread 是 callee 或本 talk 已 say 过至少一次（已建立"等回信"的预期） |
| `do_window` | 等子线程 outbox 回报 | open + targetThreadId 存在 + 子线程仍 running / waiting |
| 其它（`file` / `knowledge` / `search` / `program` / `todo` / `root` / `command_exec`） | 不产生未来 IO | **不合法** |

注：
- `talk_window` 的合法性细分讨论：纯被创建（callee 还没回任何 say）的 creator talk_window 在哲学上"是等过来的，不是等回的"——但为了不强制 LLM 在 `wait` 前必须 `say` 一次（某些异步场景 LLM 想先 wait 看用户后续意图），保留**所有 isCreatorWindow=true 的 talk 都合法**。
- LLM 自己 `open(command="talk", ...)` 出去的非 creator talk_window，至少 `say` 过一次才合法（否则没人会回它）。

### 3. 校验与错误形态

`handleWaitTool` pre-check：

1. `on` 字段缺失 / 类型错 → reject：
   ```
   [wait error] wait 必须指定 on=<window_id>，指向你正在等待事件的 window。
   当前 thread 内可作为 IO 来源的 open windows：
     - w_talk_xxx (talk, target=user, isCreatorWindow=true)
     - w_do_yyy (do, targetThreadId=t_child_zzz, status=running)
   若没有合适的来源（任务已完成无更多 IO 期望），改用 end command 收尾。
   ```
   错误体里**枚举当前合法 `on` 候选**，LLM 下一轮自纠成本最低。

2. `on` resolve 失败（window 不存在 / 已 closed） → reject 并枚举合法候选（同上格式）

3. `on` 类型不合法（指向 program / file / knowledge 等） → reject 并说明哪些类型合法、当前 thread 有哪些合法的

4. `on` 是 LLM 自建（非 creator）的 talk_window 且尚未 `say` 过 → reject：
   ```
   [wait error] 你引用的 talk_window w_talk_xxx 还没有 say 过任何消息——
   对端不知道有人在等回信。请先 open(parent_window_id="w_talk_xxx", command="say", ...) 发出去，再 wait。
   ```

5. 当前 thread **没有任何合法 `on` 候选** → reject：
   ```
   [wait error] 本 thread 没有任何可等待的 IO 来源（无 creator talk_window、
   无 open do_window、自建 talk_window 也未 say 过）。
   这意味着任务已经完成且不期望更多输入——请用 end command 收尾，summary 写
   本次工作结论。
   ```
   这是修 Bug 2 最核心的分支：自驱 root thread / callee 没建对话 / 已 say 完且没后续——都被强制走 end。

所有 reject 都遵循 `llm-tool-handlers-fail-loud-2026-05-15.md` 约定：actionable 文本、列出当前合法选项、给出"如果不该 wait"的替代动作。

### 4. wakeup 逻辑

Phase 1 不改 wakeup 机制：

- 现状：scheduler 看 `thread.inboxSnapshotAtWait`，inbox 长度增加就 wakeup
- 新 wait 仍写 `inboxSnapshotAtWait`，但同时把 `on` window id 记到 thread 上一个字段 `waitingOn?: string`（观察/调试用，不参与 wakeup 决策）
- 任何 inbox 新消息（不论是不是 `on` 指向的对端发的）都唤醒——保持简单

理由：现有 wakeup 已足够工作；增加"按 cited window 精确唤醒"是 Phase 2 工作，独立 spec。

如果未来要严：只有 `on=<talk_window>` 的新 inbox msg `replyToWindowId === waitingOn` 时才 wakeup；其它 inbox（系统消息 / 不相关 talk）累积但不唤醒。这要在 ProcessEvent / msg metadata 层加精细 routing，超出本期。

### 5. 持久化

- `thread.waitingOn?: string`——新增可选字段；仅 status=waiting 期间持有；wakeup 后清空（与 `inboxSnapshotAtWait` 同生命周期）
- 旧 thread.json 没该字段时按 undefined 处理（向前兼容）
- 持久化反序列化无需 shim

### 6. 协议 KNOWLEDGE 改写

`src/executable/index.ts` KNOWLEDGE 中 `wait` 那行：

旧：
> wait(reason)：把当前 thread 切到 waiting，等待 inbox 新消息后唤醒

新：
> wait(on, reason?)：声明你在等指定 window 上的未来 IO 事件，把 thread 切到 waiting。
> on 必须指向当前 contextWindows 里 open 状态的 talk_window 或 do_window；
> 没有合法 on 时不能 wait——意味着任务完成 / 无 IO 预期，应该 end 收尾。

"一轮结束前决策树"段（2026-05-17 早些时候加的）可以简化——bullet 2 的"自驱 root 应 end"现在由 wait 校验**结构性保证**，不再需要靠协议文本提醒：

```
1. callee thread 完成工作 → 先通过 creator talk_window 的 say 回复（否则对面看不到结果）；
   之后想等下条消息就 wait(on=<creator talk_window>)，没有期望就 end。
2. 自驱 root thread 完成工作 → end with summary。
   （没有任何 talk/do window 可等，wait 会被 reject。）
```

`docs/solutions/conventions/reuse-before-introducing-new-concepts-2026-05-17.md` 不变——本 spec 没新增 window type / 新字段（waitingOn 是观察字段，不引入概念）。

### 7. 工具描述的同步

`WAIT_TOOL.description` 必须与 KNOWLEDGE 同步改写（参见 `llm-tool-handlers-fail-loud-2026-05-15.md` 第 1 条"单一名字到处"），简短版：

> 把 thread 切到 waiting，等待 on 指向的 talk/do window 上的未来 IO。on 必填且必须 resolve 到当前 contextWindows 里 open 的 talk_window 或 do_window。没有合法 on 时不能 wait——应改用 end。

## 与现有概念的关系

| 既有概念 | 关系 |
|---|---|
| `inboxSnapshotAtWait` | 保留，wakeup 仍靠它 |
| `creatorThreadId / creatorObjectId / isCreatorWindow` | 校验 `on` 合法性时复用——判断 talk_window 是不是 creator |
| `do_window.targetThreadId` | 校验 `on=do_window` 时检查 child thread 仍 running |
| `talk-delivery` | 不变。callee thread 自带 isCreatorWindow=true 的 talk_window，自然满足"可 wait" |
| 协议 KNOWLEDGE 决策树 | 简化（结构性约束接管，文本只剩说明） |
| 2026-05-17 加的 todo "回复创建者" | **可以撤销**。新 wait 不放行"没 say 就 wait"，todo 的提醒作用被结构性约束替代 |

## 迁移路径

1. **加 schema 字段**（`src/executable/tools/wait.ts`）：
   - 改 `inputSchema`，`on` 加入 `required`
   - `reason` 从 required 降为 optional
2. **加校验**（同文件 `handleWaitTool`）：扫 thread.contextWindows 找候选；按上面 5 条分支返回 actionable 错误
3. **写 `thread.waitingOn`**（观察字段，可选）
4. **改 `WAIT_TOOL.description`** 同步新语义
5. **改协议 KNOWLEDGE**（`src/executable/index.ts`）
6. **撤 todo**（`src/executable/windows/talk-delivery.ts` 第 118-138 行）
7. **新增单测**（`src/executable/tools/__tests__/wait.test.ts`）：
   - happy: `wait(on=<creator talk>)` 合法 → thread.status=waiting
   - reject: 缺 on / on 不存在 / on 类型不对 / on 是未 say 过的自建 talk / 没有任何候选
   - 错误消息含合法候选枚举
8. **e2e 真 LLM 验证**：
   - S1 (rename) 跑 5+ 次看 OK/Good 率是否到 ≥4/5
   - S3 (multi-turn) 仍 Good
   - integration tests 中 6 个 fail（root thread 不 end 的）转为通过

## 风险与不在本期

### 风险

- **真有"无 IO 依赖但应该 wait"的合法场景吗？** 我的判断：不存在。若 thread 没有任何 IO 依赖，要么任务完成（end）、要么任务卡了（end with failure）。"无依据 wait" 在生产意义上一直是 bug，只是没人审视过
- **LLM 第一次撞 schema 会失败**：错误消息要够清晰让它一次自纠。这是 `llm-tool-handlers-fail-loud-2026-05-15.md` 的应用场景

### 不在本期

- **精确 wakeup**：按 cited window 类型决定哪种事件唤醒（Phase 2，独立 spec）
- **wait 的 timeout 语义**：当前 wait 是无超时的；引入 `timeoutMs?` 是独立需求
- **跨 thread / 跨 session 的等待**：当前 wait 只看本 thread 的 inbox。跨 session 协作（如 Alice thread 等 Bob session 的事件）不在本期
- **compress 同质化**：compress 也是无 referent 原语，但它没有"wait 那种被滥用的问题"——LLM 没动机随便 compress（行为成本高），暂不动

## 验证方式

### 单元层

- `wait.test.ts` 覆盖 5 条 reject 分支 + 1 条 happy
- thread-json 持久化往返单测：`waitingOn` 字段读写正确

### 集成层

- 现有 integration tests（`tests/integration/_fixture.ts` makeRootThread 路径）跑完后，原来 6 个"status=waiting 应为 done"的 fail 全部转通过
- 新增一个 integration test：自驱 root thread 收到 prompt → LLM 尝试 wait → 被 reject → 走 end → 全程 ≤ N tick

### e2e 层

- S1-S4 backend e2e 全部走 ≥ OK；S3 仍 Good
- 撤掉 talk-delivery 的 todo 改动后，行为应该不退化（todo 现在 1/3 OK；新机制目标 ≥4/5 OK）

## Open Questions

1. **`on` 是否允许指向 root_window**？root_window 自身不产生 IO（它是各 command 的注册器），按当前设计不允许。但有没有边界 case？目前看不到，暂不允许
2. **`wait(on=<creator do_window>)`**：currently creator do_window 不可 close，但它也是"等回信"的语义入口。允许。校验逻辑里 do 类型走通用 do 路径
3. **Phase 1 wakeup 不变意味着 LLM 在 wait(on=<creator_talk>) 期间也会被无关 inbox 唤醒**——这是"宽松唤醒"的代价。可接受：唤醒后下一轮 LLM 自己看 inbox 内容判断是不是它等的、不是就 wait again。频次很低
