# OOC-3 Foundation (P0+P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从空 git orphan branch `ooc-3` 起步，搭好基础设施并写出概念骨架（meta/object.doc.ts 完整 + 其他 meta 文件 skeleton），落 P0+P1 gate（`bun tsc --noEmit meta/*.doc.ts` 全 PASS）。这是 OOC Object 归一化重构的第一份 plan，后续 P2-P10 各自单独 plan。

**Architecture:** orphan worktree 内只复制基础设施（bun/tsc/playwright/vite 配置 + LLM transport / world-config / sandbox 等领域稳定模块）；meta 文档全部从空写，以 ooc-2 现有 meta/* 为参考但根据 V2 spec 校准三层 stone/pool/flow + Object 概念归一。不写任何 src/ 业务代码（留给 P2+）。

**Tech Stack:** TypeScript（bun runtime）；meta 文档采用 DocTreeNode 树形格式；bun:test；git worktree。

**Reference docs:**
- spec V2：`docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md`
- ooc-2 原 meta 作为结构参考：`meta/*.doc.ts`（在 ooc-2 主 worktree）

**Out of scope:**
- 不写 src/ 任何业务代码（P2+ 任务）
- 不创建任何 `stones/_builtin/objects/<proto>/` 目录（P4 任务）
- 不动 web/（P7 任务）

---

## File Structure

**Created files in `ooc-3` worktree:**

```
ooc-3-wt/
├── .gitignore                          # copy from ooc-2，添加 .worktrees/ 等
├── package.json                        # copy from ooc-2，name 改 'ooc-3'
├── bun.lock                            # copy from ooc-2
├── tsconfig.json                       # copy from ooc-2
├── scripts/
│   ├── check-tsc.sh                    # copy from ooc-2
│   ├── check-no-silent-swallow.sh      # copy from ooc-2
│   └── check-no-deprecated-symbols.sh  # copy from ooc-2
├── docs/
│   └── superpowers/
│       ├── specs/2026-05-28-ooc-object-unification-design.md  # copy 当前 spec V2
│       └── plans/2026-05-28-ooc-3-p0-p1-foundation.md         # copy 当前 plan
├── meta/
│   ├── index.doc.ts                    # 入口聚合所有 doc trees
│   ├── object.doc.ts                   # 概念权威：4 关系轴 / 三层 / 8 维度 / Object 归一
│   ├── app.server.doc.ts               # skeleton：HTTP 控制面 + loader + worker
│   ├── app.client.doc.ts               # skeleton：AppShell + ObjectClientRenderer
│   ├── engineering.harness.doc.ts      # skeleton：1 Supervisor + 9 Agent
│   ├── engineering.testing.doc.ts      # skeleton：三档评分 + 双观察孔
│   ├── cookbook.author-ooc-object.doc.ts  # skeleton：5 步教学
│   ├── case.factor-dev-agents.doc.ts   # skeleton：术语校准
│   └── case.feishu-integration.doc.ts  # skeleton：术语校准
└── README.md                           # 简短：what + 指向 spec
```

**Each file responsibility:**
- `meta/object.doc.ts`：唯一概念权威；其他 meta 引用此处定义的术语
- `meta/app.*.doc.ts`：实现层文档，引 src/ 路径锚定
- `meta/engineering.*.doc.ts`：工程协作 / 测试策略
- `meta/cookbook.*.doc.ts`：教学（一份取代旧 add-new-agent + author-ooc-agent）
- `meta/case.*.doc.ts`：外部场景案例
- `meta/index.doc.ts`：聚合入口，方便 import 检索

---

### Task 1: 创建 orphan worktree

**Files:**
- Create: worktree at `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/` with orphan branch `ooc-3`

- [ ] **Step 1: 验证 main worktree 在 ooc-2 分支且 clean**

Run from `/Users/zhangzhefu/x/ooc-2/ooc/`:
```bash
git status
git branch --show-current
```
Expected: 当前分支 `ooc-2`，working tree clean（spec V2 已 commit）。如果有未 commit 改动，先 stash 或 commit。

- [ ] **Step 2: 创建 detached worktree**

```bash
git worktree add --detach ../ooc-3-wt
```
Expected: 提示 `Preparing worktree (detached HEAD at <sha>)`。

- [ ] **Step 3: 切到 orphan 分支 ooc-3**

```bash
cd ../ooc-3-wt
git switch --orphan ooc-3
```
Expected: `Switched to a new branch 'ooc-3'`；`git log` 显示 no commits yet。

- [ ] **Step 4: 清空 working tree（detach 残留的 index）**

```bash
git rm -rf . 2>/dev/null
ls -la
```
Expected: 工作目录除 `.git` 外为空。

- [ ] **Step 5: 验证**

```bash
git status
git branch --show-current
```
Expected: branch=`ooc-3`，no commits yet，working tree clean。

> 此 task 无 commit；commit 在 Task 3 一并做。

---

### Task 2: 复制基础设施 + bun install

**Files:**
- Create (copy from `/Users/zhangzhefu/x/ooc-2/ooc/`):
  - `.gitignore`
  - `package.json`（修改 `name` 为 `ooc-3`）
  - `bun.lock`
  - `tsconfig.json`
  - `scripts/check-tsc.sh`
  - `scripts/check-no-silent-swallow.sh`
  - `scripts/check-no-deprecated-symbols.sh`

- [ ] **Step 1: 复制基础配置文件**

Run from `ooc-3-wt/`:
```bash
cp /Users/zhangzhefu/x/ooc-2/ooc/.gitignore .
cp /Users/zhangzhefu/x/ooc-2/ooc/package.json .
cp /Users/zhangzhefu/x/ooc-2/ooc/bun.lock .
cp /Users/zhangzhefu/x/ooc-2/ooc/tsconfig.json .
mkdir -p scripts
cp /Users/zhangzhefu/x/ooc-2/ooc/scripts/check-tsc.sh scripts/
cp /Users/zhangzhefu/x/ooc-2/ooc/scripts/check-no-silent-swallow.sh scripts/
cp /Users/zhangzhefu/x/ooc-2/ooc/scripts/check-no-deprecated-symbols.sh scripts/
chmod +x scripts/*.sh
```

- [ ] **Step 2: 改 package.json 中的 name**

Edit `package.json`：`"name": "ooc-2"` → `"name": "ooc-3"`。

- [ ] **Step 3: bun install**

```bash
bun install
```
Expected: 安装完成，无报错；`node_modules/` 出现。

- [ ] **Step 4: 验证 bun test 空跑 PASS（无 test 文件时）**

```bash
bun test
```
Expected: `0 tests across 0 files`（或类似 no tests 的 PASS 输出）。

- [ ] **Step 5: 验证 tsc 不报错（此时只有 tsconfig，无 src/meta，理应 0 errors）**

```bash
bunx tsc --noEmit
```
Expected: 退出码 0，无任何错误输出。

> 此 task 无 commit；待 Task 3 一并。

---

### Task 3: 复制 spec + plan，写 README，初始 commit

**Files:**
- Create: `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md`
- Create: `docs/superpowers/plans/2026-05-28-ooc-3-p0-p1-foundation.md`
- Create: `README.md`

- [ ] **Step 1: 复制 spec 与 plan**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp /Users/zhangzhefu/x/ooc-2/ooc/docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md \
   docs/superpowers/specs/
cp /Users/zhangzhefu/x/ooc-2/ooc/docs/superpowers/plans/2026-05-28-ooc-3-p0-p1-foundation.md \
   docs/superpowers/plans/
```

- [ ] **Step 2: 写 README.md**

Create `README.md` with the following content:
```markdown
# OOC-3

OOC (Object Oriented Context) 第 3 代实现——把 OOC Agent 与 Context Window 归一为同一个 OOC Object 概念。

## 当前状态

正在从空 orphan branch 重建。设计 spec 在 `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md`，实施 plans 在 `docs/superpowers/plans/`。

## 与 ooc-2 的关系

`ooc-3` 是从空起步的 from-scratch 重建，不是 ooc-2 的 refactor。完成后 `ooc-3` 成为新主线；ooc-2 保留为 legacy reference。

详见 spec §8。
```

- [ ] **Step 3: 暂存全部**

```bash
git add .gitignore package.json bun.lock tsconfig.json scripts/ docs/ README.md
git status --short
```
Expected: 看到所有上述文件 `A`（newly added）状态。

- [ ] **Step 4: 初始 commit**

```bash
git commit -m "$(cat <<'EOF'
chore: bootstrap ooc-3 orphan branch with infrastructure + spec

P0 scaffolding：从 ooc-2 复制必需基础设施（bun / tsc / playwright /
scripts），落 spec V2 与本 plan。从这里起所有改动遵循 spec 设计。

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

- [ ] **Step 5: 验证 P0 gate**

```bash
bun test
bunx tsc --noEmit
```
Expected: 两条命令都退出码 0，无报错。

---

### Task 4: 写 meta/object.doc.ts 根节点 + DocTreeNode 类型 + named 词典

**Files:**
- Create: `meta/object.doc.ts`（仅含文件头注释 + DocTreeNode 类型 + `root: DocTreeNode` 的 title + content + named；children/patches 留空对象）
- Reference: `/Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts:1-121`（DocTreeNode 类型、root.content、named 字典原版）
- Reference: spec V2 `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` §1（概念基底）

- [ ] **Step 1: 读 ooc-2 参考**

读 `/Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts:1-121`，理解：
- 文件头注释 6 条文档维护原则
- `DocTreeNode` 类型定义（lines 41-54）
- `root: DocTreeNode` 形态（title / content / named / children / patches）
- 现有 `root.content` 中"stone/pool/flow 三层"叙述（line 73-76）

- [ ] **Step 2: 读 spec V2 概念基底**

读 `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` §1.1-§1.5（lines ~26-83）。重点：
- Object 归一概念：每个 Object 由 identity / methods / UI / 运行时状态 4 件组成
- 4 条正交关系轴（自我 / talk / parent-child / **prototype**——第 4 条新增）
- 三层持久层 stone/pool/flow（**保留**，按"过程/产物/设计"边界归位）
- Object 生命期三类：builtin / persistent / ephemeral
- 5 条核心不变量

- [ ] **Step 3: 写 meta/object.doc.ts**

Create file at `meta/object.doc.ts` with this content:

```typescript
/**
 * 文档维护说明
 *
 * 本文件是 OOC 概念体系的"树形文档源"。所有 doc 节点都遵循 DocTreeNode 形态，
 * 形成一棵从根到叶不断细化的概念树。维护时请坚持以下原则:
 *
 * 1. 树形拆解模糊概念
 *    遇到一个含义模糊、信息量大的概念时，不要把所有细节堆在同一节点的 content 里，
 *    而是把它拆成 children / patches。每多走一层，概念就应该更清晰、范围更收敛。
 *    - children: 该节点"由什么组成"，下一层每个孩子负责一个明确子概念。
 *    - patches: 该节点的补充说明（特殊逻辑、边界情况、设计取舍），不是新的子概念。
 *
 * 2. 复杂度卸载（top-light, leaf-heavy）
 *    - 越顶层 → 信息密度越低、概念越泛、偏介绍性，让读者快速建立心智模型。
 *      根节点回答"这是什么、由几块组成"；不要在根节点谈具体字段、具体算法、具体文件。
 *    - 越深层 → 信息密度越高、概念越具体，偏设计与实现细节。
 *      叶节点可以直接引用 src/ 下的真实文件、字段名、行为契约。
 *    - 一个节点的 content 如果开始堆代码细节或边界条件，通常是信号:该往下拆一层。
 *
 * 3. content 的体例
 *    - 顶部用一两句话回答"这个节点在说什么"。
 *    - 中段用编号列表或 bullet 列出该节点的核心组成 / 关键事实。
 *    - 末段（可选）给出与其他节点的衔接、与代码的对应关系。
 *    - 避免在 content 里重复 children 的具体细节；上层只做导航，细节交给下层。
 *
 * 4. named 词典
 *    只收录 content 中真正出现、且读者可能需要单独定位的术语。
 *    不是术语堆叠表；同一术语在不同节点可以有不同侧重的解释。
 *
 * 5. todo / warnings
 *    - todo: 设计上承诺、代码里未实现的能力。
 *      明确写出当前在源码的什么位置占位、缺什么，方便后续推进。
 *    - warnings: 已知的问题
 *
 * 6. 与源代码的一致性
 *    - 文档断言"代码里有 X"时，应在叶节点附近用文件路径锚定，避免漂移。
 *    - 当源代码变动时，先核对叶节点的事实陈述；顶层介绍性内容通常不需要跟着抖动。
 *
 */

