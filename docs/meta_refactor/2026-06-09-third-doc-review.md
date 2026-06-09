# 第三轮文档检查报告（.ooc-world-meta 对象树）

> 2026-06-09。storybook 提级（`packages/@ooc/meta/storybook` → `packages/@ooc/storybook`）+ 删除 `@ooc/meta` 包之后，
> 对对象树做的一轮矛盾 / 不清楚 / 信息冗余检查。4 个并行只读评审 sub-agent 分片审查，本文档为综合去重后的结论。
> 判定基准：**代码=唯一真相**，断言锚 `packages/@ooc/.../*.ts:行号`。

## 🔴 Critical 矛盾（硬错 / 会误导，多为已知重命名 / 退役的传播尾巴）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| C1 | 维度数 8↔9 全树漂移：`children/app/self.md`、`children/thinkable/knowledge/tests.md`、`children/class/knowledge/tests.md` + `class-chain-knowledge-inheritance.md` | 残留「8 维度」。**根因在代码**：builtin seed `packages/@ooc/builtins/supervisor/knowledge/eight-dimensions.md`（文件名 + 内容仍 8 维），class 测试忠实镜像了它 | 改 builtin seed 为 9 维（含文件名）→ 同步 class-chain / tests 断言 + storybook L9 TC-CLASS-03 → 清各处「8 维度」。**触代码 + 测试** |
| C2 | executable metaprog 幽灵：`children/executable/self.md`、`knowledge/root-methods-and-forms.md` | 把已删的 `metaprog` 当现存 method、数 17（实为 16）、锚不存在的 `method.metaprog.ts` | 删 metaprog 描述、17→16，resolve/rollback 重锚到 governance 端点 |
| C3 | persistable pool 路径：`children/persistable/self.md`、`knowledge/stone-pool-flow-three-trees.md`、`session-worktree-model.md` | 写 `pools/objects/<id>/`、`pools/repos/<name>/`；实测 canonical 是 `pools/<id>/`（`pool-object.ts:54`） | 全改 `pools/<id>/`；`pools/repos/` 标未实现或删 |
| C4 | tests.md 失效锚：reflectable / programmable / visible / persistable / class 等 `knowledge/tests.md` | 引 `packages/@ooc/storybook/specs/capability_*.md` + `playbooks/*.playbook.md`——Phase 3 已删、specs 早收编进 tests.md 自身 | 改「规格已就地收编进本 tests.md，story 代码在 `packages/@ooc/storybook/stories/`」 |
| C5 | programmable tests.md 旧字段：`tests.md` `window.commands` /「命令表」 | command→method 重命名尾巴；`commands` 导出会触发硬切抛错 | `window.methods`、「方法 / object method」 |
| C6 | engineering-harness `meta/*.doc.ts`：supervisor `knowledge/engineering-harness.md` | 仍指 Supervisor 把设计写进已删的 `meta/*.doc.ts`，与 self.md「设计活在对象树」直接打架 | 改指对象树 self.md / knowledge |

## 🟡 Medium 矛盾

- **C7** `children/collaborable/knowledge/cross-object-talk.md` — `talk_window.say` 称「window method」实为 object method（`ObjectMethod`），术语自相矛盾 → 改「object method」
- **C8** `children/visible/readable.md` —「自我塑造四件套（含 readable/visible）」与 self.md「自我塑造 2 + 外观 2」冲突 → 改外观组
- **C9** `children/reflectable/readable.md` —「在 super 线程写身份文件」与 self.md 职责切分（身份改在业务 session、super 只沉淀 + 合入）不一致
- **C10** reflectable constants.ts 锚 +1 偏移：`self.md` / `super-flow.md` 写 `:12/:15/:18`，实际 `:11/:14/:17`
- **C11** frontmatter 旧格式 `window::root`：executable(5) + collaborable(4) = 9 文件，应迁 `object::root`（thinkable 自定的偏好）
- **C12** engineering-harness `stones/agent_of_X/` 缺 `objects/` 段 + 「9 AgentOfX vs 11 children」口径未厘清（app/class 归属）

## ⚪ 不清楚（7 处）

- thinkable `context-construction.md` synthesizer 函数命名与职责对不上
- persistable `versioning-layout-and-registry.md` canonical（flat vs versioned）歧义
- readable `two-faces-of-readable.md` 回退档数 4↔5 不一
- programmable `tests.md` TC-PROG-01 ui_methods 归属（self 说归 visible）
- visible `inline-ui-tokens.md`「user readme」未限定 + 复活 readme 旧词
- readable `tests.md`「第 9 维度」序数歧义
- class `self.md` `ooc.kind` vs `ooc.class` 未在名词解释区分

## 🔵 冗余（缺 single-source，定权威 + 改引用）

- supervisor `self.md:18/20` 外观维度定义双写
- **persistable self.md 最长**：session-worktree 三态在 self.md / readable.md / session-worktree-model.md 四处近全文重复
- executable permission 三档在 self.md 与 knowledge/permission.md 重复
- reflectable resolve/rollback 治理端点在 self.md / super-flow.md / evolve-self.md 三处重复
- readable two-faces 优先级链在 self.md / two-faces-of-readable.md / readable.md 三处重复
- **root 级术语**（ContextObject / seed-sediment / extendable / PR-Issue）在 ≥4 个对象 self.md 名词解释段各写全文——`ooc-glossary.md` 已是权威但未被引用收口

## 正面确认

`@ooc/meta` / `meta/storybook` / `B-tree` / `window command` 旧称 / `Issue 多对象看板复活` 等**均无残留**；
维度判定轴（self-constitutive）、对象关系三轴、class 一等继承、prototype 剔除、metaprog→governance 在各对象间高度自洽；
锚点命中率普遍很高（readable / visible / persistable worktree 锚点几乎全部精确命中）。

## 处置

用户拍板「一次性全修」（C1 含 builtin seed 8→9 + 测试；C2–C12 + 不清楚 + 冗余收敛）。
执行记录见同目录后续 commit。
