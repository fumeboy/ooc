---
title: Super Flow Phase 1 — Channel-Only Slice
status: active
date: 2026-05-18
type: feat
origin: docs/brainstorms/2026-05-18-super-flow-channel-requirements.md
---

# Super Flow Phase 1 — 通道贯通切片

> **范围**：让 alice 在普通 session 里 `talk(target="super")` 起一个属于
> alice 自己的 super flow、跑一轮 LLM、自然 end；父 thread 收到 child:end
> 唤醒。**Phase 1 不含任何 Stone mutation。**
>
> **关键反转**：抛弃 reflectable doc 原本的三处特殊性（`stones/{id}/super/`
> 特殊落盘、SuperScheduler、路径级 ACL），super flow 工程上就是
> sessionId="super" 下的普通 flow object。

---

## 1. 问题域 & 目标

**问题**：OOC 设计上承诺"Object 能反思、迭代、修改自己"，但 reflectable
概念是 forward-looking 的——`src/` 下 `grep super` 不到任何代码，
project-status.md 也未列入路线。

**本切片目标**（origin §1 + §2）：把 super flow 从概念变成最小可演示通道，
不引入新调度器 / 新落盘 schema / 新原语。验证假设："super 就是约定 sessionId
下的普通 flow，所有特殊性靠约定 + reflectable knowledge 引导"。

**显式不在本切片**（origin §3）：
- Stone 写权 ACL（用户已 accept "阶段一不限制"）
- SuperScheduler / 独立调度
- `stones/{id}/super/` 特殊落盘位置
- 跨对象 super 调用（`talk(target="critic/super")` from alice）
- Stone mutation 真实演示（用 file_window.edit 后续验证，不是本切片裁判）

---

## 2. 关键技术决策

### D1. target="super" 是自指别名

`talk(target="super")` 在 talk-delivery 解析时强制翻译为：
- `calleeObjectId = caller.objectId`（自指）
- `calleeSessionId = "super"`（跨入 super session，与 caller 当前 session 解耦）

理由：alice 调 super 意思是"alice 的 super 分身"，不是"叫 super 的对象"。
critic 调 super 也只能解析到 critic 自己的 super。Phase 1 不暴露
`alice/super` 跨对象路径——延后到 Phase 3。

### D2. 复用 talk-delivery，松绑同 session 约束

`src/executable/windows/talk-delivery.ts:8` 注释明确说"跨 session talk 不在
本期"。本切片把它放进本期。修改面：

- caller 写 outbox 用 `callerRef`（不变）
- callee 创建 / 读写用新 `calleeRef = { baseDir: callerRef.baseDir,
  sessionId: calleeSessionId, objectId: calleeObjectId }`
- 双写 thread.json 时各用自己的 ref

risk：talk-delivery 之外是否别处依赖"caller / callee 共享 sessionId"？
已知 `worker.ts:18` 按 (sessionId, objectId, threadId) 排队，跨 session
派送 → 各 session thread 各自入队没问题；`scheduler.ts` 只走单 thread 树
不涉及 session。

### D3. reflectable knowledge 走 protocol 通道，sessionId 门控

`src/executable/index.ts:collectExecutableKnowledgeEntries` 在拼
`protocolEntries` 时新增：若 `thread.persistence?.sessionId === "super"`，
注入 `internal/executable/reflectable/basic` knowledge entry。

理由（origin §5.2 已选）：不动 activator schema、不要 stones/ 下 reflectable
md 文件、零持久层改动。Phase 1 reflectable knowledge 写在源码常量里
（类似现有 `KNOWLEDGE` / `ROOT_KNOWLEDGE`），后续要 per-object 自定义再升级
到 activator 路径。

### D4. createFlowSession + seedSession 拒绝用户操作 sessionId="super"

`"super"` 是受保护 sessionId。用户通过 HTTP API 创建 session 必须 reject。
后端内部 talk-delivery 自己按需创建则 OK（直接 import
`persistable.createFlowSession`，不走 service 入口）。

### D5. 执行姿态：integration test 先行

按 origin §4 三档评分基准，Good/OK/Bad 由 e2e 观察值决定。U4 先写
integration test，让 test 从 Bad → Good 随 U1-U3 渐进。

---

## 3. 实施单元

### U1. talk-delivery 解析 target="super" 别名 + 跨 session 松绑

