# meta 文档类型化重构 plan

> **状态**：✅ 完成（2026-05-18 当天，9 个并行 agent + Phase 2 收尾）
> **范围**：`meta/**/*.doc.js` 全量迁移到 `.doc.ts`（73 个文件，0 残留）
> **试点**：`meta/object/thinkable/context/index.doc.js` → 已扩展到全树

## 完成清单

- ✅ `meta/doc-types.ts`：通用类型基底（DocNode / InvariantNode / ExampleNode / Concept / Refs）
- ✅ `meta/**/*.doc.js` 全部迁移为 `.doc.ts`（0 残留）
- ✅ tsconfig 加 `allowJs: true` + `meta/**/*.ts` 入 include
- ✅ walker `SKIP_KEYS` 加 `refs`（防 refs binding 在精确路径断言里重复发现）
- ✅ regression：`bun test meta/__tests__/concept-links.test.ts` → **20 pass / 997 expect**（迁移前 681）
- ✅ tsc：9 行错误 = baseline（全部 src/app/server/modules/ui pre-existing）

## Phase 1 产出汇总（9 agents 并行）

| 子树 | 文件 | 删占位 | 抽 invariant | refs binding |
|---|---:|---:|---:|---:|
| thinkable | 8 | 45 | 42 | 3 |
| executable/commands | 12 | ~20 | 0 | 11 |
| executable/tools | 8 | ~10 | 1 | 7 |
| executable/concepts | 7 | ~15 | 0 | 0 |
| executable/windows | 7 | ~10 | 0 | 0 |
| observable | 4 | ~10 | 12 | 0 |
| collaborable | 10 | ~15 | 2 | 0 |
| engineering | 5 | ~10 | 8 | 0 |
| app + persistable/reflectable/extendable | 7 | ~15 | 2 | 0 |
| **合计** | **68** | **~150** | **67** | **21** |

## Phase 2 产出（主对话收尾）

- `executable/client/index.doc.ts`（1 个 InvariantNode 抽出：无）
- `executable/server/index.doc.ts`（1 个 InvariantNode：mtimeReload）
- `executable/index.doc.ts`（aggregator 类型化）
- `object/index.doc.ts`（DocNode 形态）
- `meta/index.doc.ts`（顶层聚合，含 object_tree + meta 两个 export）

## 迁移过程发现的几个真问题

1. **`parent` 必须是 getter 不是函数** —— 现有 `.doc.js` 体系一直用 `get parent() { return X; }` getter；类型定义需要兼容（`readonly parent?: unknown`），否则 .ts 化时 `parent: () => X` 会与 .js 端不一致
2. **`parent` 指向常常不是合规 Concept** —— parent 经常是 aggregator（无 name/description/sources），强类型 `parent: Concept` 会持续打架；用 `unknown` 是务实选择
3. **walker 必须 skip `refs`** —— `SKIP_KEYS` 原本只有 `parent` / `sources`，refs binding 指向同子树概念会让其被重复发现，破坏精确路径断言（engineering 子树命中）
4. **`title` / `content` / `description` 是字段名冲突源** —— 现有 `.doc.js` 里有 `commonFields.title`、`write-file.content` 这类业务字段名，与 DocNode 的 title/content 冲突；迁移时按需 rename（`titleField` / `contentParam`），title 字符串保留为展示文本

## 后续可考虑（不在本 plan 范围）

- 写一个工具从 .ts 类型块的 JSDoc 注释自动提取 summary（目前 summary 是手写字段，与 JSDoc 双轨）
- 把表格 / 状态机数据从 markdown 字符串结构化为 `{ kind: "table", columns, rows }`（trade-off：低摩擦 vs 工具可消费，目前选低摩擦）
- 把 `tsconfig.include` 里残留的 `"meta/**/*.js"` 清掉（当前匹配 0 文件，无害但语义已陈旧）

---

## 1. 目标

把现有 `meta/**/*.doc.js` 文档体系升级为：