type DocTreeNode = {
    title: string;
    content?: string;

    named?: Record<string, string>;

    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];

    todo?: string[];
    warnings?: string[];
};

/**
 * Object 文档树的根节点。
 *
 * 这一层只回答 OOC 是什么、Object 是什么、由几个组成部分构成，
 * 作为后续能力维度与持久层子树的阅读入口。
 */
export const root: DocTreeNode = {
    title: "OOC 概念",
    content: `
    OOC(Object Oriented Context) 以面向对象的方式组织上下文，以面向对象的方式构建 MultiAgent 系统。

    OOC 把"OOC Agent"与"Context Window"归一为同一个核心概念——**OOC Object**:
    - 每个 Object 由 4 件东西组成: identity (self.md / readme.md) + methods (server/index.ts 显式 public/private) + UI (client/index.tsx 可选) + 运行时状态(在 active flow 中体现)。
    - Object 之间通过 talk 协作、do 派生 sub-thread、metaprog 修改自己/下属。
    - "Agent"与"Context Window"退化为 Object 在系统中的角色称谓与呈现称谓，底层都是 Object。

    Object 持有 stone / pool / flow 三种持久层（World 级三分，2026-05-23 起；按"过程/产物/设计"边界归位）:
    - **stone**(静): Object 身份与设计源码（self.md / readme.md / server / client / seed knowledge）；进 git review。
    - **pool**(积): flow 产生的累积产物（不是 flow 过程本身）——per-Object 的 sediment knowledge / data / files (路径 \`pools/objects/<name>/\`)，以及系统级共享产物 git repos / 程序产物 / 公共文档 (路径 \`pools/<shared>/\`)；不进 git；**pool 不分 branch**。
    - **flow**(动): 一次 session 内的运行时过程——thread.json / talks / threads / 当前 plan / 当前 todos；不进 git；session 结束 flow 目录保留为历史考古。

    Object 生命期分三类:
    - **builtin prototype**: stone 内置原型（stones/_builtin/objects/<proto>/），出厂代码进 git；用户通过 \`extends:\` 继承。
    - **persistent**: 同时占 stone + pool；跨 session 存活；每 session 在 flow 层产生一个独立 flow 目录。
    - **ephemeral**: 只在 flow 内单层打包；寿命限于一 session；要升格须经 super flow fork snapshot 到 stone + pool。

    Object 由 8 个**内在能力维度**组合。判定一个东西是不是维度的标准是: 它是否**构成 Agent 的「自我」(self-constitutive)**（判定轴详见 patches.dimension_criterion）。按此标准 8 维度分两组:

    运行时底座（Object 据以存在、思考、行动的基础）:
    - thinkable: 可以思考
    - executable: 可以行动
    - collaborable: 可以协作
    - observable: 可观测、记录、debug
    - persistable: 可以持久化存储（即 stone/pool/flow 三层的实现）

    自我塑造三件套（Object 改写"自己"的三个面，OOC 自我进化主张的载体）:
    - reflectable: 自我反思、经验沉淀、元编程（改自己的 sediment knowledge 与 stone 身份文件）
    - programmable: 为自己编写函数方法（改自己的 server 方法库）
    - visible: 为自己编写 UI 页面（改自己的 client 界面）

    **extendable** 是**非维度的外接集成层**（不在 8 维度内）: 把外部世界（飞书 / notion / slack / github 等）按统一模板接入为可调用的方法。它够的是**外部世界**，而外部系统不构成 Agent 自我，故不是维度。

    四条贯穿全维度的横切设计:
    - **对象关系四轴**（详见 patches.object_relations）: 自我(super) / peer 平等(talk) / parent-child 层级 / **prototype 继承**。前三条是关系/权力轴，第四条是类型继承轴，完全正交。
    - **agent-native parity 公理**（详见 patches.agent_native_parity）: 每个维度都有"人类面 / agent 面"两个消费方，设计时都要回答这两面分别是什么。
    - **过程 vs 产物 vs 设计 三层归位法则**（详见 patches.persistence_attribution）: 任何字段先按"过程/产物/设计"归到 flow / pool / stone；归不上来的字段说明设计上有歧义。
    - **方法 public / private 显式声明**（详见 patches.method_visibility）: server/index.ts 导出 \`{ public, private }\`；public 进 LLM context surface，private 不进。

    Supervisor 即这棵 object 树的 root parent（详见 patches.object_relations）。
    `,
    named: {
        "OOC": "Object Oriented Context, 以面向对象的方式组织上下文，以面向对象的方式构建 MultiAgent 系统",
        "OOC Object": "OOC 系统中归一后的核心概念：identity + methods + UI + 运行时状态 4 件组成；取代 ooc-2 中 Agent / Window 二分",
        "OOC Agent": "OOC Object 充当 supervisor 派遣角色时的称谓；底层是 persistent OOC Object",
        "Context Window": "OOC Object 在 LLM context 中的呈现称谓；底层是 OOC Object",
        "thinkable": "Object 由几个维度组合，thinkable 是其中之一，定义 Object 的思考能力",
        "executable": "Object 由几个维度组合，executable 是其中之一，定义 Object 的行动能力",
        "collaborable": "Object 由几个维度组合，collaborable 是其中之一，定义 Object 的协作能力",
        "observable": "Object 由几个维度组合，observable 是其中之一，定义 Object 的可观测能力",
        "reflectable": "Object 由几个维度组合，reflectable 是其中之一，定义 Object 的元编程能力",
        "programmable": "Object 由几个维度组合，programmable 是其中之一，定义 Object 持有/演化自身函数方法库的能力",
        "visible": "Object 由几个维度组合，visible 是其中之一，定义 Object 持有/演化自身 UI 页面的能力",
        "persistable": "Object 由几个维度组合，persistable 是其中之一，定义 Object 的持久化存储能力（即 stone/pool/flow 三层）",
        "extendable": "非能力维度的外接集成层：把外部世界（飞书 / notion / slack 等）按统一模板接入为可调用的方法；实现见 src/extendable/",
        "stone": "OOC 持久层之一（静）：Object 身份与设计源码（含 seed knowledge），进 git review",
        "pool": "OOC 持久层之一（积）：flow 产出的累积产物（per-Object sediment + 系统级共享），不进 git；不分 branch",
        "flow": "OOC 持久层之一（动）：session 级运行时过程（thread / talks / threads / 当前 plan / 当前 todos）",
        "builtin prototype": "stones/_builtin/objects/<proto>/ 下的出厂内置原型；用户 Object 通过 extends 继承",
        "persistent Object": "跨 session 存活的 Object；同时占 stone (设计) + pool (产物)；运行时在 active flow 内体现",
        "ephemeral Object": "只在一 session 内的 Object；flow 层单层打包；升格须经 super flow",
        "seed knowledge": "人类在 stone 中预置的初始知识库（stones/<branch>/objects/<self>/knowledge/）；进 git review，可挂 eval gate",
        "sediment knowledge": "Object 运行时由 reflectable / collaborable 沉淀的知识（pools/objects/<self>/knowledge/memory + relations）；写就生效，不进 git",
        "self-constitutive": "维度判定轴: 一个能力是否构成 Object 的「自我」；是则为维度，否则为外接层/协议",
        "运行时底座": "thinkable/executable/collaborable/observable/persistable，Object 存在与运作的基础五维",
        "自我塑造三件套": "reflectable/programmable/visible，Object 改写自己知识/方法/界面的三维",
        "agent-native parity": "横切公理: 用户能做的事 agent 也能做；每维度都有人类面/agent 面两个消费方",
        "对象关系四轴": "自我(super) / peer 平等(talk) / parent-child 层级 / prototype 继承，4 种不同语义的关系；前 3 条是关系/权力轴，第 4 条是类型继承轴",
        "Supervisor": "world 级最顶层 parent object；harness 的 1 Supervisor + N Agent 即 object 树的一个实例，Supervisor 是 root parent",
        "ooc:// URI": "Object 寻址协议；1:1 镜像文件系统路径，如 ooc://stones/main/objects/foo 或 ooc://flows/<sessionId>/objects/<id>",
        "extends": "self.md frontmatter 字段，声明 Object 的 prototype 父节点；省略时等价 extends: root；写简写 search 等价 ooc://stones/_builtin/objects/search",
    },
    children: {},
    patches: {},
};
```

- [ ] **Step 4: tsc 验证**

```bash
bunx tsc --noEmit meta/object.doc.ts
```
Expected: 退出码 0，无报错。

- [ ] **Step 5: 暂存（不 commit；待 Task 13 一并 commit P1 阶段）**

```bash
git add meta/object.doc.ts
git status --short
```
Expected: 看到 `A  meta/object.doc.ts`。

---

### Task 5: 在 meta/object.doc.ts 加 4 条 patches（持久层三分 / 关系四轴 / 维度判定 / agent-native parity / 归位法则 / 方法可见性）

**Files:**
- Modify: `meta/object.doc.ts`（在 root 的 `patches: {}` 内填充 6 个 patch 节点）
- Reference: spec V2 §1.2-§1.5 + §3.6
- Reference: ooc-2 原 `meta/object.doc.ts` 的 patches 节点（grep `patches:` 找现有 patches 体例）

- [ ] **Step 1: 读 ooc-2 现有 patches 节点参考**

读 `/Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts`，grep `^\s*patches:\s*\{` 找到 root.patches 块（如果存在）。参考 dimension_criterion / object_relations / agent_native_parity / persistable_world 等节点的 content 写法、引用 src/ 路径的方式。

- [ ] **Step 2: 在 meta/object.doc.ts 的 root.patches 内加 6 个 patch 节点**

Edit `meta/object.doc.ts`，把 `patches: {}` 替换为：

```typescript
patches: {
    persistable_world: {
        title: "持久层三分 stone / pool / flow",
        content: `
        OOC 把所有持久状态分到三层（World 级三分，2026-05-23 起）。归位边界是"过程 vs 产物 vs 设计":

        - **stone**(进 git，设计与身份)
          路径: \`stones/<branch>/objects/<name>/\` + 出厂 \`stones/_builtin/objects/<proto>/\`
          内容: self.md / readme.md / server/ / client/ / knowledge/(seed) / children/
          特点: 进 git review；按 branch 分；同名 Object 在不同 branch 可有不同 design

        - **pool**(不进 git，产物)
          路径: per-Object 走 \`pools/objects/<name>/\`；系统级共享走 \`pools/<shared>/\`
          内容: per-Object 的 knowledge/memory + knowledge/relations + data + files；系统级的 git-repos / programs / docs 等
          特点: 不进 git；**不分 branch**——产物层不随设计分支切换重置；是 flow 产出的累积，不是 flow 过程

        - **flow**(不进 git，过程)
          路径: \`flows/<sessionId>/objects/<name>/\`
          内容: thread.json / plan.md / todos.json / talks/<peer>.jsonl / threads/<thread_id>/...
          特点: 不进 git；session 结束目录保留为历史考古；不能 append 历史 flow（只读）

        三层之间的写入边界:
        - 普通 method 调用默认写 flow（运行时过程）
        - super flow / metaprog 显式写 stone（修改 design 与身份）
        - super flow / reflectable 显式写 pool（沉淀产物）
        - 任何字段先按"过程/产物/设计"归一层；归不上来说明设计有歧义
        `,
        named: {
            "stones path": "stones/<branch>/objects/<name>/ 或 stones/_builtin/objects/<proto>/",
            "pools path": "pools/objects/<name>/ (per-Object) 或 pools/<shared>/ (系统共享)",
            "flows path": "flows/<sessionId>/objects/<name>/",
            "三层归位法则": "过程在 flow / 产物在 pool / 设计在 stone；任何字段先归一层",
        },
    },
    object_relations: {
        title: "对象关系四轴",
        content: `
        Object 之间存在四种**完全正交**的关系，每条轴有自己的语义与表达载体:

        1. **自我（super）轴** —— Object 修改自己
           载体: super flow（reflectable 维度的运行场所）
           能改: stone 内 self.md / readme.md / server / client；pool 内 knowledge/memory + knowledge/relations
           边界: 只有 super flow 协议能改自身 stone（保 reflectable 元编程闭环）

        2. **peer（talk）轴** —— 跨 Object 平等沟通
           载体: root 原型的 talk(target, content) 方法
           机制: A.talk(B, msg) 在 flow 层 append 到 talks/<peer>.jsonl 双端文件并唤起对方 LLM
           边界: 双方平等，无修改权

        3. **parent-child（层级）轴** —— 修改权归属
           载体: 目录层级 children/<sub>/
           能改: parent 有权改 child 的 stone（child 自己也能改，但 parent 是 root 修改权的 owner）
           边界: 单向授权——parent → child 可以改；child → parent 只能 talk

        4. **prototype（继承）轴** —— 类型继承（**本次归一新增**）
           载体: self.md frontmatter \`extends: <proto>\`
           机制: 方法 / client UI 在自身找不到时沿 extends 链向上 fallback（最终落到 root 原型）
           边界: 单向继承；不涉及修改权；与上述三条权力轴完全正交

        Supervisor 是这棵 object 树的 root parent——它持有 world 级最顶层的 children 修改权，是 harness 的 1 Supervisor + N Agent 模型的 root。
        `,
        named: {
            "super 轴": "Object 修改自己的能力，走 super flow 协议",
            "talk 轴": "peer 间平等沟通，走 root.talk 方法 + flow 层 talks/ 字段",
            "parent-child 轴": "目录层级表达的修改权授权",
            "prototype 轴": "self.md extends 表达的类型继承链；本次归一新增的第 4 条轴",
            "Supervisor as root parent": "world 级最顶层 parent，持有所有 children 的修改权 root",
        },
    },
    dimension_criterion: {
        title: "维度判定标准: self-constitutive",
        content: `
        判定一个能力是不是 OOC 维度的唯一标准:**它是否构成 Object 的「自我」（self-constitutive）**。

        - **是**则为维度: 比如 thinkable（无思考不能算 Object）、executable（无行动无意义）、collaborable（无协作不参与系统）、reflectable（无反思无演化）等等。
        - **不是**则降级为外接层 / 协议: 比如 extendable（外部系统不构成自我）、specific transport 协议（如 OpenAI SDK，是 thinkable 内部的 provider 实现细节）。

        按此判据 8 维度全员合法; extendable 不是维度（详见 root.children.extendable）。

        2026-05-27 的 grill 校准: 旧 reflectable 曾被质疑是否应降级为"自我演化的协议"。结论保留为维度——它描述的是"Object 自我演化"这个**可演化面**，self-constitutive 成立（无自我演化的 Object 不算完整的 OOC Object）。
        `,
        named: {
            "self-constitutive": "判定轴: 一个能力是否构成 Object 的「自我」",
        },
    },
    agent_native_parity: {
        title: "agent-native parity 公理",
        content: `
        每个维度都有**人类面 / agent 面**两个消费方; 设计时必须分别回答两面是什么。

        例:
        - thinkable: 人类面 = 看 Object 当前 context (web UI 展示)；agent 面 = LLM 看 context (执行 thinkloop)
        - executable: 人类面 = web 点按钮直调 method；agent 面 = LLM emit action 调 method
        - visible: 人类面 = web 渲染 client/index.tsx；agent 面 = LLM 通过 metaprog 改 client/index.tsx

        agent-native parity 不是设计目标而是**公理**——如果某能力只有人类面没有 agent 面，那它就不是真正的 OOC 维度，应该重新审视。
        `,
    },
    persistence_attribution: {
        title: "过程 vs 产物 vs 设计 三层归位法则",
        content: `
        任何 Object 状态字段必须能回答：是过程 / 产物 / 设计?

        - **过程**(process): 一次 session 内的运行时事件、对话流、行动日志、当前 thread 状态 → flow 层
        - **产物**(output): flow 跑完后沉淀下来的事实、累积知识、生成的数据 / 文件 → pool 层
        - **设计**(design): 由人类（或 super flow）显式拍板的身份、方法、UI、初始知识 → stone 层

        三个常见错位:
        1. 把 thread.json / talks/ 放进 stone → git 被运行时噪音污染（V1 spec 犯过这个错，V2 修正）
        2. 把 seed knowledge 放进 pool → 产物层混入设计意图，无法 PR review
        3. 把 sediment knowledge 放进 stone → 运行时沉淀进 git，与 seed/sediment 二分破坏

        归不上来的字段 = 设计有歧义，需要追问。
        `,
    },
    method_visibility: {
        title: "方法 public / private 显式声明",
        content: `
        Object 的 server/index.ts 导出形如:

        \`\`\`ts
        export default defineObject({
          public: { method_a, method_b },
          private: { _internal_helper }
        });
        \`\`\`

        可见性矩阵:

        | 维度 | public | private |
        |---|---|---|
        | LLM context 可见方法签名 | ✅ | ❌ |
        | LLM emit action 调用 | ✅ | ❌ |
        | 同 Object server 内部互调 | ✅ | ✅ |
        | program sandbox 内 JS RPC 调用 | ✅ | ❌ |
        | 跨 Object 调用 (B 调 A 的) | ✅ | ❌ |
        | sub-thread 调用 owner 的 | ✅ | ✅ |

        sub-thread 因共享 owner 身份，能调 owner 的 private; 这条边界是 do 路径的关键 invariant。
        `,
    },
},
```

- [ ] **Step 3: tsc 验证**

```bash
bunx tsc --noEmit meta/object.doc.ts
```
Expected: 退出码 0，无报错。

- [ ] **Step 4: 暂存**

```bash
git add meta/object.doc.ts
```

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 6: 在 meta/object.doc.ts 加 thinkable 子树

**Files:**
- Modify: `meta/object.doc.ts`（在 root.children 内加 thinkable）
- Reference: spec V2 §3（数据流）+ 概念基底中 thinkable 描述
- Reference: ooc-2 `meta/object.doc.ts` 的 thinkable 子树（grep `"thinkable":\s*\{`）

- [ ] **Step 1: 读 ooc-2 thinkable 子树参考**

Run:
```bash
grep -n '"thinkable":' /Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts
```
找到 thinkable 节点起始行。读它的结构: 含哪些 children (identity / llm / context / knowledge / thread / thinkloop / ...)，每个 child 的 content / named 体例。

- [ ] **Step 2: 写 thinkable 节点（skeleton——只列 children 子节点的 title 与一句 content，深度先到第 2 层）**

Edit `meta/object.doc.ts`，在 `root.children: {}` 内加 `thinkable` 节点：

```typescript
children: {
    thinkable: {
        title: "thinkable - Object 的思考能力",
        content: `
        Thinkable 描述 Object 的思考能力。归一后任何 OOC Object 都自带 thinkable（"凡 Object 必持 LLM, lazy"）。

        核心组成:
        1. LLM 交互模块: 与 OpenAI / Claude 等 provider 交互，Responses-first item 模型。
        2. ContextBuilder: 通过 root.defaultContext() 拼装该 Object 在 active flow 内能看见的全部信息切片（plan / threads / talks / todos / relations 等）。
        3. 方法调用模块: LLM 通过 emit action 调本 Object public 方法或跨 Object talk。无 4 个基础 tool 的二分——method 即基础 verb。
        4. Thread Tree: thread 可派生 sub-thread (do verb)，扁平存放于 flow 层 threads/<thread_id>/。

        thinkable 子维度:
        - identity: Object 如何认识自己 (self.md) 与被外界认识 (readme.md)
        - llm: provider 协议适配 (OpenAI Responses-first 内部模型)
        - context: 由 root.defaultContext() + 自定义切片组成
        - knowledge: seed (stone) + sediment (pool) 二分; 渐进激活
        - thread: 主 thread + sub-threads 同形态，flow 层独立目录
        - thinkloop: 单 thread 一轮 "构造 context → 调 LLM → 执行 method → 写入事件" 的循环
        `,
        named: {
            "Thinkable": "Object 的思考能力维度",
            "ContextBuilder": "拼装 LLM context 的运行时模块；root.defaultContext() 是其核心入口",
            "Thread Tree": "主 thread + 多个 sub-thread (do 派生) 组成的扁平结构（不嵌套）",
            "ThinkLoop": "单个 thread 内的一轮思考循环",
        },
    },
    // 其他维度的 children 占位（后续 task 填充）
},
```

> 注：子节点 (identity / llm / context / knowledge / thread / thinkloop) 在 Plan 2+ 阶段（实现 thinkable 时）再展开。本 plan 只到第 2 层骨架。

- [ ] **Step 3: tsc 验证**

```bash
bunx tsc --noEmit meta/object.doc.ts
```
Expected: 退出码 0。

- [ ] **Step 4: 暂存**

```bash
git add meta/object.doc.ts
```

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 7: 在 meta/object.doc.ts 加 executable / collaborable / observable 子树

**Files:**
- Modify: `meta/object.doc.ts`（在 root.children 内继续加三个维度节点）
- Reference: spec V2 §3 + §2.5 + §3.6
- Reference: ooc-2 `meta/object.doc.ts` 对应子树

- [ ] **Step 1: 读 ooc-2 三个维度参考**

Grep:
```bash
grep -n '"executable":\|"collaborable":\|"observable":' /Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts
```
读每个维度的 root content + 二级 children 标题。注意：归一后这些维度的内部 children 结构会变（比如 executable 不再有 "windows" 这种 children——按 §2.3 现在是 root 原型 + 7 个其他原型）。

- [ ] **Step 2: 在 meta/object.doc.ts 的 root.children 内加 3 节**

紧接 thinkable 之后加：

```typescript
executable: {
    title: "executable - Object 的行动能力",
    content: `
    Executable 描述 Object 的行动能力——把"想做"变成"做了"。

    核心组成:
    1. 方法集 (Methods): 每个 Object 的 server/index.ts 显式导出 \`{ public, private }\`；public 进 LLM context surface，private 内部用。
    2. 调用 dispatcher: LLM emit action / program sandbox JS RPC / cross-Object method call 三种入口走同一 dispatcher。
    3. Prototype 链解析: 方法查询沿 self.md \`extends:\` 链向上 fallback；root 原型为终点兜底。
    4. ephemeral Object 创建: A 类方法（grep / glob / open_file / program 等）触发 flows/<sessionId>/objects/<id>/ 落盘。

    executable 子维度:
    - methods: server/index.ts public/private 显式声明的方法集
    - dispatcher: 统一调用路径 + prototype chain resolve
    - sandbox: program 原型的代码执行环境
    - tools: grep/glob/file 等系统级工具方法（root 原型 public）
    `,
    named: {
        "Executable": "Object 的行动能力维度",
        "Method dispatcher": "统一的方法调用入口；resolve 经 prototype 链",
        "Prototype chain": "self.md extends 形成的类型继承链，决定 method/UI fallback 顺序",
        "ephemeral Object 创建": "A 类原型方法触发的 flow 层新 Object 实例化",
    },
},
collaborable: {
    title: "collaborable - Object 的协作能力",
    content: `
    Collaborable 描述 Object 间的协作。归一后两个核心:

    1. **talk 直投** (peer 轴): root.talk(target, content) append flow 层双端 talks/<peer>.jsonl，唤起 target LLM。不再有 talk_window 中介。
    2. **do sub-thread** (内部派生): root.do(intent) 在 flow 层 threads/<thread_id>/ 起独立 LLM thread，共享 owner 身份。

    collaborable 子维度:
    - talk: peer 间消息直投机制
    - subthread: 主 thread + sub-thread 形态（do verb 派生）
    - relations: pool 长期 relations 与 stone children 引用的合成
    `,
    named: {
        "Collaborable": "Object 的协作能力维度",
        "talk 直投": "A.talk(B) 直接 append 双端文件并唤起 B，无中介",
        "sub-thread": "do verb 派生的内部并行 thread，共享 owner 身份",
    },
},
observable: {
    title: "observable - Object 的可观测能力",
    content: `
    Observable 描述 Object 的可观测、可记录、可 debug 能力。

    核心组成:
    1. LLM observation: 记录每轮 thinkloop 的 input/output（含 tool call）。
    2. Pause / step / replay: debug 时按 thread 单步推进。
    3. Debug 文件落盘: 每个 session 在 flows/<sessionId>/debug/ 下产生可阅读的 debug log。

    observable 子维度:
    - llm_observation: thinkable 调 LLM 的过程记录
    - pause: thread 级断点机制
    - debug_files: 落盘的 debug log
    `,
    named: {
        "Observable": "Object 的可观测能力维度",
        "LLM observation": "记录 LLM 输入输出的横切机制",
        "Pause": "thread 级断点；可在 thinkloop 任意步暂停",
    },
},
```

- [ ] **Step 3: tsc 验证**

```bash
bunx tsc --noEmit meta/object.doc.ts
```

- [ ] **Step 4: 暂存**

```bash
git add meta/object.doc.ts
```

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 8: 在 meta/object.doc.ts 加 persistable 子树（核心：stone/pool/flow 三层细化）

**Files:**
- Modify: `meta/object.doc.ts`（root.children 内加 persistable）
- Reference: spec V2 §2 + 现有 ooc-2 persistable 子树（最复杂的子树，关注 stone/pool/flow 三个 children）

- [ ] **Step 1: 读 ooc-2 persistable 子树参考**

Grep:
```bash
grep -n '"persistable":\|"stone":\|"pool":\|"flow":\|persistable\.' /Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts
```
读 persistable 节点的 content + 三个 children（stone/pool/flow）的体例。注意 V2 调整：pool 的范围扩大到含"系统级共享产物"，pool 不分 branch。

- [ ] **Step 2: 在 root.children 内加 persistable 节**

紧接 observable 之后加：

```typescript
persistable: {
    title: "persistable - Object 的持久化存储",
    content: `
    Persistable 描述 Object 的持久化存储能力，由 stone / pool / flow 三层组成（World 级三分，2026-05-23 起；V2 校准归位边界）。

    三层归位法则：过程在 flow / 产物在 pool / 设计在 stone（详见 root.patches.persistence_attribution）。

    每个 persistent Object 同时占 stone + pool；运行时在 active flow 内体现状态。
    ephemeral Object 全套打在 flow 层单目录。
    `,
    children: {
        stone: {
            title: "stone - 身份与设计（进 git）",
            content: `
            Stone 持有 Object 的身份与设计源码。

            路径形态:
            - 出厂内置: \`stones/_builtin/objects/<proto>/\`（root / program / search / file / knowledge / command_exec / skill_index / custom 共 8 个 builtin prototype）
            - 用户分支: \`stones/<branch>/objects/<name>/[children/<sub>/]*\`

            内容五件套:
            - self.md: Object 写给自己的身份文档；frontmatter 含 \`extends: <proto>\`（省略等价 extends: root）
            - readme.md: Object 写给外部世界的介绍
            - server/index.ts: 显式导出 \`{ public, private }\` 的方法集
            - client/index.tsx: 自定义 UI（可选；缺则原型链 fallback 到祖先；root 原型必有兜底）
            - knowledge/: seed knowledge（人类设计的初始知识库，可挂 eval gate）

            可选: children/<sub>/ 嵌套子 Object（parent-child 修改权层级）

            进 git review；按 branch 分；同名 Object 在不同 branch 可有不同 design。
            `,
            named: {
                "stone path": "stones/<branch>/objects/<name>/ 或 stones/_builtin/objects/<proto>/",
                "self.md": "Object 写给自己的身份文档；frontmatter 含 extends:",
                "readme.md": "Object 写给外部世界的介绍",
                "server/index.ts": "显式 public/private 方法集",
                "client/index.tsx": "自定义 UI；可选；原型链 fallback",
                "seed knowledge": "stones/<.../knowledge/ 下的人类设计初始知识库",
            },
        },
        pool: {
            title: "pool - 累积产物（不进 git，不分 branch）",
            content: `
            Pool 持有 flow 产出的累积产物。它是 flow 的"output"——session 跑完后沉淀下来的事实、累积知识、生成文件，不是 flow 过程本身。

            **不进 git；不分 branch**——产物层不随设计分支切换重置。

            两类命名空间:

            1. **per-Object 产物** \`pools/objects/<name>/\`
               - knowledge/memory/<slug>.md: 长期记忆（sediment knowledge，super flow 写入）
               - knowledge/relations/<peer>.md: long_term relations（super flow 写入）
               - data/: csv 数据沉淀
               - files/: 产物文件

            2. **系统级共享** \`pools/<shared>/\`
               - pools/git-repos/<repo>/: clone/管理的外部 git 仓库
               - pools/programs/<artifact>/: 程序产物 / 构建结果
               - pools/docs/<...>: 公共文档

            写入路径:
            - sediment knowledge / relations: 仅 super flow（reflectable）允许写
            - data / files: 由 stone server method 维护（不由反思直接写）
            - 系统级共享: 由各种工具方法 / programmable 维护
            `,
            named: {
                "pool path (per-Object)": "pools/objects/<name>/",
                "pool path (shared)": "pools/<shared>/，如 pools/git-repos/<repo>/",
                "sediment knowledge": "pools/objects/<self>/knowledge/{memory,relations}/，运行时沉淀，不进 git",
            },
        },
        flow: {
            title: "flow - 运行时过程（不进 git）",
            content: `
            Flow 持有一次 session 内 Object 的运行时过程。

            路径: \`flows/<sessionId>/objects/<name>/\`

            内容字段（全部按需 lazy 创建）:
            - thread.json: 主 thread LLM state；首次被 talk 时创建
            - plan.md: 当前主 thread 引导 plan（root.plan_set 写入）
            - todos.json: 当前主 thread todo 列表（root.todo_* 方法 mutate）
            - talks/<peer_uri_slug>.jsonl: 对外消息流 append-only；root.talk 写入
            - threads/<thread_id>/: 对内 sub-thread 目录（root.do 创建）
              · intent.md: 子线程意图；含 parent_thread_id 字段
              · thread.json: 子线程独立 LLM
              · actions.jsonl: 行动日志
              · plan.md / todos.json: 子线程自己的 plan / todos

            persistent Object 在每个 session 各占一个独立的 flow 目录；ephemeral Object 全套打在 flow 单目录（self.md / server / client / 上述运行时字段均在内）。

            session 结束 flow 目录**保留为历史考古**；想保留为长期资产须经 super flow 升格沉淀到 stone (design) 或 pool (产物)。
            `,
            named: {
                "flow path": "flows/<sessionId>/objects/<name>/",
                "thread.json": "主 thread LLM state；lazy 创建",
                "talks/<peer>.jsonl": "对外消息流 append-only",
                "threads/<thread_id>/": "对内 sub-thread 目录；扁平 + parent_thread_id 字段",
                "intent.md": "sub-thread 意图描述；含 parent_thread_id",
            },
        },
    },
    named: {
        "stone/pool/flow 三层": "World 级三分；过程/产物/设计的物理归位",
    },
},
```

- [ ] **Step 3: tsc 验证**

```bash
bunx tsc --noEmit meta/object.doc.ts
```

- [ ] **Step 4: 暂存**

```bash
git add meta/object.doc.ts
```

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 9: 在 meta/object.doc.ts 加 reflectable / programmable / visible 子树

**Files:**
- Modify: `meta/object.doc.ts`（root.children 内加 3 节）
- Reference: spec V2 + ooc-2 这三个维度的描述

- [ ] **Step 1: 读 ooc-2 三个维度参考**

```bash
grep -n '"reflectable":\|"programmable":\|"visible":' /Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts
```
读每个维度的 root content + 主要 children 标题。

- [ ] **Step 2: 在 root.children 内加 3 节**

紧接 persistable 之后加：

```typescript
reflectable: {
    title: "reflectable - 自我反思与元编程",
    content: `
    Reflectable 描述 Object 的自我反思与元编程能力。是"自我塑造三件套"之一。

    核心: **super flow** —— Object 一切"自我相关"能力的统一执行场所。
    自观测（读自己历史）、自反思（沉淀经验）、自修改（改 self / sediment）都收敛到 super flow。

    可改的内容（写入路径区分）:
    1. stone 内的身份文件 (self.md / readme.md) —— 改自己的身份与角色
    2. pool 内的 sediment knowledge (knowledge/memory + knowledge/relations) —— 沉淀经验与对外认知

    元编程闭环: super flow 写完后下一轮新 thread 自动看见落盘的新内容。

    特殊: 也是 ephemeral → persistent 升格的唯一路径（详见 spec §3.8）。
    `,
    named: {
        "Reflectable": "Object 的自我反思与元编程能力",
        "super flow": "Object 修改自己的统一执行场所；sessionId='super' 特殊上下文",
        "memory 写入": "super flow 把新认知沉淀到 pools/objects/<self>/knowledge/memory/<slug>.md",
        "ephemeral 升格": "super flow fork snapshot 把 ephemeral Object 沉淀到 stone + pool",
    },
},
programmable: {
    title: "programmable - 为自己写函数方法",
    content: `
    Programmable 描述 Object 为自己编写函数方法的能力。是"自我塑造三件套"之二。

    机制:
    1. metaprog method (root 原型 public): 在 super flow 内调用，允许写入自己 stone 的 server/index.ts。
    2. write_file method: 一般文件写入；通过 metaprog 限制范围保证只能写自身 stone 路径。
    3. Object 改完 server/ 后 watch mode loader 自动热重载，下一轮新调用走新方法集。

    边界:
    - 修改自己的 server: 通过 super flow / metaprog
    - 修改 children/ 下的 server: 通过 super flow（parent 持有 children 修改权）
    - 修改 peer 的 server: 不行（peer 通过 talk 协作，不通过修改权）
    `,
    named: {
        "Programmable": "Object 为自己写函数方法的能力",
        "metaprog method": "root 原型 public 方法；super flow 内允许修改自身 stone server/",
    },
},
visible: {
    title: "visible - 为自己写 UI 页面",
    content: `
    Visible 描述 Object 为自己编写 UI 页面的能力。是"自我塑造三件套"之三。

    机制:
    1. 每个 Object 可选地在 stone 内放 client/index.tsx 作为自定义 UI。
    2. ooc:// URI 1:1 镜像文件系统路径；URI 由 visible 维度解析（详见 spec §5.1）。
    3. Web 渲染走原型链 fallback: 自身无 client → 沿 extends 链向上找 → 落到 root 原型必有 client 兜底（详见 spec §5.2）。
    4. Object 改自己 client/index.tsx 通过 super flow / metaprog。
    `,
    named: {
        "Visible": "Object 持有/演化自身 UI 的能力维度",
        "ooc:// URI": "Object 寻址协议，1:1 镜像文件系统路径；由 visible 解析",
        "原型链 fallback": "无自定义 client 的 Object 沿 extends 链向上找；root 原型必有兜底",
    },
},
```

- [ ] **Step 3: tsc 验证 + 暂存**

```bash
bunx tsc --noEmit meta/object.doc.ts
git add meta/object.doc.ts
```

- [ ] **Step 4: 验证 root.children 已含 8 维度**

Run:
```bash
grep -c '    title: "thinkable\|    title: "executable\|    title: "collaborable\|    title: "observable\|    title: "persistable\|    title: "reflectable\|    title: "programmable\|    title: "visible' meta/object.doc.ts
```
Expected: `8`。

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 10: 在 meta/object.doc.ts 加 extendable 子节点（非维度）

**Files:**
- Modify: `meta/object.doc.ts`（root.children 内加 extendable，并加 root.content 中的对应引用）

- [ ] **Step 1: 读 ooc-2 extendable 子树参考**

```bash
grep -n '"extendable":' /Users/zhangzhefu/x/ooc-2/ooc/meta/object.doc.ts
```

- [ ] **Step 2: 在 root.children 内加 extendable 节**

紧接 visible 之后加：

```typescript
extendable: {
    title: "extendable - 外接集成层（非维度）",
    content: `
    Extendable 是 OOC 的外接集成层，**不是 8 维度之一**。

    判定理由: 它接入的是外部世界（飞书 / notion / slack / github 等），而外部系统**不构成 Object 自我**，故不满足 self-constitutive 判定（详见 root.patches.dimension_criterion）。

    机制: 把外部系统的能力按统一模板包装成可调用的方法; 一个外部系统对应一个或几个特殊原型 Object（比如 feishu_doc / notion_page），它们 \`extends: root\`，方法集封装外部 API。

    首个 case: 飞书集成（详见 case.feishu-integration.doc.ts）。
    `,
    named: {
        "Extendable": "外接集成层；非 8 维度",
        "外部系统": "飞书 / notion / slack 等不构成 Object 自我的协作系统",
    },
},
```

- [ ] **Step 3: tsc 验证 + 暂存**

```bash
bunx tsc --noEmit meta/object.doc.ts
git add meta/object.doc.ts
```

- [ ] **Step 4: 验证 object.doc.ts 整体结构**

Run:
```bash
wc -l meta/object.doc.ts
```
Expected: 文件大约 500-700 行（取决于详尽程度）。

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 11: 写 meta/app.server.doc.ts 与 meta/app.client.doc.ts skeleton

**Files:**
- Create: `meta/app.server.doc.ts`
- Create: `meta/app.client.doc.ts`
- Reference: spec V2 §4 + §5；ooc-2 现有这两个文件作结构参考

- [ ] **Step 1: 写 meta/app.server.doc.ts**

Create `meta/app.server.doc.ts`:

```typescript
// 文档维护说明同 meta/object.doc.ts（精简）

type DocTreeNode = {
    title: string;
    content?: string;
    named?: Record<string, string>;
    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];
    todo?: string[];
    warnings?: string[];
};

export const root: DocTreeNode = {
    title: "app.server - HTTP 控制面",
    content: `
    app.server 是 OOC 的 HTTP 控制面 + worker 调度面，基于 Elysia 实现。

    核心组成:
    1. **三层 Object loader** (详见 children.loader): 扫 stone (_builtin + branch) / pool (per-Object + shared) / flow (current active)，建 ObjectRecord registry，按 prototype 链解析方法与 client UI。
    2. **HTTP 路由**: ooc:// URI 1:1 镜像，统一形式 \`/stones/<branch>/objects/<name>\` / \`/pools/objects/<name>\` / \`/pools/<shared>\` / \`/flows/<sessionId>/objects/<name>\`。
    3. **worker queue**: 主 thread + sub-thread 的 LLM 调用调度；按 sessionId / objectId / thread_id 三元定位。
    4. **talk 直投回路**: A.talk(B) 在 flow 层 append 双端 talks/ 文件 + 调度 B 的 worker wake。
    5. **ephemeral Object 创建**: 由 root 原型的 grep / glob / open_file / open_knowledge / program 等方法触发 flows/<sessionId>/objects/<id>/ 落盘。
    `,
    named: {
        "Elysia": "TypeScript HTTP 框架；OOC 控制面基础",
        "三层 loader": "扫 stone / pool / flow 的统一加载器",
        "ObjectRecord": "Object 的运行时表示；含 stone/pool/flow 三层 paths",
        "worker queue": "LLM 调用调度队列",
    },
    children: {},
    patches: {},
    todo: [
        "loader: 实现三层源扫描 + extends 解析 + 循环检测 (P3)",
        "worker: 实现 talk 直投 + sub-thread spawn (P5)",
        "ephemeral 创建: 实现 grep / program / search 等方法的落盘机制 (P6)",
    ],
};
```

- [ ] **Step 2: 写 meta/app.client.doc.ts**

Create `meta/app.client.doc.ts`:

```typescript
type DocTreeNode = {
    title: string;
    content?: string;
    named?: Record<string, string>;
    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];
    todo?: string[];
    warnings?: string[];
};