**Goal**：让 talk-delivery 识别 `target="super"` 并把 callee 派送到
`sessionId="super"` 下，复用现有派送逻辑。

**Requirements**：origin §3 "包含" #1 / #2，§5.1

**Dependencies**：无

**Files**：
- `src/executable/windows/talk-delivery.ts`（修改）
- `src/executable/windows/__tests__/talk-delivery.test.ts`（如不存在则新建）

**Approach**：
- 在 `deliverTalkMessage` 顶部、解析 `calleeObjectId` 之前加一段：
  - 若 `callerWindow.target === "super"`：
    - `calleeObjectId = callerRef.objectId`（自指）
    - `calleeSessionId = "super"`
    - `isSuperAlias = true`
  - 否则：`calleeObjectId = callerWindow.target`、
    `calleeSessionId = callerRef.sessionId`
- 后续所有 `{baseDir, sessionId: callerRef.sessionId, objectId: calleeObjectId}`
  形态的 ref 全改用 `calleeSessionId`
- 第一次派送时，若 `isSuperAlias` 且 `flows/super/.session.json` 不存在，
  先调 `createFlowSession(callerRef.baseDir, "super", "OOC self-reflection")`
- 删除 / 修改文件顶部第 8 行 "跨 session talk 不在本期" 注释

**Patterns to follow**：
- `src/persistable/common.ts:60 deriveStoneFromThread` —— ref 派生模式
- 现有 talk-delivery 5 步流程保持不动

**Test scenarios**：
- happy: caller 在 web-xxx session，`target="super"` → callee thread 在
  `flows/super/objects/<caller.objectId>/threads/<new>/thread.json` 落盘
- happy: caller 与 callee 共享 message id；caller outbox 与 callee inbox 各持
  自己 windowId / replyToWindowId 视角
- happy: 同一 caller 第二次 `target="super"` 用同一 talk_window → 复用
  `targetThreadId`，不创建新 thread
- edge: caller 是 critic → super flow 落在 `flows/super/objects/critic/`，
  与 alice 的 super 完全隔离（验证自指语义）
- edge: caller 已在 sessionId="super" 里又调 `talk(target="super")` →
  派送到同一自指 thread，不递归创建嵌套 super
- edge: target="super" 但 caller 的 thread 没 persistence ref → 抛
  "caller thread has no persistence ref"（回归保护，与现行行为一致）
- regression: target="alice"（普通 target）→ 派送到 caller 同 session，
  保持现行行为

**Verification**：talk-delivery 单测全绿；旧的同 session 用例无回归。

---

### U2. createSession / seedSession 拒绝用户操作 sessionId="super"

**Goal**：保护 `"super"` sessionId，防止用户从 UI / HTTP API 直接 seed 一个
super session 跑普通任务。

**Requirements**：origin §6 "assumption"

**Dependencies**：无（与 U1 并行；U1 程序化路径绕过 service 层，不冲突）

**Files**：
- `src/app/server/modules/flows/service.ts`（修改 `createSession` /
  `seedSession`）
- `src/app/server/modules/flows/service.test.ts` 或
  `src/app/server/__tests__/server.routes.test.ts`（扩展）

**Approach**：
- `createSession` 入口检查 `sessionId === "super"` → throw
  `AppServerError("INVALID_INPUT", "sessionId 'super' is reserved for system reflection flow")`
- `seedSession` 同样校验
- `listFlows` / `getThread` 等读取路径不动——super session 出现在列表里是
  feature（§4 Good 档判据要求前端能看到 super flow）
- talk-delivery 路径直接 import `persistable.createFlowSession`，不经过
  service 层，系统能创建、用户不能创建

**Test scenarios**：
- happy: POST /api/sessions {sessionId: "super"} → 400 INVALID_INPUT
- happy: POST /api/sessions {sessionId: "web-xxx"} → 200 创建
- happy: POST /api/sessions/seed {sessionId: "super", ...} → 400 INVALID_INPUT
- regression: talk-delivery 内部调 `persistable.createFlowSession("super")`
  不被这层校验拦截（直接 import 验证）

**Verification**：route / service 测试拒收 super sessionId；其它 session
不受影响。

---

### U3. reflectable knowledge 注入（sessionId="super" 时）

