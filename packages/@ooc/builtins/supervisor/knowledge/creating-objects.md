---
title: 怎么创建新 OOC Object（协议详情）
description: supervisor 用对话方式为用户创建 Agent 的具体协议
activates_on:
  "window::root": "show_content"
---

# 创建新 OOC Object

我为用户创建 Object（或自己搭建 World 时主动创建）的具体步骤。
术语（cross-scope / PR-Issue / session worktree 等）见 `world-vocabulary.md`。

## 何时创建

**应当创建**：
- 用户描述了一项 World 中没有现成 Agent 能完成的能力
- 我自己发现 World 缺某类协作角色（如需要专门处理某领域的 Object）
- 用户授权范围内的扩展

**不应当创建**：
- 现有 Object 能处理（先派 talk，别先建新的）
- 一次性任务（用 do_window 派 thread 即可，不必建 stone）
- 需求模糊到无法定义身份与边界（先与用户对齐再建）
- 想复制 / 修改 Builtin Object 的行为：Builtin 由 OOC 发版升级，不通过创建 Stone 副本绕过

## 创建步骤

### 1. 与用户确认意图

至少明确以下三点：
- **身份**：这个 Object 是谁、做什么、归哪个维度
- **接口**：它接受什么消息、产出什么结果
- **边界**：它不做什么（避免越界）

### 2. 选 objectId

- kebab-case 简短名（如 `pdf-extractor` / `metric-collector`）
- 唯一（先确认现有对象里没有同名）
- 语义清晰（看名字就知道做什么）
- **禁止**与 Builtin Object 同名（`supervisor`、`user`、`root`、`file`、`plan`、`todo`、`program`、`knowledge`、`search`、`skill_index`）

### 3. 用 `create_object` 落盘骨架（业务 session）

建一个全新对象用 root method `create_object`（**不是** `write_file`——新对象还没
package.json，裸 write_file 会被判 workspace-level 资源拒写）。它原子地落
`objects/<newId>/{package.json, self.md, readable.md[, knowledge/*]}`。

```
open(method="create_object",
     args={
       objectId: "<newId>",
       selfMd: "# <newId> — <一句话角色>\n\n我是 <newId>...",
       readableMd: "# <newId>\n\n何时找我：...",
       knowledge: {                   // 可选；map 形态：filename → markdown
         "usage.md": "..."
       }
     })
```

要点：
- **必须在业务 session 里调**（不是 super flow）。super flow 是合入闸门，不直接建对象身体；
  控制面建对象走 HTTP `POST /api/stones`。
- 骨架落**本 session 的 worktree**（`flows/<sid>/objects/<newId>/`），**main 此刻不变**。
- 返回 `{ ok: true, objectId, note }`。

### 4. 在 super flow 合入 main（evolve_self）

骨架还在 session worktree、main 上还看不到新对象。要让它永久存在，本 session
`end` → 进 super flow → 调 `evolve_self`：

```
open(method="evolve_self")                              # 看 diff：这次建了哪些文件
open(method="evolve_self", args={ message: "feat: introduce <newId> agent" })
```

新对象 `objects/<newId>/` 不在我（supervisor）自己的自治区 `objects/supervisor/` 下，
属 **cross-scope** → evolve_self 自动开 PR-Issue（返回值带 `prIssueId`），我作为 supervisor
经控制面端点决议 `merge` 合入 main（合法"自审"，git log 留下审计线索）：

```
POST /api/runtime/pr-issues/<prIssueId>/resolve   body { "decision": "merge" }
```

### 5. 自治区与权限

我创建的新 Object **不属于自己的自治区** —— 后续写 `executable/index.ts` /
`visible/index.tsx` 之类的代码，应由该 Object 自己在它的业务 session 里 `write_file` +
super flow `evolve_self` 完成。supervisor 只负责"开 World 的接生"，不替后续维护。

如果确实需要 supervisor 帮某 Object 改它**已存在**的 stone（修补 bug、迁移等），在业务
session 直接 `write_file` 写 `stones/<otherId>/...`，再 super flow `evolve_self` —— cross-scope
自动开 PR-Issue，我评审 `resolve`。

### 6. 验证 + 移交

合入 main 后通过 `open(method="talk", args={ target: "<newId>" })` 派单一次确认新
Object 能响应，然后向用户回报新 Object 已就绪。

## 模板：最小 self.md

```markdown
# <id> — <一句话角色>

我是 <id>，一个 <做什么的> Object。

## 我能做什么
- ...

## 我的边界
- 不做 ...
- 不做 ...
```

## 失败处理

`create_object` 失败时返回字符串带结构化 token `[create_object:<CODE>] <msg>`，
我用 substring 匹配 CODE 做决策：

| CODE | 含义 | 下一步 |
|---|---|---|
| `INVALID_INPUT` | objectId 非法 / selfMd / readableMd 为空 / knowledge filename 不合法 / 不在业务 session | 检查参数后重试；若提示「须在 business session」说明我当前在 super flow 或无 session，回到业务 thread 再调 |
| `ALREADY_EXISTS` | 同名 Object 已存在（main 或本 session worktree） | 选不同 objectId，或改现有对象（走 write_file 改已存在文件） |
| `BUILTIN_CONFLICT` | objectId 与 Builtin Object 重名（`supervisor` / `user` / 内置 Window 类型） | 必须换名；Builtin 不可被覆盖 |
| `WORKTREE` | session worktree 建失败（兜底回 main，拒绝直写 main） | 上报；通常是 world 状态异常，需研判 |

合入阶段（evolve_self）的错误：
- evolve_self 返回 `kind: "pr-issue"` + `prIssueId` → 这是预期的（cross-scope 新对象），经控制面端点
  `POST /api/runtime/pr-issues/:issueId/resolve`（body `{ decision: "merge" }`）自审 merge。
- 想改其它 Object 的**已有** stone（非新建）→ 业务 session `write_file` + super flow `evolve_self`
  （cross-scope PR-Issue，我自己 resolve）；或回滚历史经 `POST /api/runtime/stones/:objectId/rollback`（body `{ targetCommit }`）。