export const root: DocTreeNode = {
    title: "app.client - Web 控制面",
    content: `
    app.client 是 OOC 的 Web 控制面，基于 vite + React + react-router 实现。

    核心组成:
    1. **AppShell 路由**: ooc:// URI 1:1 映射 SPA route。四类路由统一形式 (详见 spec §5.1)。
    2. **ObjectClientRenderer**: 按原型链 fallback 解析每个 Object 的 client/index.tsx；root 原型必有兜底。
    3. **chat 模型**: 用户视角下浏览的 Object 列表（每个 Object UI 内含 talk 输入框），取代旧的 talk_window 列表模型。
    4. **历史 flow 只读**: 进入 /flows/<old_session>/objects/<id> 不显示 talk 输入框、调用按钮 disabled。
    5. **方法 button 直调**: web 可直接 invoke public 方法（非敏感的）；敏感方法标 requireLLM 拒按钮直调。
    `,
    named: {
        "AppShell": "顶层路由 + 全局布局组件",
        "ObjectClientRenderer": "每个 Object UI 的渲染器；走原型链 fallback",
        "chat 模型": "用户视角的 Object 浏览列表（替代旧 talk_window 列表）",
        "原型链 fallback": "Object 自身无 client → 沿 extends 链向上 → 落 root.client 兜底",
        "requireLLM": "敏感方法标记；拒 web 按钮直调，必须经 LLM talk",
    },
    children: {},
    patches: {},
    todo: [
        "AppShell: 实现四类路由 (P7)",
        "ObjectClientRenderer: 原型链 fallback resolver (P7)",
        "root.client/index.tsx: 兜底 UI 实现 (P4)",
    ],
};
```

- [ ] **Step 3: tsc 验证**

```bash
bunx tsc --noEmit meta/app.server.doc.ts meta/app.client.doc.ts
```

- [ ] **Step 4: 暂存**

```bash
git add meta/app.server.doc.ts meta/app.client.doc.ts
```

- [ ] **Step 5: 不 commit（待 Task 13）**

---

### Task 12: 写其他 meta 文件 skeleton

**Files:**
- Create: `meta/engineering.harness.doc.ts`
- Create: `meta/engineering.testing.doc.ts`
- Create: `meta/cookbook.author-ooc-object.doc.ts`
- Create: `meta/case.factor-dev-agents.doc.ts`
- Create: `meta/case.feishu-integration.doc.ts`
- Create: `meta/index.doc.ts`

- [ ] **Step 1: 写 meta/engineering.harness.doc.ts**

Create:

```typescript
type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "engineering.harness - 工程组织结构",
    content: `
    OOC 项目的工程协作模型: 1 Supervisor + 9 Agent (8 AgentOfX 维度对应 + 1 AgentOfExperience 体验官)。

    所有 Agent 都是 stones/<branch>/objects/agent_of_<X>/ 下的 persistent OOC Object（充当 Agent 角色）；Supervisor 在 harness 实现中是 world 级 root parent，符号化角色（不实体化为 Object 目录）。

    interim runtime: 当前由 Claude Code 主会话承担 Supervisor 职责；sub agent dispatch 承接各 AgentOfX 角色。等 ooc-3 P9 阶段会实际落地 9 个 Agent 的 stone 目录。
    `,
    named: {
        "Supervisor": "world 级 root parent；符号化角色",
        "AgentOfX": "对应 8 维度 + experience 共 9 个 persistent Object，扮演该维度的设计与实现 owner",
        "AgentOfExperience": "体验官；负责真实跑功能、发现 Issue、回流给对应 AgentOfX",
        "interim runtime": "当前由 Claude Code 主会话扮 Supervisor，sub agent 扮 AgentOfX",
    },
    children: {},
    patches: {},
    todo: [
        "P9: 在 stones/main/objects/ 下落地 8 个 agent_of_<X>/ + 1 个 agent_of_experience/",
    ],
};
```

- [ ] **Step 2: 写 meta/engineering.testing.doc.ts**

Create:

```typescript
type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "engineering.testing - 测试策略",
    content: `
    OOC 测试三档评分 + 双观察孔:

    1. **三档评分**: Good / OK / Bad，按 spec 测试场景的明确 Good 标准评估。
    2. **A 观察孔 backend**: Elysia app.handle() 直调，覆盖 HTTP + worker 端到端 (route-audit gate 必过)。
    3. **B 观察孔 frontend**: Playwright 真浏览器，覆盖 SPA route + AppShell + ObjectClientRenderer。

    必加 e2e 场景（详见 spec §7.2 + §7.3）含: prototype chain resolve / public-private 边界 / stone/pool/flow 写入归位 / ephemeral 落盘 / 自动 flow 创建 / talk 直投回路 / sub-thread 扁平 + 共享身份 / super flow 升格 / B 类塌缩字段 / route-audit / active_branch 隔离。

    7 条 merge gate (详见 spec §7.4):
    1. route-audit 全员通过
    2. prototype chain resolve 单元测试 100% 覆盖
    3. stone/pool/flow 写入归位 e2e PASS
    4. talk / do 直投回路 e2e PASS 在真浏览器
    5. ephemeral 落盘 fs assertion
    6. super flow 升格回路 e2e PASS
    7. tsc --noEmit meta/*.doc.ts 全员通过
    `,
    named: {
        "三档评分": "Good / OK / Bad 三档评判",
        "双观察孔": "A 孔 backend / B 孔 frontend",
        "route-audit": "扫描所有 public method 是否有真 HTTP 路由注册的 gate",
    },
    children: {},
    patches: {},
    todo: [
        "P5/P6/P7: 实现 §7.2 + §7.3 的 e2e 场景",
        "merge gate: P10 收尾终检 7 条 gate",
    ],
};
```

- [ ] **Step 3: 写 meta/cookbook.author-ooc-object.doc.ts**

Create:

```typescript
type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "cookbook - 添加新 OOC Object 教学",
    content: `
    从空到能跑的 5 步教学（取代旧 ooc-2 中 add-new-agent + author-ooc-agent 两份）:

    1. **选 prototype**: 从 stones/_builtin/objects/ 下 8 个内置原型选一个继承（最常用 \`extends: root\`）；或继承 branch 内已有 Object。
    2. **创建 stone 目录**: \`stones/<branch>/objects/<name>/\` 或 \`stones/<branch>/objects/<parent>/children/<name>/\`。
    3. **写 self.md + readme.md**: frontmatter 含 \`extends:\`；body 写身份与角色。
    4. **写 server/index.ts**: 显式导出 \`{ public: {...}, private: {...} }\`；可只写 \`public: {}\` 完全继承 prototype 方法。
    5. **(可选) 写 client/index.tsx**: 自定义 UI；缺则原型链 fallback 到 root 兜底。

    验证: 启动 server → 通过 /stones/<branch>/objects/<name> 路由能看到 UI → talk 一句话能唤起 LLM 思考。
    `,
    named: {
        "5 步教学": "选 prototype → 建 stone 目录 → self/readme → server → (可选) client",
        "extends": "self.md frontmatter 字段；声明 prototype 父节点",
    },
    children: {},
    patches: {},
    todo: [
        "P9: 写出详细 cookbook 含具体示例 (3 个 builtin 原型继承 / 1 个 branch 内继承)",
    ],
};
```

- [ ] **Step 4: 写 meta/case.factor-dev-agents.doc.ts + meta/case.feishu-integration.doc.ts**

Create `meta/case.factor-dev-agents.doc.ts`:

```typescript
type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "case - 哨兵平台因子开发助手",
    content: `
    第一个外部场景 case: 把哨兵平台的因子开发助手（plugins_with_agent 项目，15 个 Claude Code SKILL.md）收编成:

    - 3 个持久 OOC Object（充当 Agent 角色）: sentry_factor_dev (流程编排) / sentry_event_factor / sentry_factor_group
    - 1 个 branch 级 skill: psm-query

    展示外部场景如何用 OOC Object + skill 的层次表达。

    待 ooc-3 P9 实施时落到 stones/main/objects/ 下。
    `,
    children: {},
    todo: [
        "P9: 落地 3 个 Object + 1 个 skill",
    ],
};
```

Create `meta/case.feishu-integration.doc.ts`:

```typescript
type DocTreeNode = {
    title: string; content?: string; named?: Record<string, string>;
    children?: Record<string, DocTreeNode>; patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]]; sources?: [[any, string]];
    todo?: string[]; warnings?: string[];
};

