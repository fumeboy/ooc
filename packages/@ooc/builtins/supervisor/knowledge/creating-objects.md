---
title: 怎么创建新 OOC Object（协议详情）
description: supervisor 用对话方式为用户创建 Agent 的具体协议
activates_on:
  "window::root": "show_content"
---

# 创建新 OOC Object

我为用户创建 Object（或自己搭建 World 时主动创建）的具体步骤。
术语（metaprog action / cross-scope / PR-Issue 等）见 `world-vocabulary.md`。

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
- 唯一（先确认 `packages/<id>/` 不存在）
- 语义清晰（看名字就知道做什么）
- **禁止**与 Builtin Object 同名（`supervisor`、`user`、`root`、`file`、`plan`、`todo`、`program`、`knowledge`、`search`、`skill_index`）

### 3. 落盘 stone（两条路径，**推荐快捷路径**）

#### 路径 A（推荐）：`metaprog action="create_object"`

supervisor 专属快捷命令：一次原子写入 stone 骨架（self/readable/knowledge）+ commit on main，
免去 worktree → commit → merge 的 PR-Issue 噪音。

```
open(type="command", command="metaprog",
     args={
       action: "create_object",
       objectId: "<newId>",
       selfMd: "# <newId> — <一句话角色>\n\n我是 <newId>...",
       readmeMd: "# <newId>\n\n何时找我：...",
       knowledge: {                   // 可选；map 形态：filename → markdown
         "usage.md": "..."
       },
       intent: "feat: introduce <newId> agent"
     })
```

返回 `{ ok: true, objectId, commitSha }` —— 文件已在 main 上 committed。

#### 路径 B（备选）：标准 metaprog 流程

如果创建过程需要"先开 worktree 试探性写、调试无误再 commit"，走和其它 Object
完全一样的标准流程：

```
1. open(command="metaprog", args={action:"open_worktree"})         # 拿到 branch / path
2. 在 worktree 里 write_file 写 stones/<branch>/objects/<newId>/{self.md, readable.md, ...}
3. open(command="metaprog", args={action:"commit", branch, intent:"..."})
4. open(command="metaprog", args={action:"merge", branch})
```

第 4 步因为路径在 `objects/<newId>/` 下（不在 `objects/supervisor/` 下）会被
判 cross-scope，自动开 PR-Issue：

```
5. open(command="metaprog", args={action:"resolve", issueId, decision:"merge"})
```

合法但有 PR-Issue 噪音 —— 所以默认走路径 A。

### 4. 自治区与权限

我创建的新 Object **不属于自己的自治区** —— 后续写 `executable/index.ts` /
`visible/index.tsx` 之类的代码，应由该 Object 自己通过常规 metaprog 流程
（worktree → commit → merge）完成。supervisor 只负责"开 World 的接生"，不替
后续维护。

如果确实需要 supervisor 帮 Object 改它自己的 stone（修补 bug、迁移等），同样
走标准 metaprog 流程 —— cross-scope 自动开 PR-Issue，我作为 supervisor 评审
（合法的"自审"，git log 留下 author=supervisor 的审计线索）。

### 5. 验证 + 移交

创建成功后通过 `open(type="talk", target="<newId>", ...)` 派单一次确认新
Object 能响应，然后向用户回报新 Object 已就绪 + commit sha。

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

`create_object` 失败时返回字符串带结构化 token `[metaprog:create_object:<CODE>] <msg>`，
我用 substring 匹配 CODE 做决策：

| CODE | 含义 | 下一步 |
|---|---|---|
| `INVALID_INPUT` | objectId 非法 / selfMd / readmeMd 为空 / knowledge filename 不合法 | 检查参数后重试 |
| `ALREADY_EXISTS` | 同名 Object 已存在（Stone 或 Builtin） | 选不同 objectId，或确认是否要给现有 Object 加内容（走路径 B 改 existing stone） |
| `BUILTIN_CONFLICT` | objectId 与 Builtin Object 重名（`supervisor` / `user` / 内置 Window 类型） | 必须换名；Builtin 不可被覆盖 |
| `FORBIDDEN` | 调用方非 supervisor | 不应当出现（我就是 supervisor）；若出现说明 caller 上下文异常，向用户上报 |
| `GIT:<gitCode>` | 底层 git 操作失败 | 上报错误码与 stderr，请用户 / 我自己研判 |

其它路径错误：
- 走路径 B 时 `merge` 返回 `{kind: "must-pr-issue", issueId, paths}` → 这是预期的（cross-scope），调
  `resolve` 自审 merge
- 想改其它 Object 的**已有** stone（非新建）→ 走标准 metaprog 流程（必产生
  cross-scope PR-Issue，我自己 resolve）；或回滚历史用 `rollback`
