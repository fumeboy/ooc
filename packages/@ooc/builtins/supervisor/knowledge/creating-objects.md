---
title: 怎么创建新 OOC Object（协议详情）
description: supervisor 用对话方式为用户创建 Agent 的具体协议
activates_on:
  "object::root": "show_description"
  "method::world::create_object": "show_content"
---

# 创建新 OOC Object

我为用户创建 Object（或自己搭建 World 时主动创建）的具体步骤。
术语（feat 分支 PR / PR-Issue / session worktree 等）见 `world-vocabulary.md`。

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
- **必须在业务 session 里调**（不是 super flow）。super flow 是沉淀通道，不直接建对象身体；
  控制面建对象走 HTTP `POST /api/stones`。
- 骨架落**本 session 的 worktree**（`flows/<sid>/objects/<newId>/`），本 session 内即可用，
  **main 此刻不变**。
- 返回 `{ ok: true, objectId, note }`。

### 4. 在 super flow 走 feat 分支 PR 沉淀进 canonical

骨架还在 session worktree——session 是运行时派生物，**永不合入 main**。要让新对象永久存在，
进 super flow 走一条 feat 分支 PR：`new_feat_branch(intent)` 从 main 派生 feat 分支并绑定本 thread →
在 feat 分支上把新对象目录 `objects/<newId>/...` write_file 落齐 → `evolve_self` 提交并开 PR。

```
open(method="new_feat_branch", args={ intent: "feat: introduce <newId> agent" })
open(method="write_file", args={ path: "stones/<newId>/self.md", content: … })   # 直接落 feat 分支
…（把 package.json/self/readable[/knowledge] 落齐 feat 分支）…
open(method="evolve_self")                              # commit + 开 PR
```

新对象 `objects/<newId>/` 不在我（supervisor）自己的自治区 `objects/supervisor/` 下 → 变更越界，
`evolve_self` 算 reviewer 时会拉相关对象进 review（新对象无既有 owner 时 reviewer = {supervisor}）。
我恒在 reviewer 集，经 pr_window method 或控制面端点审批；全 approve 后按 `.world.json prAutoMerge`
合入（缺省 false → 我经 `POST /api/runtime/pr-issues/<N>/resolve` body `{ "decision": "merge" }` 落锤）。

### 5. 自治区与权限

我创建的新 Object **不属于自己的自治区** —— 后续写 `executable/index.ts` /
`visible/index.tsx` 之类的代码，应由该 Object 自己在它的 super flow 走 feat 分支 PR 沉淀。
supervisor 只负责"开 World 的接生"，不替后续维护。

如果确实需要 supervisor 帮某 Object 改它**已存在**的 stone（修补 bug、迁移等），在 super flow
`new_feat_branch` 后于 feat 分支上 write_file 写 `stones/<otherId>/...`，再 `evolve_self` —— 变更触及
别人领地，PR 把那个对象拉进 review，我也在 reviewer 集。

#### executable/index.ts 唯一正确写法

写 method 时只有一个 canonical schema，写错任何一处 loader 都**静默不注册**该对象的方法
（即便合入 main 也调不到）。照抄这个最简范例，按需增减字段：

```ts
export const window = {
  methods: {
    greet: {
      description: "Return a greeting for the given name.", // 必填：LLM 面向的一句话说明
      for_ui_access: true,                                  // 可选：经 HTTP call_method 调用时设 true
      exec: async ({ args }) => {                           // 必填：执行入口；ctx.args 是参数
        const name = String(args.name ?? "world");
        return { ok: true, result: `hello, ${name}`, data: { name } };
      },
    },
  },
};
```

loader 只读 `export const window = { methods: { <name>: { description, exec } } }`。

**会导致方法不注册的错误写法**（别写）：
- `export default ...` —— loader 只认具名 `export const window`。
- 方法体用 `handler:` 而非 `exec:` —— 执行入口字段名固定是 `exec`。
- `export const llm_methods = ...` —— 已移除，loader 命中即抛错。
- 漏掉 `description` —— 必填字段。

**exec 返回三形态**（任选）：`undefined`（成功，无文本）｜ 裸 `string`（成功，该字符串即 result
文本）｜ `{ ok, result?, data?, error? }`。`result` 给 LLM/用户看；`error` 在 `ok:false` 时填错因；
`data` 是结构化 JSON——**只有 `for_ui_access` 的 method 经 HTTP 调用时前端才从 `data` 取数渲染**，
LLM 路径不消费 `data`。

### 6. 验证 + 移交

PR 合入 main 后通过 `open(method="talk", args={ target: "<newId>" })` 派单一次确认新
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

沉淀阶段（feat 分支 PR）的错误：
- `evolve_self` 返回 `kind: "pr-issue"` + `issueId` → 这是预期的，PR 已开、等 reviewer 审批；
  全 approve 后经控制面端点 `POST /api/runtime/pr-issues/:issueId/resolve`（body `{ decision: "merge" }`）落锤合入。
- 忘了先 `new_feat_branch` 直接 `evolve_self` → fail-loud 提示先开分支；先 `new_feat_branch(intent)` 再编辑。
- 想改其它 Object 的**已有** stone（非新建）→ 同样在 super flow `new_feat_branch` → feat 分支上 write_file →
  `evolve_self`（PR 把那个对象拉进 review，我也在 reviewer 集）；或回滚历史经
  `POST /api/runtime/stones/:objectId/rollback`（body `{ targetCommit }`）。