**Goal**：当 thread 跑在 super session 里，system context 顶部多一条
`<knowledge_window source="protocol" path="internal/executable/reflectable/basic">`
告诉 LLM "你在 super flow 里，本轮目标是反思而非执行任务"。

**Requirements**：origin §3 "包含" #3，§4 Good 档"system XML 顶部出现
reflectable knowledge 段"

**Dependencies**：U1（super flow 已能起身才能验证）

**Files**：
- `src/executable/index.ts`（修改 `collectExecutableKnowledgeEntries`）
- `src/executable/reflectable-knowledge.ts`（新建：常量 + 路径常量）
- `src/executable/__tests__/reflectable-knowledge.test.ts`（新建）

**Approach**：
- 新建 `reflectable-knowledge.ts`：
  - export `REFLECTABLE_BASIC_PATH = "internal/executable/reflectable/basic"`
  - export `REFLECTABLE_KNOWLEDGE` 字符串（首版内容保守，约 300-500 字）
- 知识内容覆盖：
  1. "你正在 super flow 中"——身份提示，与 self.md 配合
  2. "super flow 用于反思上次任务 / 沉淀记忆 / 调整自我；不要执行新业务任务"
  3. "Phase 1：通道贯通验证；本轮直接 `open(end, summary='...')` 即可"
  4. 故意保守不提 stone 写权——Phase 2 才放开 mutation 引导
- 在 `collectExecutableKnowledgeEntries`（src/executable/index.ts:257-260
  附近）拼 `protocolEntries` 处加：
  - 若 `thread.persistence?.sessionId === "super"` →
    `protocolEntries[REFLECTABLE_BASIC_PATH] = REFLECTABLE_KNOWLEDGE`
- 内存模式 thread（无 persistence）→ 不注入

**Patterns to follow**：
- `src/executable/windows/root/index.ts:54-57` ROOT_KNOWLEDGE 写法
- 现有 `EXECUTABLE_BASIC_PATH` / `ROOT_BASIC_PATH` 常量命名

**Test scenarios**：
- happy: `thread.persistence.sessionId === "super"` → 返回的
  contextWindows 含 source=protocol、path=internal/executable/reflectable/basic
  的 KnowledgeWindow
- happy: `thread.persistence.sessionId === "web-xxx"` → 不含 reflectable
- edge: `thread.persistence === undefined` → 不含 reflectable（不抛错）
- integration: buildInputItems 输出的 XML system message 在
  sessionId="super" 下能 grep 到 "super flow" 或 "reflectable" 字串

**Verification**：单测验证 sessionId-gated 注入；render 集成测试看到
reflectable 段。

---

### U4. integration test — super-flow-channel

**Execution note**：本 unit 先写测试（初始 Bad）→ U1-U3 实现到 Good。

**Goal**：真 LLM e2e 验证 super flow 从 talk 起身到 end 全链路。

**Requirements**：origin §3 "包含" #5，§4 三档判据

**Dependencies**：U1, U2, U3

**Files**：
- `tests/integration/super-flow-channel.integration.test.ts`（新建）

**Approach**：
- 复用 `tests/integration/_fixture.ts` 的 hasLlmEnv / llm() / setupTempFlow
- 测试 setup：
  1. `createStoneObject({objectId: "alice"})` + `writeSelf` 简短身份
  2. `createFlowObject({sessionId: "web-test", objectId: "alice"})`
  3. bootstrap alice.root inbox 一条 user prompt：
     "请直接 `open(talk, target='super', msg='通道贯通验证')` 然后
      `wait(on=<这条 talk 的 windowId>)`。不要做其它事。"
  4. 给 alice.root 挂一个指向 super 的 talk_window（手搭，与
     wait-state-transition 测试同 pattern）
- 跑：`runScheduler(alice.root, llm(), { maxTicks: 15 })`
- 三档评分（输出到 stdout 供 CI 趋势归档，参照
  multi-object-persona.integration.test.ts 格式）：

  | 档 | 触发条件 |
  |---|---|
  | Good | super flow `flows/super/objects/alice/threads/*/thread.json` status=done；alice.root 收到 child:end inbox 唤醒；super alice 的 debug/llm.input.json 第 0 个 system message 含 `<self object_id="alice">` 与 reflectable knowledge 字串；endSummary 非空 |
  | OK   | super flow done 且父唤醒，但 reflectable knowledge 段没出现（通道通了但语义提示缺位） |
  | Bad  | super flow 没起身 / status=failed / 父没被 child:end 唤醒 / super flow 落错位置（如 alice/super 与 critic/super 串台） |