- **`.doc.ts`**：在文件顶部用 TypeScript 类型块勾勒概念骨架——打开文件第一屏 30 秒内能看到这个概念有哪些子结构、彼此关系、哪些是不变量、哪些跨概念引用了谁
- 数据填充写在类型块下方，由编译器强制"字段不漏、不变量必带 rationale、跨概念引用静态可发现"

**不**做的事：

- 不改变现有 `concept-links.test.ts` regression 测试的判定规则（仍以 `name + description + sources` 三件套作为"概念"判定）
- 不强行把表格、伪代码、ASCII 图结构化（保留 markdown 字符串以维护写作低摩擦）
- 不一次性迁移所有文件——任何时刻 `.js` / `.ts` 共存合法

---

## 2. 既有约束（不能破坏）

1. **`concept-links.test.ts` 三件套**：每个概念对象必须有 `name: string`、`description: string`、`sources: Record<string, ModuleNamespace>`（非空）
2. **`get parent()` 反向链路**：用 lazy getter 绕开 ESM 循环依赖；walker 已用 `WeakSet` + `SKIP_KEYS={parent,sources}` 去重
3. **跨文件 import 路径**：现有 `.doc.js` 之间通过 `@meta/object/.../*.doc` 互相 import，迁移后不能让 import 路径失效
4. **`title`、`content` 字段是公开渲染契约**：web 端 `MainPanel.tsx` / `ContextSnapshotViewer.tsx` 可能消费它们；不能改字段名，只能加新字段

---

## 3. 类型设计

放在新文件 `meta/doc-types.ts`：

```ts
/** 任意文档节点的基底——title 必填，其余可选 */
export type DocNode = {
  title: string;
  /** 用于派生 TOC；父节点不再手写"按子字段展开"列表 */
  summary?: string;
  content?: string;
};

/** 不变量节点：编译器强制要求 rationale */
export type InvariantNode = DocNode & {
  kind: "invariant";
  /** 设计原因——如果不这样会怎样 */
  rationale: string;
};

/** 示例节点：伪代码 / 表格 / ASCII 图 */
export type ExampleNode = DocNode & {
  kind: "example";
};

/**
 * 概念顶层 export 的基底。保持与 concept-links.test.ts 的 ConceptShape 兼容：
 * name + description + sources 三件套。新增字段（parent / refs / ...）。
 */
export type Concept = {
  name: string;
  description: string;
  sources: Record<string, unknown>;
  parent?: () => Concept;
  refs?: Refs;
};

/** 跨概念引用：用类型而不是字符串，重命名/移动文件静态可发现 */
export type Refs = Record<string, DocNode | Concept>;
```

**关键设计选择**：

- `Concept` 严格满足现有 `ConceptShape` —— 任何按 Concept 标注的对象都能通过 regression 测试
- `kind` 是辨别联合字段；未来可加 `"rationale"` / `"table"` 等
- `summary` 是可选的——首批迁移不强求每个节点都加；存量节点保持 `{ title, content }` 形态向后兼容
- `refs` 是 `DocNode | Concept` 联合——既能指向某个概念，也能指向概念里的某个子节点

---

## 4. 改造规则（应用到每个迁移的文件）

按收益从大到小排序，逐条应用：

### R1. 删除"详见子节点"占位 content
父级节点的 content 如果只是"详见子节点：..."、"分子节点："、"详见两个独立子节点"——一律删除。这类信息隐含在子节点 title 序列里，渲染层自动列 TOC。

### R2. 顶层 description 删去手写"按子字段展开"列表
原本：
```js
description: `...\n按子字段展开：\n- foo — xxx\n- bar — yyy`
```
改为：
```js
description: `...只保留概念叙述`
foo: { title: "...", summary: "xxx", ... }
bar: { title: "...", summary: "yyy", ... }
```
TOC 由渲染层从子节点 `summary` 派生。

