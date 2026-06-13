# OOC Object/Agent/组合 重构 —— 完成记录

> 2026-06-13。分支 `ooc-agent-composition`（基于 ooc-6）。用户拍板方案 A（推进到完美）。
> 设计模型已端到端实现 + 真 LLM（claude-opus-4-8）验证 + 设计权威回流 ooc-0。
> **已推送远端**：`origin/ooc-6` FF 推进（新代码库集成线），`origin/main` force 覆盖为 ooc-2 工作树
> （用户知情授权，旧代码库 main 指针 f7dd1c5d 仍可恢复）——ooc-2 现为 canonical main。HEAD=`90275442`。

---

## 1. 设计目标（用户提出）

以人用电脑为蓝本的根本不同：**OOC Object** 实现 OOP；**OOC Agent** = 能 talk/think/跑 thread 的 Object，
对应一个 **OOC class** 提供 agency（talk/do）+ **声明初始成员对象**（filesystem/terminal/world/knowledge…）；
**组合（HAS-A）**：Object 像持有 data 一样持有 objects（设计期，区别于运行期 parent-child do-fork）。
tool-object（filesystem/terminal…）**不是 Agent**（无 agency）。

## 2. 达成态（全部已验证）

| 设计要素 | 状态 | 验证 |
|---|---|---|
| 组合机制：class 声明 `ooc.members`，注入为 context window（`isMemberWindow` 非持久化），do-fork 子线程也注入 | ✅ | TC-COMP-03/04 + Tier B |
| Object/Agent 边界：tool-object `parentClass=null` 无 agency | ✅ | TC-COMP-05 |
| 显式 `_builtin/agent` 基类（root+agency）+ builtin 多跳类链（supervisor→_builtin/supervisor→_builtin/agent→root） | ✅ | TC-COMP-02 |
| 成员 filesystem（grep/glob/open_file/write_file）/ terminal（program） | ✅ | Tier B AN-COMP-01 |
| agency（do/talk/plan/todo/end）只在 `_builtin/agent`；`exec` 缺省目标=agent self 窗 | ✅ | Tier B（exec 无 window_id 走 self） |
| create_object → **world** 成员；open_knowledge → **knowledge_base** 成员；root 只剩 example+feishu | ✅ | TC-COMP-06 + Tier B AN-COMP-02/03 |
| agent-facing 表面回流（exec 描述 / root-methods.md / 激活键归属 / `method::` 类链匹配）+ 删 2 死文件 | ✅ | activator.expr + protocol-knowledge 单测 |
| 设计权威回流：executable 维度 self.md 写入组合模型；push ooc-0 | ✅ | commit `6eb8bdd` |

**门禁**：`bun run verify` 全绿（tsc 干净 / core 917 pass 0 fail / 4 checks OK）；storybook Tier A 63 pass；
Tier B（真 world + claude-opus-4-8）class story 4 case 全 PASS，storyTier=Good。

## 3. 父仓 commit 序（`ooc-agent-composition`）

`bc5a12e4`/`60012954`/`a4f671ab`(Inc1/1.5) → `da93c165`(Inc2) → `cc7d3d84`(Inc3a) →
Stage1/2a/2b（agency 迁 `_builtin/agent` + exec 默认 self + reframe ~27 测试）→
`ee011838`(Inc3b world/knowledge_base) → `739f0d2d`(Tier B AN-COMP-02/03) →
`66a0fe7b`(agent-facing 回流 + 类链激活匹配 + 删死文件)。
对象树 ooc-0：`6eb8bdd`(executable 设计回流) 已 push。

## 4. root 旧 impl 归并 —— 已完成（commit `90275442`）

迁移方法的旧实现文件已彻底归并：成员包导出各自 exec 符号（filesystem grepExec/.../writeFileExec、
terminal programExec/programMethod、world executeCreateObject）成唯一注册/实现家；grep 真实现
`method.grep.impl.ts → builtins/search/grep-impl.ts`；删死壳 method.{create-object,open-file,program,
write-file,grep}.ts；8 测试 + 1 backend e2e re-point；session-path 注释 + 对象树 executable knowledge
回流。root/executable/ 仅留 agency + example 实现 + 注册中心。e2e 8 pass、core 974、storybook 63 全绿。

## 5. 刻意推迟（非达成缺口，是 deliberate 边界）

- **Step 4 实例运行时可变成员**（中途 acquire/drop，如装 browser）：**无消费方**，按 `克制熵增` 推迟。
  用户的组合论是设计期 HAS-A（class 声明），运行期可变成员属未来扩展、非当前目标。
- **root 窗**：仍是 window-tree 结构锚（`parentWindowId:ROOT_WINDOW_ID`），这是正确的——它不再是命令面
  （exec 默认 self 窗、agency 在 _builtin/agent），但作为树根保留。

## 6. 关键机制锚 + 踩坑（给接续者）

- **新增 builtin 成员**：五件套 `builtins/<name>/{package.json(objectId `_builtin/<name>`,kind/type/members),types.ts,executable/index.ts,readable.ts(boot 必需),index.ts,self.md}` + 核心 5 处：`object-registry.ts` BASE_TYPE_DEFINITIONS seed（tool-object `parentClass:null`；`_builtin/` 类 boot 校验已跳过）+ RENDERABLE_VISIBLE_TYPES + `xml.ts` BUILTIN_TYPES + `_shared/types.ts` union + `extendable/index.ts` import + **手动 `ln -s` node_modules/@ooc/builtins/<name>**（避 bnpm hang）。
- **成员方法壳要忠实**：保留 onFormChange 的 refine-hint tip + 粒度 intents（refine-hint.test + 知识激活依赖）；壳独立声明（不 import root 方法文件）断 root barrel TDZ 循环；exec 走 `makeRootDelegator(constructorKind)` 或直调 persistable（world）。
- **激活键走类链**：`method::<type>::<m>` 经 `resolveParentClassChain` 匹配 parent 自身或祖先（`activator.expr.ts`）。agency 跑在 self 窗（class=objectId）→ 链含 `_builtin/agent`/root → 用 `method::_builtin/agent::*`；create_object 跑在 world 窗（parentClass=null）→ 用 `method::world::create_object`（精确）。
- **测试 reframe 套路**：`openMethodExec({parentWindowId:"root",method})` → agency 经 self 窗（`class:"_builtin/agent"` as unknown as ContextWindow）/ 工具经成员窗（filesystem/terminal/world/knowledge_base）；`makeThread({extraWindows:[...]})` 注入对应窗。
- **真实 world**：`set -a && . ./.env && set +a && NO_PROXY=localhost,127.0.0.1 bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world`（.env 自带 OOC_API_KEY/claude-opus-4-8，port 3000）；Tier B：`RUN_STORYBOOK_AGENT=1 OOC_BACKEND=http://127.0.0.1:3000` 跑 class story runAgentNative；session 用 `sb-an-`/`_test_` 前缀验后清 `.ooc-world/flows/`；Clash 全程 `NO_PROXY+--noproxy '*'`。
- **记忆**：进度 `[[project_composition_increments]]`；勿过度机制化 `[[feedback_ooc_simplicity_emergence]]`；e2e 假阳 `[[feedback_e2e_false_positive_root_cause]]`；退役符号回流 `[[feedback_deprecated_symbol_doc_drift]]`。