- 超时 180_000ms（多 thread 跑两轮 + 父唤醒一轮）

**Patterns to follow**：
- `tests/integration/multi-object-persona.integration.test.ts` —— tier log
  格式 + readSelfMarker helper（同样 pattern 适用）
- `tests/integration/wait-state-transition.integration.test.ts` —— 手搭
  talk_window 起 thread 的方法

**Test scenarios**：
- Covers AE: "alice 调 talk(target='super') 起 super flow 跑 LLM end，
  父 thread 被 child:end 唤醒"
- happy path（Good 档判据）
- 不写 mock LLM 变体——本切片靠真 LLM 验证 reflectable knowledge 是否真的
  引导 LLM 走"反思而非执行"路径

**Verification**：
- `bun --env-file=.env test tests/integration/super-flow-channel.integration.test.ts`
  在 hasLlmEnv 下 ≥ OK；无 env 时 skip
- stdout 打 `[super-flow-channel] tier=Good|OK` 行

---

### U5. meta doc 同步

**Goal**：让 reflectable concept 与新实现对齐；integration-tests doc 登记
新 e2e；persistable doc 不需改（super flow 同构 flow object，无新 schema）。

**Requirements**：origin §3 "包含" #6

**Dependencies**：U1-U4 完成

**Files**：
- `meta/object/reflectable/index.doc.ts`（重写 channel / runtime 段）
- `meta/engineering/integration-tests.doc.ts`（新增 super-flow-channel 行）
- `meta/object/collaborable/talk/index.doc.ts`（在 sources / delivery 段
  注脚 super 别名）

**Approach**：
- `reflectable/index.doc.ts`：
  - 更新 `sources`：加 `talkDelivery` (`@src/executable/windows/talk-delivery`)
    + `executableIndex` (`@src/executable/index`) + `reflectableKnowledge`
    (`@src/executable/reflectable-knowledge`)
  - `channel.placement` 重写：删除 "stones/{id}/super/" 特殊位置说明，
    改为 "super flow 落 `flows/super/objects/{name}/`，与其它 flow 同构。
    匹配 persistable.coreAssertion 四条等价规则"
  - `channel.accessControl` 重写：Phase 1 不做路径级 ACL；引用 origin §3
    "显式不在本切片"；Phase 5 才上 path guard
  - `channel.separation` 简化：修改权 / 执行权分离 = reflectable knowledge
    引导 + 未来 Phase 5 path guard；Phase 1 软引导
  - `runtime.talkEntry` 修订：talk(target="super") 是自指别名；
    talk-delivery 解析后跨入 sessionId="super"
  - `runtime.superScheduler` 删除整段——不存在独立调度器；复用 worker
  - `runtime.knowledgeActivation` 修订：reflectable knowledge 走 protocol
    通道，sessionId="super" 门控；不动 activator schema
- `meta/engineering/integration-tests.doc.ts`：
  - 在 `testInventory.identityInjection` 后加一个新 subfield
    `reflectionChannel`，登记 super-flow-channel 测试 + Good/OK/Bad 表
  - 更新 `testInventory.summary` 计数 12 + 1
  - 更新顶部 `当前测试清单：6 个分类 × 11 + 1 文件` 注释为 `7 × 12 + 1`
- `meta/object/collaborable/talk/index.doc.ts`：
  - 在 `delivery` 节点内增加一段说明：target="super" 自指别名走跨 session
    派送（sessionId 跨入 "super"），不破坏现有派送 5 步流程；引用
    reflectable concept 详述

**Patterns to follow**：
- `meta/engineering/meta-doc-maintenance.doc.ts` 三件套约束（name +
  description + sources）
- 现有 reflectable.doc.ts 的字段命名

**Test scenarios**：
- `bun tsc --noEmit` 全绿（sources import 路径有效）
- `bun test meta/__tests__` 全绿（concept-links schema 完整）

**Verification**：tsc + concept-links 双闸通过。

---

## 4. Scope Boundaries

### Deferred for later（origin 已明确，本计划继承）

