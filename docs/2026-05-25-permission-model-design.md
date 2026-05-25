# OOC Permission 模型 — 基于 CommandTableEntry + PauseChecker 演化

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-25
**性质**：design 草稿（Round 2 P0-1）
**前置阅读**：`docs/2026-05-25-ccb-observation.md` § 缺口 A
**预留代码点**：
- `src/observable/index.ts` — `setPauseChecker / isPausing` 已存在（默认全局开关）
- `src/thinkable/thinkloop.ts` — 已在第 2 步调 isPausing；是 permission 介入点
- `meta/object.doc.ts:observable.children.pause` — 已声明 pause 默认关闭

---

## 1. 问题陈述

OOC 现有 `PauseChecker (thread) => boolean` 是个全局开关：要么所有 tool call 都 pause，要么都不 pause。**真实使用场景需要的是 per-command 粒度**：

- `glob` / `grep` / `open_file`（纯读）→ 应该 Allow，永不打扰
- `write_file` / `delete_file` / `relation_update`（写副作用）→ 应该 Ask 一次
- `program (shell)` / `do (子线程)` / `program_self` 修改（元编程）→ 应该 Ask 或 Deny
- `compress (auto)` / `expand` / `close` / `wait`（无副作用控制流）→ Allow

CCB 用三层 gating (`Allow / Ask / Deny` + Auto Mode 分类器 + Plan Mode HITL + Sandbox) 解决；OOC 不必照搬这么重——但**必须有"per-command 三档"**才能让元编程闭环（programmable.metaprogramming）安全推进。

### 1.1 风险地图（不做 permission 模型的代价）

| 场景 | 没有 permission | 后果 |
|---|---|---|
| LLM 误改 `stones/<self>/server/index.ts`（元编程闭环）| 直接落盘 | 一个语法错误 = 下次 thread 启动崩溃 |
| LLM 在 super flow 改 `self.md` 写"我现在叫 evil_agent" | 直接落盘 | 身份漂移，下一轮 stone 加载就生效 |
| program command 执行 shell `rm -rf` | 直接执行 | 不可逆 |
| LLM 误调 `talk-delivery` 给错对象 | 真发出 | 协作链路污染 |

---

## 2. 设计原则

### 原则 A：permission 是 command 的属性，不是 tool 的属性
OOC 已有 `executable.tools.children` 是稳定的 4 个原语（exec/close/wait/compress）。permission 不挂 tool（粒度太粗），挂在 `CommandTableEntry` 上（粒度刚好）。这与 OOC 的"tool 稳定，command 扩展"哲学一致。

### 原则 B：三档 + 默认 Allow
- `Allow`：无人工介入，直接执行（默认值；适合纯读 / 控制流）
- `Ask`：触发 PauseChecker，等人工 approve/reject（适合写副作用）
- `Deny`：系统直接拒绝，告知 LLM（适合永远不该让 LLM 干的事）

**默认 Allow** 是为了向后兼容——现有所有 command 不写 permission 字段就维持旧行为。

### 原则 C：声明 + 配置 = 最终决定
- **声明**：每个 command 在 CommandTableEntry 中声明 `permission: "allow" | "ask" | "deny"`（可选，缺省 allow）
- **配置**：`stones/<self>/objects/<id>/config/policies.json` 可 override 任意 command 的 permission（用户/Supervisor 微调）
- **最终决定**：runtime 时 policies.json 优先，否则用 CommandTableEntry 声明

### 原则 D：演化 PauseChecker，不替换
旧 `setPauseChecker(thread => bool)` 保持向后兼容（测试代码大量依赖）。新 API：
```ts
setPermissionDecider((thread, call: PendingToolCall) => Decision | Promise<Decision>)
type Decision = "allow" | "ask" | "deny" | { decision: "deny", reason: string }
```
thinkloop 优先用 PermissionDecider，没注入则 fallback 到默认 policy 表 + PauseChecker。

### 原则 E：Deny 不静默 — 写 function_call_output
`Deny` 决策必须在事件流写一条 `function_call_output`，让 LLM 看见 "我刚才那个 call 被拒绝了，原因是 X"。silent-swallow ban 同样适用。

### 原则 F：Ask 走 PauseChecker — 信息流可见
`Ask` 决策：
1. 把 pending tool call 信息（command path + args 摘要）写入 thread.events 作为 `permission_ask` ProcessEvent
2. 设 thread.status = "paused"
3. 控制面 UI 看到该状态可以 approve / reject
4. approve → 标记 thread.events 中的 `permission_ask` 为 approved，thread 状态回 running，下一轮重新走该 tool call
5. reject → 同 deny 路径（写 function_call_output "user rejected"）

### 原则 G：保持 observable.pause 的协议不变
现有 pause 时序（先记 assistant output，再 pause，未执行 tool call）已经是正确的"安全暂停点"——permission 模型直接复用，不改这个时序。

---

## 3. 三档语义表（默认 policy 草案）

