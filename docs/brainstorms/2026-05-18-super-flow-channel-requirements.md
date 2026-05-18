# Super Flow Phase 1 — 通道贯通切片需求

> **状态**：drafting (2026-05-18)
> **范围**：仅"super flow 能被起身、跑一轮 LLM、end"的通道贯通；不含任何 Stone mutation
> **前置**：多 Object 身份切片已交付（self.md → instructions + `<self object_id>`）

---

## 1. 上下文：为什么现在做

Reflectable 概念文档（`meta/object/reflectable/index.doc.ts`）描述了一套
"自我迭代 / 元编程 / 反思"能力，落点是 super 镜像分身的 SuperFlow 通道。
该文档目前是 forward-looking——`grep super` 在 `src/` 下没有对应实现，
project-status.md 也未列入 P1–P9 路线。这次切片把 super flow 从概念变成
一个**最小可演示通道**：alice 在普通 session 里说"talk(target=super)"，
后端起一个 super flow，跑一轮 LLM，自然 end。

### 关键设计反转

Reflectable doc 原本约束了三处"特殊性"：
1. super 落 `stones/{id}/super/`（与普通 flow 不同位置）
2. 独立 SuperScheduler（与普通 worker 解耦）
3. 修改权 / 执行权分离（路径级 ACL）

本切片**全部取消**。super flow 在工程上就是约定名为 `super` 的 session 下
的普通 flow object，复用 createFlowObject / threads / worker / talk-delivery
全部既有机制。所有"反思特殊性"以 **(a) target 别名约定 + (b) reflectable
knowledge 引导** 两种零侵入形式体现。

这条反转匹配 OOC 的"目录 ≡ 对象"四条等价规则（persistable.coreAssertion）：
super 是对象，对象就是目录——它没有理由需要不同的目录形态。

---

## 2. 用户故事

**alice 自我反思（Phase 1 唯一场景）**

- 触发：用户在普通 session 里和 alice 对话过程中说"花点时间反思下刚才的对话"
- alice 的 LLM 决定 `open(talk, target="super")` —— 一个新别名，自动解析
  为 `(sessionId="super", objectId="alice")`
- 后端 talk-delivery 走原有 5 步派送，在 `flows/super/objects/alice/` 下
  创建 callee thread；该 thread 的 self.md 仍是 alice 的（identity 不变，
  上下文变了）
- super 通道激活 reflectable knowledge，提示 LLM "你现在在 super flow 里、
  允许改 stone 文件、本轮不要做任务执行"
- LLM 跑一轮、`open(end, summary="本轮 super 通道贯通验证")` 自然结束
- 父 thread（alice 普通 session 那条）收到 `[child:end]` 通知唤醒

**演示判据**：
`flows/super/objects/alice/threads/<tid>/thread.json` 存在且 `status=done`。
debug/llm.input.json 顶部 `<self object_id="alice">` 仍正确（identity 不串）。

---

## 3. 范围边界

### 包含

| # | 项 | 实现位置 |
|---|---|---|
| 1 | `talk` command `target="super"` 别名解析 | `src/executable/windows/talk-delivery.ts` 或 `src/executable/windows/talk.ts` |
| 2 | super sessionId 约定值（`"super"`）+ 一处常量 | 同上 |
| 3 | reflectable knowledge md 文件 | `stones/{id}/knowledge/reflectable/...md` 或全局 internal knowledge |
| 4 | super flow 在 web UI session 列表的可见性 | `src/app/server/modules/flows/service.ts` `listFlows` |
| 5 | 至少一条 e2e 验证 super flow 起身 → end | `tests/integration/super-flow-channel.integration.test.ts` |
| 6 | meta doc 同步：reflectable concept 删除三条特殊性、加 talk-delivery binding | `meta/object/reflectable/index.doc.ts` |

### 不包含

| 项 | 推迟理由 |
|---|---|
| Stone mutation 验证（self.md/readme.md/memory/server method） | 通道先通，mutation 用现成 file_window.edit 后续验，不需要新原语 |
| Stone 写权 ACL（任意 path 都能写 stones/） | 用户明确"阶段一不限制"；Phase 2 真出现误改事故再加 path-level guard |
| SuperScheduler / 独立调度 | 复用 worker queue；super thread = 普通 thread，没观察到争资源场景 |
| `stones/{id}/super/` 特殊落盘位置 | 反转：super flow 同构落 `flows/super/objects/{id}/` |
| 别的 Object 调起对方 super（`talk(target="alice/super")` from critic） | Phase 1 super 只支持"自指别名"；跨对象 super 调用要先解决权限模型 |
| 父 thread `wait(on=<super talk>)` 同步等 super 完成 | 现有 wait 语义已支持，不需要新代码；e2e 不强制覆盖 |

