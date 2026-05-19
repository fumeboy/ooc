/**
 * meta/doc-types — meta 文档树的通用类型基底。
 *
 * 设计目标：让每篇 `.doc.ts` 在文件顶部用类型块勾勒"概念骨架"——
 * 打开文件第一屏即能看到这个概念由哪几块组成、哪些是不变量、哪些跨概念引用了谁。
 *
 * 与 `meta/__tests__/concept-links.test.ts` 的 `ConceptShape` 兼容：
 * 任何用 {@link Concept} 标注的对象都满足 `name + description + sources` 三件套。
 *
 * 详见 docs/plans/2026-05-18-001-refactor-meta-doc-typescript-plan.md。
 */

/**
 * 任意文档节点的基底——title 必填，其余可选。
 *
 * - `summary`：用于派生 TOC；父节点不再手写"按子字段展开"列表
 * - `content`：节点正文（markdown 字符串）；纯结构性父节点可省略
 */
export type DocNode = {
  title: string;
  summary?: string;
  content?: string;
};

/**
 * 不变量节点：编译器强制要求 rationale。
 *
 * 把 "如果不这样会怎样" 从 content 段落里抽出为一等字段，让：
 * - 渲染层可以给"不变量"加专属徽章 / 锚点
 * - `findAll(node => node.kind === "invariant")` 能整理出系统硬约束清单
 * - 未来想改这条边界的人能精准看到设计原因，避免误改
 */
export type InvariantNode = DocNode & {
  kind: "invariant";
  /** 设计原因——如果不这样会怎样 */
  rationale: string;
};

/**
 * 示例节点：伪代码 / 表格 / ASCII 图。
 * 与不变量平行的"语义类型"标记，便于渲染层差异化处理。
 */
export type ExampleNode = DocNode & {
  kind: "example";
};

/**
 * 跨概念引用：用类型而不是字符串。
 *
 * 重命名 / 移动文件后 TS 立即报错——比 "详见 thinkable.context.fields.contact"
 * 这种字符串路径强一个量级。值可以是另一个概念顶层，也可以是某个子节点。
 */
export type Refs = Record<string, DocNode | Concept>;

/**
 * 概念顶层 export 的基底。
 *
 * 严格满足 `concept-links.test.ts` 的 `ConceptShape`：
 * 任何按 `Concept` 标注的对象天然通过 regression 测试。
 *
 * `parent` 推荐写法：getter 形式 `get parent() { return X; }`——绕开 ESM
 * 循环依赖；配合测试 walker 的 `SKIP_KEYS={parent,sources}` 去重，避免无限
 * 递归。类型故意宽松为 `unknown`：parent 经常指向 aggregator（无 name/
 * description/sources 三件套，不是合规 Concept），强类型会持续打架。
 */
export type Concept = {
  name: string;
  description: string;
  sources: Record<string, unknown>;
  readonly parent?: unknown;
  refs?: Refs;
};