| Command | 默认 permission | 理由 |
|---|---|---|
| `open_file` / `glob` / `grep` / `open_knowledge` | allow | 纯读 |
| `compress` / `expand` / `close` / `wait` / `end` | allow | 控制流 |
| `plan` / `todo.*` | allow | 计划记录 |
| `do` | allow | fork 子 thread 在 OOC 里是常态；子 thread 的 root command 会各自有 permission |
| `talk` (新对话) | allow | OOC 协作主线；具体 talk-delivery 内部写副作用走更细 command |
| `talk_window.say` (继续对话) | allow | 同上 |
| `relation_update` | ask | 写跨 Object 关系，跨边界副作用 |
| `write_file` | ask | 写工作区文件 |
| `program (shell)` | ask | 执行 OS 命令 |
| `program (ts/js)` | ask | 任意代码执行 |
| `create_issue` | allow | session 内议题 |
| `super` flow 相关：`open_super` / 改 self.md / 改 readme.md | ask | 身份与方法库变更 |
| `stones/<self>/server/index.ts` 改动（程序自改）| **deny** | 元编程闭环目前还没成熟到能让 LLM 自动改方法库；本轮先 deny，未来 plan mode 通过后 ask |
| `delete_*` 任何删除类 | ask | 默认审慎 |

这份表是 **草案**；具体 command 名以仓库中实际注册的为准（实施 phase Q0d 校准）。

---

## 4. 实施分阶段

| Phase | 工作量 | 内容 | 验收 |
|---|---|---|---|
| **Q0a** | 小 | meta 层 design 落 `permission` 概念（位置选择见 §5）| Supervisor 点头 |
| **Q0b** | 中 | `CommandTableEntry.permission` 字段（默认 allow）+ `PermissionDecider` API + thinkloop 接入 + Deny 路径 + `permission_denied` ProcessEvent + 配套 e2e | LLM 调 deny command → 收到结构化错误 |
| **Q0c** | 中 | Ask 路径接入（演化 PauseChecker + permission_ask ProcessEvent + approve/reject API + e2e）| LLM 调 ask command → thread 进 paused → 控制面 approve → resume + 执行 |
| **Q0d** | 中 | policies.json 读取 + 按 §3 表填齐现有 commands 的默认 permission + 回归 e2e | 现有 e2e 不破坏；高风险 command 全是 ask 或 deny |

P1 + 远景（不在本轮）：
- Auto Mode（AI 分类器决定 ask）
- Plan Mode（强制 LLM 先 plan 再 exec）
- Sandbox 集成（OS 级隔离）

---

## 5. 在 meta/object.doc.ts 的接入点

**选 1**：作为 OOC 顶级 patches `patches.permission`（横切 executable / observable / collaborable）
**选 2**：作为 `executable.children.permission` 新 child
**选 3**：作为 `observable.children.pause` 的 patch 扩展

倾向 **选 2**：
- permission 的"声明位置"在 CommandTableEntry（executable 概念）
- permission 的"执行位置"在 thinkloop + PauseChecker（observable 概念）
- 但概念归属上更偏 executable —— 它定义"哪些 command 该被 gate"
- 选 2 与现有 `executable.children.{tools, commands, context_window, ...}` 同层级，结构最干净

具体落点：在 `executable.children.commands` 之后加一个新 child `permission`，并在 `observable.children.pause` 加一个 patch `permission_integration` 指向 executable.permission。

---

## 6. 代码层落点（仅枚举，不实施）

- `src/executable/commands/types.ts` 或 `src/executable/_shared/command-table.ts` — `CommandTableEntry` 加 `permission?: PermissionLevel`
- `src/executable/permissions.ts` 【新】— `PermissionLevel` 类型 + `decidePermission(thread, call)` + policies.json 读取
- `src/observable/index.ts` — 加 `setPermissionDecider / getPermissionDecider`
- `src/thinkable/thinkloop.ts` — 在 dispatchToolCall 之前调 decidePermission；deny 路径写 `function_call_output`；ask 路径走 pause（复用现有时序）
- `src/thinkable/context/index.ts` — `ProcessEvent` 加 `permission_denied` 与 `permission_ask` variant
- `src/app/server/modules/runtime/service.ts` — 加 approve/reject API endpoint（HTTP）
- `stones/<self>/objects/<id>/config/policies.json` — 配置文件 schema

---

## 7. 不变量 & 风险

### 不变量
- **可见性**：Allow / Ask / Deny 每一种决策都至少落一条 ProcessEvent，silent-swallow ban 适用。
- **向后兼容**：未声明 permission 字段的 command 默认 allow；旧 PauseChecker API 保留。
- **可恢复**：Ask 暂停后，approve 必须能让 thread 恢复并真正执行原 tool call，不能"批准了但没执行"。
- **Deny 信息流**：拒绝必须写 `function_call_output`，让 LLM 看见原因，不能让 LLM"以为成功"。
- **policies.json 错误容错**：文件缺失 / JSON 错 / 字段拼错都 fallback 到声明默认，不抛崩溃。