### R3. 不变量节点用 `kind: "invariant"` + 独立 `rationale`
原本：
```js
title: "不变量：XX 必须 YY",
content: `规则正文 ...\n\n设计原因：如果不这样会 ZZ`
```
改为：
```js
{
  kind: "invariant",
  title: "XX 必须 YY",   // ← title 不再含"不变量："前缀
  content: "规则正文 ...",
  rationale: "如果不这样会 ZZ",
}
```

### R4. 跨概念字符串路径引用改 `refs` binding
原本：
```js
content: `... 详见 thinkable.identity.outerReadme ...`
```
改为：
```js
import { identity_v20260505_1 } from "@meta/object/thinkable/identity.doc";

content: `... 详见 outerReadme ...`,
refs: { outerReadme: identity_v20260505_1.outerReadme },
```
被引用的子字段需要在父概念里**作为可访问属性存在**（已经是，因为概念字面量是普通对象）。

### R5. title 命名风格统一
- 顶层概念字段（如 `name: "Context"`）：保持英文 PascalCase
- 子节点 title：短中文短语 + 必要时英文 / 代码括注
- 不再用"不变量：..." 前缀（kind 字段承担）

### R6. 嵌套深度预算
默认最多 3 层（概念 → 章节 → invariant/rationale/example）。超过 4 层考虑：
- 把孙节点提升为兄弟（横向展开）
- 折叠为父节点 content 列表
- 拆成独立 .doc.ts 文件（升级为子概念）

---

## 5. 命名 & 风格约定

- **顶层 export**：`<snake_concept_name>_v<YYYYMMDD>_<N>`，与现有规约一致
- **子字段 key**：camelCase 英文语义键，**不带版本号**（已在前面 commits 完成）
- **类型命名**：`<PascalConcept>Concept`，与 export 配对（例：`ContextConcept` / `context_v20260505_1`）
- **JSDoc 注释**：放在类型字段旁，作为"目录页"的注释来源；与 `summary` 字段允许并存（数据 `summary` 优先，类型注释作为兜底）
- **`parent` getter**：保留 `parent: () => parent_v...` 写法；type import 用 `import type` 避免循环

---

## 6. 试点：`context/index.doc.ts`

试点文件选 `meta/object/thinkable/context/index.doc.js`，理由：
- 中等规模（470 行），既能展示类型块价值又不至于改造爆炸
- 内部有 12 字段表、3 条 specialReductions、2 层 + 不变量的 llmInput——把"不变量抽取"、"refs binding"、"删占位"、"summary 派生 TOC" **四条规则全用一遍**，对其余文件的迁移有完整参考价值
- 是其他文件的高频被引用方（identity / thread / scheduler 都引用 thinkable.context.* 字符串路径）——一次迁移后可以从被引用端起点开始替换字符串引用

试点完成的判定标准：
1. `bun test meta/__tests__/concept-links.test.ts` 全绿
2. `bunx tsc --noEmit` 不报错
3. 顶部类型块 30 行内能读完整个概念骨架
4. 文件总行数与改造前相当或更短（不应该因为加类型反而变臃肿）

---

## 7. 后续阶段（不在本 plan 范围）

试点成功后：
- 把 thinkable/ 下其余 6 个 doc 文件（identity / llm / knowledge / thread / scheduler / thinkloop）按相同规则迁移
- 跨概念引用全部走 refs binding
- 写一个小工具从类型 JSDoc 提取注释生成"目录页"渲染
- 评估是否引入 `fieldGroups` 等结构化数据（trade-off：低摩擦 vs 工具可消费）

---

## 8. 风险与回滚

- **风险**：tsconfig include 扩展到 `.ts` 后，meta/ 下的现有 .js 文件依然要继续工作（已验证：`allowJs` 默认 + `noEmit: true`，混合模式安全）
- **回滚**：试点 .ts 文件可以一键 `git revert`；类型文件 `doc-types.ts` 独立存在不影响其他 .js 文件