export const root: DocTreeNode = {
    title: "case - 飞书集成（extendable 首个 case）",
    content: `
    extendable 维度（非 8 维度内）的首个 case: 把飞书外部协作能力按统一模板接入。

    设计模式: 创建几个特殊原型 Object 如 feishu_doc / feishu_message，extends: root，方法集封装飞书 API。

    详见 extendable 的定义（meta/object.doc.ts root.children.extendable）。
    `,
    children: {},
    todo: [
        "实现 src/extendable/feishu/ 适配层",
        "创建 stones/_builtin/objects/feishu_*/ 内置原型（或放 branch 而非 builtin？决策留 P6 阶段）",
    ],
};
```

- [ ] **Step 5: 写 meta/index.doc.ts 聚合入口**

Create:

```typescript
// 聚合所有 meta doc trees，方便统一 import / 检索
export * as object from "./object.doc";
export * as appServer from "./app.server.doc";
export * as appClient from "./app.client.doc";
export * as engineeringHarness from "./engineering.harness.doc";
export * as engineeringTesting from "./engineering.testing.doc";
export * as cookbookAuthorOocObject from "./cookbook.author-ooc-object.doc";
export * as caseFactorDevAgents from "./case.factor-dev-agents.doc";
export * as caseFeishuIntegration from "./case.feishu-integration.doc";
```

---

### Task 13: P1 gate + 最终 commit

**Files:**
- Modify: 暂存 Task 4-12 所有变更，最终 commit

- [ ] **Step 1: 运行完整 tsc 验证（meta 全员）**

```bash
bunx tsc --noEmit meta/index.doc.ts meta/object.doc.ts meta/app.server.doc.ts meta/app.client.doc.ts meta/engineering.harness.doc.ts meta/engineering.testing.doc.ts meta/cookbook.author-ooc-object.doc.ts meta/case.factor-dev-agents.doc.ts meta/case.feishu-integration.doc.ts
```
Expected: 退出码 0，无任何报错。这是 **P1 gate**。

- [ ] **Step 2: 跑 bun test（应仍为空 PASS）**

```bash
bun test
```
Expected: no tests, exit 0。

- [ ] **Step 3: 看 git 暂存状态**

```bash
git status --short
```
Expected: 看到所有 meta/*.doc.ts 文件作为 staged 状态。

- [ ] **Step 4: P1 commit**

```bash
git commit -m "$(cat <<'EOF'
docs(meta): P1 concept skeleton - object + 8 dimensions + persistable trinity

P1 落 meta 概念骨架:
- meta/object.doc.ts: 完整概念权威 (4 关系轴 / 三层 stone/pool/flow /
  8 维度 / extendable 非维度) ；引入 OOC Object 归一概念
- meta/app.server.doc.ts: HTTP 控制面 skeleton
- meta/app.client.doc.ts: Web 控制面 skeleton
- meta/engineering.harness.doc.ts: 1 Supervisor + 9 Agent skeleton
- meta/engineering.testing.doc.ts: 三档评分 + 双观察孔 + 7 gate skeleton
- meta/cookbook.author-ooc-object.doc.ts: 5 步教学 skeleton
- meta/case.factor-dev-agents.doc.ts / case.feishu-integration.doc.ts: 术语校准
- meta/index.doc.ts: 聚合入口

所有 meta/*.doc.ts 通过 tsc --noEmit。P1 gate ✅。

下一个 plan: P2+P3 (persistable + thinkable 基础 + loader + prototype 链)

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

- [ ] **Step 5: 验证 commit 与分支状态**

```bash
git log --oneline
git branch -v
git status
```
Expected: 看到两个 commit（Task 3 的 bootstrap + Task 13 的 meta skeleton）；branch=ooc-3；working tree clean。

P0+P1 完成。