### 风险
| 风险 | 缓解 |
|---|---|
| Ask 暂停后无人 approve，thread 卡死 | 控制面 UI 显示 "需要审阅" 列表；e2e 测试覆盖 timeout 回退路径 |
| 把太多 command 设 ask，体验拖慢 | §3 表保守起步，多用 allow；Auto Mode 远景接管批量决策 |
| 元编程闭环（Agent 改 server/index.ts）被 deny 卡死 | 本轮意图就是先 deny；Plan Mode 远景实施后再放开 |
| permission_ask ProcessEvent 数量爆炸 | 跟 events_ring 一起处理（P0-2 已落）；ask 事件可 fold |

---

## 8. 与 CCB 的对照

| CCB 机制 | OOC 等价 | 备注 |
|---|---|---|
| Allow / Ask / Deny | 完全 1:1 |  |
| Auto Mode (AI 分类器) | 暂不做 | 引入 AI 推理判定 = 复杂；显式声明 + policies.json 已够用 |
| Plan Mode (LLM plan + user approve) | 远景 | 可作为某种 ask 子变体 |
| Sandbox | stone-versioning 已部分提供 | OS 级 sandbox 不在本轮 |
| 88+ feature flags 三层 gating | 不照搬 | OOC 用 policies.json + stone-versioning 已足够 |

---

## 9. 下一步

由 Supervisor 拍板后：
1. 把 design 落 `meta/object.doc.ts:executable.children.permission`（Supervisor 直写）
2. 派 sub agent 跑 Q0b（最小地基）
3. 验收 Q0b 后并行派 Q0c + Q0d

---

## Supervisor Round 2 拍板记录 (Q0d 抛回的 3 项歧义)

### 拍板 1：issue.comment → **保持 allow**
- 语义上是"在 session 共享议题板上发声"，跨 thread 但仍在 session 内
- 比 talk.say 多一层"被多个 thread 看见"，但没多写文件副作用
- 保持与协作主线一致；不 ask

### 拍板 2：custom window Proxy → **保持 allow，由 stone 作者自行声明 permission**
- custom 命令完全是 LLM-author 写的 stone server method，OOC 不知道副作用大小
- 一刀切 ask 会拖慢所有 stone 自定义命令；一刀切 allow 会留隐患
- **正确做法**：让 stone 作者在 ObjectWindowDefinition.commands 上自行声明 permission（与 description / params 同字段）
- 这是 OOC stone-as-design 哲学的体现——每个 stone 自负责自己的安全声明
- 本轮 Q0d 不实施 stone 作者的 permission 声明传递（需要 programmable 维度的 loader 改造）；列为 Q0e

### 拍板 3：自改 stones/<self>/server/index.ts 的 deny → **列为 Q0e，本轮跳过**
- 仓库无单独 command（通过 metaprog 整族 + write_file 一般化路径完成）
- metaprog 整族已 ask（Q0d 落地），形成弱约束
- 后续 Q0e 抽专用 command 或在 write_file exec 中加路径前缀检查：
  - 路径模式：`stones/*/server/index.ts` / `stones/*/objects/*/server/index.ts`
  - 命中 → deny（reason="metaprog target requires planned path"）
  - 这是程序自改方法库的硬边界，Plan Mode 落地前保持 deny

## 已知 todo（推迟到 Q0e 或后续 Round）

1. **Stone 作者的 permission 声明传递**（custom window proxy）：programmable.loader 需把 `ObjectWindowDefinition.commands[*].permission` 透传到 CommandTableEntry
2. **自改 server/index.ts 路径前缀检查**：在 write_file exec 中按 path glob 决断 deny
3. **Auto Mode (AI 分类器)**：远景，需要训练数据
4. **Plan Mode (LLM plan + user approve)**：远景，与 thinkable.plan 协作
5. **OS-level Sandbox**：远景，stone-versioning git branch 已部分提供

---

## 历史

- **2026-05-25**：首版。Round 2 P0-1 design 草稿。
- **2026-05-25**（Q0b 实施后修订）：两处对齐实际代码：
  1. `CommandTableEntry` 实际位置：`src/executable/windows/_shared/command-types.ts`（不是 §6 写的 `src/executable/commands/types.ts`，已迁移）
  2. policies.json 实际路径：`stones/<branch>/objects/<objectId>/config/policies.json`（与 P0-2 的 context-budget.json 同目录复用 helper）；§5 的描述少了 `<branch>` 层
  3. observable 不能反向依赖 executable —— PermissionDecider 等类型在 observable 重新声明一份，permissions.ts 用 alias；这是干净的依赖反转，不影响 API 语义
- **2026-05-25**（Q0c 实施后修订）：HTTP endpoint 路径调整：
  - 实际：`POST /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission`
  - 设计写：`POST /api/threads/:threadId/permission`
  - 原因：按 ref 三元组定位 thread 与现有 runtime 模块一致；threadId 跨 session 可能重复
- **2026-05-25**（Q0d 实施 + Supervisor 拍板）：3 项歧义拍板见上；Q0d 实际落 ask 6 项（write_file / root.program / program_window.exec / file_window.edit / relation.edit / metaprog），deny 0 项（列 Q0e）；当前 commands 表已校准
