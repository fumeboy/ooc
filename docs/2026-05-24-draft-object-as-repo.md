# 草稿：Object ≡ repo

> **状态**：草稿 / design north star 候选 / **未拍板** / **未写入 meta** / 当前实现不动。
> 仅作为方向沉淀保存，等待涌现新角度或真实约束后再回看决定是否启动迁移。
>
> **起因**：2026-05-24 supervisor × user 探讨"多 OOC Agent 修改同一外部 git repo"时
> 涌现的对称洞察。原始对话脉络见本仓库当日 supervisor session。

---

## 核心洞察：Object ≡ repo

user 提出两个递推：

1. **每个 git repo 应该也是一个 Object**，或需要一个 OOC Agent 作为管家负责 merge 决策
2. **如果一个 git repo 对应一个 OOC Agent，那么每个 OOC Agent 也可以是一个 git repo**

两个递推合流为一个深刻对称：

> Object 是 OOC 哲学视角下的"有意志的协作单元"；
> repo 是工程视角下的"有版本的协作单元"。
> 二者描述同一个东西。

两个推论必须**同时成立**才对称：

- **repo 是 Object**：repo 不是被动资源，是有意志的协作单元，能拒绝/接受变更；
  其他 Agent 想改它 → talk_window + git PR
- **Object 是 repo**：Object 的存在天然有 history / tag / branch / fork；
  Agent 可分发（push）、可使用（clone）、可升级（pull）、可实验（fork）

---

## 在新模型下三分如何分布

每个 Object 自己是一个 git repo，目录形态：

```
<object-repo>/
  .git/                          ← git history（Object 自己的血脉）
  self.md / readme.md            ← 身份                              ┐
  server/ client/                ← 行为/界面源码                       │ stone（git 受控）
  database/                      ← schema 设计                        │
  knowledge/                     ← seed knowledge                     ┘

  .pool/                         ← sediment（.gitignored）
    sql/  knowledge/{memory,relations}/  files/

  .flow/                         ← session 临时（.gitignored）
    <sid>/threads/...
```

stone / pool / flow 三分**从 World 级下放到 Object 级**——
每个 Object 自己有完整的设计/事实/运行三层；
World 不再是单一目录树，而是 **manifest + 一组 Object-repo 的图**。

---

## 这条路打开了什么

1. **seed knowledge 版本管理诉求自然实现** —— 它就在 Object repo 的 main branch，
   tag / branch / eval gate 一应俱全（直接回应 2026-05-24 修订的 seed/sediment 二分诉求）
2. **多 Agent 协作同一 repo 问题消解** —— repo R 就是 Object O_R；多 Agent 想改 →
   talk_window 给 O_R + git fork-PR；O_R 作为管家 review 与 merge
3. **Agent 可分发** —— 发布 = `git push origin`；使用 = `git clone`；
   升级 = `git pull`；fork 实验 = `git fork`
4. **跨 World 互联** —— World A 想用 World B 的 Agent Y → fetch B/Y 的 repo；
   federated OOC 自然成立
5. **管家 Agent 不需特别实现** —— 任何 Object 自然就是自己的管家

---

## 当前 `.stones_repo` 模型的处境

现状：所有 Object 塞在同一个 `.stones_repo` 的不同 worktree（branch）里。
这违反 Object 的独立性 —— 是历史选择，不是必然，**未来需要拆**：

```
当前：  .stones_repo（含所有 Object 的 branch worktrees）
        ↓
未来：  .ooc-world.git              ← world 自身的 manifest repo
        objects/<id>/.git/...        ← 每个 Object 独立 repo
```

`.stones_repo` 可降级为 "world 配方" —— 管 manifest、共享 skills、bootstrap；
不再管单 Object。world 元数据自己也是 repo（推荐）—— `.ooc-world.git` ——
world 配置本身也可有 history / fork / 分发。

---

## 真张力（决策前要解决）

### 1. 跨 Object 同时 metaprog 的协调

当前一个 metaprog branch 可同时改多个 Object（同 `.stones_repo` 多目录）。
拆独立 repo 后：每个 Object 自己 branch，同时实验需要 N 个 branch 协调 →
用 manifest 锁版本（类似 `package-lock.json` / `Cargo.lock`）。

### 2. StoneObjectRef 的新语义

现在 `StoneObjectRef = { baseDir, objectId }` 是 world 内路径。
新模型下应变 `{ remote_url, ref(branch/tag/commit), local_clone_path }` ——
指针带版本，跨 world 可用。

### 3. sediment 与 git 共存

sediment 物理在 Object repo 目录内但不在 git history。
最简方案：`.gitignore` + 路径前缀 `.pool/`、`.flow/`（隐藏目录暗示"非 stone"语义）。
更复杂：独立 git submodule / orphan branch（暂不考虑）。

### 4. World 是什么

若每个 Object 是独立 repo，World = 一份 manifest + 一组 Object-repo 的图。
manifest 自己是不是也 git？推荐是 —— `.ooc-world.git` 是 world 自身的 repo。

### 5. Object repo 升降格协议

普通 git repo（如 pools/repos/ 下的外部业务 repo）→ 完整 Object 的升格路径？
反向：Object 不再被使用时降格回普通 repo？
是否需要清晰的元数据约定（`.ooc-object.yaml`？或仅靠 self.md 存在与否判定？）

---

## 决策选项

| 选项 | 含义 |
|---|---|
| **激进** | 拍板 "Object = repo" 是 OOC v2 核心架构，启动持久层重写 |
| **渐进**（暂取） | 保留当前 `.stones_repo` 模型，先把方向作为 design north star 沉淀；近期不改实现 |
| **否决** | 未来发现致命问题，回退到顶层 `repos/` 或其它方案 |

---

## 与 `pools/repos/` 当前落地的关系

2026-05-24 同日决定先用 **`pools/repos/`** 承载"外部 git repo 管理面"（详见 meta `persistable.pool`）。
这与 "Object ≡ repo" 的远景**不冲突**：

- 当前 `pools/repos/<name>/` 是 OOC 视角下的"外部 repo 工作面"（OOC 视它为 sediment 类资源）
- 未来如某个 `pools/repos/<name>` 被升格为 Object（加上 self.md / server / ... 元数据），就成为完整 Object
- 反方向：未来 Object 拆出 `.stones_repo` 后，每个 Object repo 自身也可在 pools/repos/ 下被其它 world clone 使用

pools/repos 是务实落地；Object≡repo 是哲学远景。**两者目前共存**。

---

## 不写入 meta 的理由

- 这是 design vision，不是已拍板的架构裁决——meta 应当反映"OOC 是什么"的稳定权威，而非沉淀中的探索
- 写进 meta 容易让下游 sub agent 把"未拍板的远景"当成"已确定的方向"去实现
- 等真实约束（如外部用户分发需求、跨 world 协作场景）出现时再回看 —— 那时再决定写入 meta 与否

如未来拍板，应同步更新：
- `meta/object.doc.ts` persistable 节点（三分位置下放到 Object 级）
- 现有 `.stones_repo` bootstrap 与 stone_versioning patch
- `StoneObjectRef` 类型定义

---

## 待补 / 未拍板

- 多 Object 同时演化的 manifest 锁版本协议
- StoneObjectRef 跨 world 引用语义
- 是否设计 `.ooc-world.git` world manifest repo
- Object repo 升降格协议（普通 repo ↔ Object）
- 与 federated OOC、Agent marketplace 等远景的关系