---

## 4. 成功标准

按 `meta/engineering/how_to_test/strategy.md` §2 三档：

| 档 | 触发条件 |
|---|---|
| Good | super flow 在 `flows/super/objects/alice/threads/*/thread.json` 落盘 status=done；alice 普通 session 的父 thread 收到 child:end inbox 消息；alice 与 super-alice 的 debug/llm.input.json 各自 `<self object_id="alice">` 正确（identity 不串）；super flow 的 system XML 顶部出现 reflectable knowledge 段 |
| OK   | super flow done 且父 thread 唤醒，但 reflectable knowledge 没激活（LLM 没看到"你在 super 模式"的提示，会按普通任务模式 end）—— 通道通了但语义缺位 |
| Bad  | super flow 没起身 / 起身后 status=failed / 父 thread 没被 child:end 唤醒 / talk-delivery 把 target=super 解析到错误对象（如所有人共享同一个 super flow） |

---

## 5. 关键设计点（落地时再展开）

### 5.1 target="super" 解析规则

talk-delivery 解析 callee 时新增一步：
```
if (callerWindow.target === "super") {
  calleeObjectId = caller.objectId
  calleeSessionId = "super"   // 而不是 caller 当前 session
}
```

这是 talk-delivery 第一次跨 session 派送（现行实现要求 caller/callee 共享
sessionId）。需要松绑那条约束 + 给跨 session 派送的 thread.json 复用
`ThreadPersistenceRef`（结构上已经支持 sessionId 字段，只是没用过非默认值）。

### 5.2 reflectable knowledge

`stones/{id}/knowledge/reflectable/index.md`，frontmatter 用
`activates_on.show_content_when: [<reflective-session-marker>]`。
激活条件由 super sessionId 触发（activator 增加 sessionId 维度）。

或者更简单：reflectable knowledge 走 protocol（每轮自动注入），但只在
`thread.persistence.sessionId === "super"` 时生效——context-builder 加一段
session-aware 判定即可。

两种实现成本接近；首选后者（不动 activator schema）。

### 5.3 super flow 在 UI

`listFlows` 返回所有 `flows/*/` 目录；super session 自然出现在列表里，
UI 不需要任何代码改动就能看到它。前端 ChatPanel 切到 super session 即可
观察 super alice 的 thread。

但：super session 的 `seedSession` 不应该被 UI 表单触发（用户不能直接
seed super session 跑普通任务）。可以在 `seedSession` 加一行校验：
`if (sessionId === "super") throw INVALID_INPUT`。

---

## 6. 依赖 / 假设

- **多 Object 身份切片已就绪**——本切片复用 `<self object_id>` + instructions
  的注入，验证 super alice 与普通 alice 共用同一 self.md
- **talk-delivery 跨 session 派送** 需要去掉 caller/callee 同 session 的硬约束
  （`src/executable/windows/talk-delivery.ts:8` 显式说"跨 session talk 不在
  本期"——本切片把它放进本期）
- **assumption**：sessionId 命名空间里 `"super"` 是受保护值（不与用户创建的
  `web-<timestamp>` session 冲突）。需要在 `createFlowSession` 拒绝
  `sessionId === "super"` 由用户创建

---

## 7. 后续可能的 Phase

不在本 brainstorm 决策范围，仅记录：

- **Phase 2 — mutation 验证**：super flow 真的 `file_window.edit` 改
  `stones/{self}/self.md`；e2e 验证下次 alice 普通对话能看到新 self
- **Phase 3 — 跨对象 super 调用**：critic 在普通 session 中调起 alice 的
  super flow 帮 alice 反思；先解决"谁有权调谁的 super"的模型
- **Phase 4 — 自动触发**：worker idle 或 thread end 时自动 nudge super flow
  做事后总结，不需 LLM 显式 `talk(target=super)`
- **Phase 5 — Stone 写权 ACL**：path-level guard 强制只有 super session 的
  flow 能写 `stones/` 路径

---

## 8. 相关文档

- `meta/object/reflectable/index.doc.ts` — 概念定义（本切片将简化其中三条特殊性）
- `meta/object/persistable/index.doc.ts` — coreAssertion 四条等价规则
- `meta/object/thinkable/identity.doc.ts` — self.md 注入机制（已实现）
- `meta/engineering/how_to_test/strategy.md` — Good/OK/Bad 评分基准
- `meta/engineering/integration-tests.doc.ts` — 测试清单（本切片将加一项）