- **Phase 2 — Stone mutation 验证**：super alice 真的 file_window.edit 改
  stones/alice/self.md；下次普通对话能看到新 self
- **Phase 3 — 跨对象 super 调用**：critic 调起 alice 的 super flow；
  先解决"谁有权调谁的 super"模型
- **Phase 4 — 自动触发**：worker idle / thread end 时自动 nudge super
- **Phase 5 — Stone 写权 ACL**：path-level guard 限制 stones/ 写入只能
  从 super session 来

### Deferred to Follow-Up Work（本计划自身的实施边界）

- **Frontend 显示 super session 的特殊样式**：listFlows 已返回，UI 默认
  列表就能看到；要加 "super" 标签或图标可以单开 PR
- **reflectable knowledge per-Object 自定义**：当前所有 super flow 共用
  常量；后续可走 activator 路径让每个 stone 写自己的
  knowledge/reflectable/index.md

### 永远不在本产品范围

- 跨 session 锁 / 并发协调：OOC 单租户开发者工具定位
- 多用户隔离的 super flow：无此场景

---

## 5. System-Wide Impact

| 组件 | 影响 |
|---|---|
| talk-delivery | 加 target="super" 自指别名；松绑 caller/callee 同 session 假设 |
| flows/service.ts | 用户入口拒收 sessionId="super" |
| executable/index.ts | protocolEntries 多一条 sessionId-gated reflectable |
| 新文件：reflectable-knowledge.ts | knowledge 常量 |
| worker | 零改动（按 sessionId/objectId/threadId 队列天然支持） |
| scheduler | 零改动（单 thread 树视角，不涉及 session） |
| context-builder | 零改动（间接通过 collectExecutableKnowledgeEntries 拿到 reflectable） |
| frontend listFlows | 零代码改动（super session 自然出现，UI 可看） |
| persistable schema | 零改动 |

---

## 6. Risk Analysis

| Risk | 影响 | 缓解 |
|---|---|---|
| 跨 session talk-delivery 触发其它隐藏假设 | bug 难定位 | U1 unit test 覆盖 regression（同 session target=alice 行为不变）+ U4 e2e 验证全链路；先小步验证再 commit |
| reflectable knowledge 文本引导力不足，LLM 在 super flow 里仍执行新任务 | 通道通了但语义错位（→ OK 档而非 Good） | 首版常量保守、不提 stone 写权；多跑几次观察 LLM 行为，按需迭代 prompt |
| LLM 偶发不调 talk(target="super") 而是直接 end | e2e flaky | maxTicks=15 + prompt 明确要求 talk → wait → 等 super 回；OOC 测试允许 retry 1 次（strategy.md §5） |
| createFlowSession 内部路径绕过 service 校验是否合规 | 概念不一致 | 文档清晰区分"用户入口" vs "系统路径"；U2 test 显式覆盖两条路径行为差异 |
| 文件系统大小写敏感性：macOS HFS+ 默认 case-insensitive，sessionId "super" / "Super" 可能撞 | 跨平台 bug | U2 加 case-sensitive 校验（reject any case of "super" 而非仅 lowercase） |

---

## 7. Verification

### 实施过程中（每个 U 完成后）

- `bun tsc --noEmit` 全绿（保留只跑 `src/` 部分；Web/Playwright pre-existing 错误忽略）
- 本 U 涉及的 unit test 跑过
- 不批量验证，per-file 立即跑 tsc（per memory rule "doc work verify each link"）

### 全部完成后

- `bun test src/executable src/app/server src/persistable src/thinkable
  meta/__tests__` 全绿
- `bun --env-file=.env test tests/integration/super-flow-channel.integration.test.ts`
  ≥ OK 档
- 手动 E2E：启动 backend + frontend，UI 上 alice talk(target="super") 能看到
  super session 出现在 listFlows、其中有 alice flow object、thread.json status=done

---

## 8. 相关文档

- `docs/brainstorms/2026-05-18-super-flow-channel-requirements.md`（origin）
- `meta/object/reflectable/index.doc.ts`（待 U5 修订）
- `meta/object/persistable/index.doc.ts` coreAssertion §（设计依据）
- `meta/engineering/how_to_test/strategy.md` §2（Good/OK/Bad 评分基准）
- `meta/engineering/meta-doc-maintenance.doc.ts`（U5 必须遵循的 meta 文档约束）
