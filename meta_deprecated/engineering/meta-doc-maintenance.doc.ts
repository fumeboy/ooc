import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";
import * as executableMeta from "@meta/object/executable/index.doc";
import * as contextWindowConcept from "@meta/object/executable/concepts/context-window.doc";

/* ────────────────────────────────────────────────────────────────
 *  目录页：meta 文档维护规范骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * MetaDocMaintenance 概念：meta 概念图的日常维护规范。
 *
 * - meta/**\/*.doc.{js,ts} 是 OOC 的"概念图"
 * - 概念对象通过 `sources: Record<string, ModuleNamespace>` 用代码级 import 锁定源码
 * - `bun tsc --noEmit` 守 import 失败；`bun test meta/__tests__/concept-links.test.ts` 守 schema 完整
 *
 * sources:
 *  - executableMeta — 已完整迁移到概念图的参考聚合层
 *  - contextWindowConcept — 单概念文件的参考形态
 */
export type MetaDocMaintenanceConcept = Concept & {
  sources: {
    executableMeta: typeof executableMeta;
    contextWindowConcept: typeof contextWindowConcept;
  };

  /** 维护对象：meta 文件树与走查工具 */
  scope: DocNode;

  /** Concept Schema（强约束）三件套 + 判定规则 */
  conceptSchema: {
    title: string;
    summary?: string;
    /** 三件套 + getter parent 的 export 形态 */
    requiredShape: ExampleNode;
    /** name + description + sources 三件套同时具备即识别为概念 */
    threeTrioRule: InvariantNode;
  };

  /** sources 字段规则 */
  sourcesRules: {
    title: string;
    summary?: string;
    /** 必须是 `import * as ns` 的模块命名空间 */
    namespaceOnly: InvariantNode;
    /** 反例：字符串路径 / 单 symbol */
    antiPatterns: ExampleNode;
    /** key 命名约束 + 多 module 全部纳入 + 非空 */
    keyConstraints: DocNode;
    /** 允许的非 @src 来源（极少情况） */
    nonSrcException: DocNode;
  };

  /** 概念内部的树形分解（强约束） */
  treeDecomposition: {
    title: string;
    summary?: string;
    /** ≥3 个并列子点必须拆出具名子字段 */
    threeOrMoreTrigger: InvariantNode;
    /** 树形分解后的形态示例 */
    shape: ExampleNode;
    /** 字段命名 / 最小形态 / 升级为完整概念 / 可继续嵌套 */
    rules: DocNode;
  };

  /** 时态中性：去除任务过程性表述（强约束） */
  tenseNeutrality: {
    title: string;
    summary?: string;
    /** description 中禁止过程性表述 */
    forbidden: InvariantNode;
    /** 反例对照表 */
    examples: ExampleNode;
    /** 允许的引用（源码 / 同 meta / convention） */
    allowedRefs: DocNode;
    /** 任务过程性内容应当沉淀去哪 */
    sinkDestination: DocNode;
    /** 改写自检三问 */
    selfCheck: DocNode;
  };

  /** 命名与版本规则 */
  naming: {
    title: string;
    summary?: string;
    /** 变量名：<snake>_v<YYYYMMDD>_<n> */
    variableName: DocNode;
    /** name 字段：PascalCase 无下划线 */
    nameField: DocNode;
    /** 子字段名：承载语义即可，允许中文 */
    subFieldName: DocNode;
  };

  /** 文件布局：复杂度驱动 */
  fileLayout: {
    title: string;
    summary?: string;
    /** 模块复杂度 → 布局选择对照表 */
    decisionTable: ExampleNode;
    /** 聚合层必须 import 子概念并 concepts: {...} 暴露 */
    aggregatorMustExpose: InvariantNode;
  };

  /** 日常操作流程 */
  dailyOps: {
    title: string;
    summary?: string;
    /** 新增概念 5 步流程 */
    addConcept: DocNode;
    /** 源码改名 / 删除 / 拆分时的处理路径 */
    sourceRename: DocNode;
    /** 改写 description 的触发条件与复核要点 */
    rewriteDescription: DocNode;
    /** 将旧 blob 模块迁移到概念图的步骤 */
    migrateBlobModule: DocNode;
  };

  /** 验证门禁：两道闸 */
  verificationGate: {
    title: string;
    summary?: string;
    /** tsc + bun test 双闸 */
    twinGates: InvariantNode;
    /** 机器闸不覆盖的人工复核项 */
    humanReviewItems: DocNode;
  };

  /** 与重构治理的接口 */
  refactoringInterface: DocNode;

  /** 何时不必走概念图 */
  whenNotInGraph: DocNode;

  /** 一次维护是否合格：7 个自检问题 */
  successCriteria: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const meta_doc_maintenance_v20260517_1: MetaDocMaintenanceConcept = {
  name: "MetaDocMaintenance",
  get parent() {
    return engineering_v20260506_1;
  },
  sources: { executableMeta, contextWindowConcept },
  description: `
meta 文档维护规范。

本文件沉淀 OOC 在 meta/ 树上的长期维护约束，按它所规定的 schema 写成，是
规范的活样本——读完后看本文件源码即可获得最直观的形态参考。

历史 WHY 与 brainstorm/plan 出处：
- docs/brainstorms/2026-05-15-meta-concept-graph-requirements.md
- docs/plans/2026-05-15-001-refactor-meta-concept-graph-executable-plan.md
- docs/solutions/conventions/meta-concept-graph-2026-05-15.md（含首次迁移的 field notes）

本文件聚焦"日常如何维护"，不重复 WHY。
`.trim(),

  scope: {
    title: "维护对象",
    summary: "meta 文件树 + walker 工具的覆盖范围",
    content: `
\`meta/**/*.doc.{js,ts}\` —— 每个文件 export 一个或多个"具名概念对象"。

\`meta/__tests__/\` —— 走查工具：

- \`walk-concepts.ts\`：递归遍历 meta 树，识别概念
- \`concept-links.test.ts\`：bun test 时校验所有概念满足 schema

非 doc 文件、非 doc-export 形态的对象不被走查工具识别，也不在本规范覆盖范围内。
    `.trim(),
  },

  conceptSchema: {
    title: "Concept Schema",
    summary: "三件套 + getter parent 的强约束 export 形态",

    requiredShape: {
      kind: "example",
      title: "export 形态",
      content: `
\`\`\`ts
export const <snake_concept_name>_v<YYYYMMDD>_<n> = {
  name: "PascalCaseName",          // 必填：人类可读标签
  description: "...",              // 必填：多行 markdown，承载概念语义
  sources: { foo, bar },           // 必填：Record<string, ModuleNamespace>，至少一个键
  get parent() { return ...; },    // 可选：回链上层聚合器，必须是 getter（破循环初始化）
};
\`\`\`
      `.trim(),
    },

    threeTrioRule: {
      kind: "invariant",
      title: "name + description + sources 三件套同时具备 = 概念",
      summary: "判定规则——少一件即不被识别为概念",
      content: `
同一对象上**同时**具备 \`name: string\` + \`description: string\` +
\`sources: object\` 三件套即被走查识别为概念。

聚合层（如 \`object_tree_v...\`）只有 description / 子字段、没有 name，不会
被误判为概念，但其子字段仍会被递归。
      `.trim(),
      rationale:
        "三件套是 walker 唯一识别信号；少一件就不算概念，避免聚合器 / 内部分组节点被误识别成顶级概念。",
    },
  },

  sourcesRules: {
    title: "sources 规则",
    summary: "Record<string, ModuleNamespace>，每值是 `import * as ns`",

    namespaceOnly: {
      kind: "invariant",
      title: "每个 value 必须是 `import * as ns` 的命名空间",
      summary: "字符串路径与单 symbol 均不允许",
      content: `
\`\`\`ts
// ✅ 正确：tsc 守住 import 路径，源码改名/删除立即报错
import * as types from "@src/executable/windows/types";
import * as windows from "@src/executable/windows/index";

sources: { types, windows }
\`\`\`
      `.trim(),
      rationale:
        "用 namespace 而非字符串路径，tsc 才能在源码改名/删除时立即报错；这是把文档同步从纪律升级到机器闸的基石。",
    },

    antiPatterns: {
      kind: "example",
      title: "反例",
      content: `
\`\`\`ts
// ❌ 错误：字符串路径，tsc 无法校验
sources: { types: "src/executable/windows/types" }

// ❌ 错误：单 symbol 而非整个 namespace；脆弱且失去"该概念在此 module 表达"的语义
sources: { ContextWindow }
\`\`\`
      `.trim(),
    },

    keyConstraints: {
      title: "key 命名与多 module 纳入",
      content: `
- key 必须承载语义（"该概念在 windows 这个 module 表达"），不要写成 \`{ a, b }\`
- 一个概念若映射到多个 module（如 talk-window ← talk + talk-delivery），全部纳入
- 不允许空 Record；\`sources: {}\` 会让 concept-links.test.ts 失败
      `.trim(),
    },

    nonSrcException: {
      title: "允许的非 @src 来源",
      content: `
极少情况下，概念描述的就是 meta 自身的形态（如本文件），可以引 \`@meta/...\`
作为参考样本。这是例外，默认情况下 sources 指向 \`@src\`。
      `.trim(),
    },
  },

  treeDecomposition: {
    title: "概念内部的树形分解",
    summary: "≥3 个并列子点必须拆出具名子字段",

    threeOrMoreTrigger: {
      kind: "invariant",
      title: "≥3 并列子点 = 必须拆出具名子字段",
      summary: "description 内部出现 ≥3 个并列子设计 / 子定义 / 子字段即拆分",
      content: `
当一个概念的 description 包含 ≥3 个并列子设计 / 子定义 / 子字段时，**必须**
按"对象树"形式拆出具名子字段，让每个子点都能被路径精确定位（例如
\`context_v20260505_1.self\`、\`context_v20260505_1.组成\`），而不是只能 grep
大段文本。
      `.trim(),
      rationale: `
每个设计点拥有一个稳定的具名路径，可在 brainstorm / commit / LLM context
selector / 未来 docs 索引中作为最小可引用单元出现，而不是只能贴大段文本。
      `.trim(),
    },

    shape: {
      kind: "example",
      title: "树形分解后的形态",
      content: `
\`\`\`ts
export const context_v20260505_1 = {
  name: "Context",
  get parent() { return thinkable_v...; },
  sources: { context: contextSource },
  description: "Context 是 Object 每次思考时看到的全部信息。",  // 一句话总览

  组成: { title: "ThreadContext 顶层字段表与组成图", ... },
  self: { title: "self 字段的语义、来源、内容范围", ... },
  knowledge: { title: "knowledge 字段的激活规则与特例", ... },
  creator: { title: "creator 字段的取值规则与用途", ... },
  contextWindows: { title: "形态、window 类型枚举、生命周期", ... },
  llmInput: { title: "LLM 输入的两层拆分", ... },
};
\`\`\`
      `.trim(),
    },

    rules: {
      title: "树形分解规则",
      content: `
- **字段名**：承载语义；允许中文（"组成"、"字段语义"、"渲染"、"生命周期"）；
  优先复用概念已有术语；避免 \`part1\` / \`subA\` 之类无信息名
- **子字段最小形态**：\`{ title, content }\` —— 只承载该子点的文本块，不参与
  schema 检测
- **升级为完整概念**：若某子点本身有明确的源码绑定与对外引用价值，升级为
  \`{ name, description, sources }\` 的完整概念形态，纳入 walker 走查
- **不复读**：顶层 description 写最短一句话总览；细节全部下放到子字段，避免
  父子重复
- **可继续嵌套**：子字段内部若再次出现 ≥3 个并列点，按同样规则继续拆
      `.trim(),
    },
  },

  tenseNeutrality: {
    title: "时态中性",
    summary: "description 描述项目当前形态，不是演化路径",

    forbidden: {
      kind: "invariant",
      title: "description 禁止出现任务过程性表述",
      summary: "Step / 旧 / 替代了 / 重构前后 / 任务日期回指 一律删除",
      content: `
meta 描述"项目当前长什么样"，不是"如何演化到这里"。description 中**禁止**
出现"Step N（spec 日期）"、"旧 X / 之前 / 替代旧 Y"、"重构前 / 重构后"、
"详见 spec docs/.../...md"、"当前 step 1 范围下的 ..." 等任务时态语言。
      `.trim(),
      rationale: `
若一句话只对参与过那次迁移的人有意义，对新读者就是无价值的考古层；meta 必须
对"今天第一次读项目"的读者完整自洽。过程性内容沉淀到 brainstorm / plan /
solution / git 历史，各自有更合适的载体。
      `.trim(),
    },

    examples: {
      kind: "example",
      title: "反例对照表",
      content: `
| 反例 | 性质 |
|---|---|
| "Step 1（spec 2026-05-14）后取代旧 X" | 任务里程碑回指 |
| "旧实现中 todo 是永远不 submit 的 form" | 历史对照 |
| "替代旧 activeForms / pinnedKnowledge 三套字段" | 已完成迁移痕迹 |
| "当前 step 1 范围下的 4 种 window" | 进行中工程范围限定 |
| "详见 spec docs/superpowers/specs/2026-05-14-...md" | 任务时间戳回指 |
| "重构前 / 重构后 / 之前我们..." | 时序对比 |
      `.trim(),
    },

    allowedRefs: {
      title: "允许保留的引用",
      content: `
- \`@src/...\` 源码路径与符号
- 同 meta 树内其它 concept 的具名路径（\`executable_v....concepts.contextWindow\`）
- \`docs/solutions/conventions/...\` 长期规范文档（其本身是结果性约束，不是过程）
      `.trim(),
    },

    sinkDestination: {
      title: "任务过程性内容沉淀去哪",
      content: `
- \`docs/brainstorms/\` — 当时的问题与选项
- \`docs/plans/\` — 当时的实施步骤
- \`docs/solutions/conventions/\` — 经验提炼为长期约束
- git 历史 — 演化轨迹本身
      `.trim(),
    },

    selfCheck: {
      title: "改写自检三问",
      content: `
每次写或改 description 自问：

1. 离开本次任务上下文，这句话还成立吗？
2. 是否在描述"现在是什么"，而不是"为什么是现在这样"？
3. 删掉"旧 / 之前 / Step N / 替代了 / 迁移自"之后，剩下的内容是否独立完整？

任一回答为否，改写。
      `.trim(),
    },
  },

  naming: {
    title: "命名与版本",
    summary: "变量名 / name 字段 / 子字段名 三套不同规则",

    variableName: {
      title: "变量名",
      content: `
\`<snake_concept_name>_v<YYYYMMDD>_<n>\`

- 沿用全仓既定形式（\`tools_v20260506_1\` / \`executable_v20260504_1\`）
- \`<n>\` 同一天内多次发布递增；不同天滚日期
- 概念实质重构 / 拆分 / 源码模块易主时滚版本
      `.trim(),
    },

    nameField: {
      title: "name 字段",
      content: `
PascalCase，无下划线（\`ContextWindow\` / \`TalkWindow\` / \`MetaDocMaintenance\`）

- 聚合器以**目录名**而非文件名命名：\`tools/index.doc.ts\` → \`Tools\`，而不是 \`Index\`
- 若用 codemod 从文件名派生 name，对 \`index.doc.{js,ts}\` 必须特殊处理（取
  父目录 basename）
      `.trim(),
    },

    subFieldName: {
      title: "子字段名（树形分解用）",
      content: `
承载语义即可，允许中文；不参与 schema 检测，所以不要求 PascalCase。
      `.trim(),
    },
  },

  fileLayout: {
    title: "文件布局",
    summary: "按复杂度选择平铺 / concepts 子目录 / 族群子目录",

    decisionTable: {
      kind: "example",
      title: "情形 → 布局对照表",
      content: `
| 情形 | 布局 |
|---|---|
| 模块有 ≥3 个独立概念 | 在该模块下建 \`concepts/\` 子目录，每个概念一个文件 |
| 模块有同一族群的多种 variant（如多种 window type） | 建以族群命名的子目录（\`windows/\`、\`actions/\`） |
| 模块只有 1-2 个概念 | 平铺在原位 |

参考样本：\`meta/object/executable/\` 已完整迁移，是本规范的活样本。
      `.trim(),
    },

    aggregatorMustExpose: {
      kind: "invariant",
      title: "聚合层必须 import 子概念并 concepts: {...} 暴露",
      summary: "否则子概念走不到 walkConcepts 视野，schema 测试形同虚设",
      content: `
聚合层（\`<module>/index.doc.{js,ts}\`）必须 import 子概念并通过
\`concepts: {...}\` 字段暴露。
      `.trim(),
      rationale:
        "走查工具从顶层概念深度优先遍历，子概念若不挂到 concepts 字段就不会被发现，schema 测试相当于跳过。",
    },
  },

  dailyOps: {
    title: "日常操作",
    summary: "新增 / 改名 / 改写描述 / 迁移旧 blob 四类高频路径",

    addConcept: {
      title: "新增概念（在已迁移模块内）",
      content: `
1. 在 \`<module>/concepts/<kebab-name>.doc.ts\` 写出概念对象（按 Concept Schema +
   内部树形分解）
2. 在 \`<module>/index.doc.ts\` import 它，挂到 \`concepts.<camelKey>\`
3. \`bun tsc --noEmit\`：确保 import 路径正确
4. \`bun test meta/__tests__/concept-links.test.ts\`：确保 schema 通过
5. 同一 commit 内提交源码改动 + 概念新增；避免半同步状态
      `.trim(),
    },

    sourceRename: {
      title: "源码改名 / 删除 / 拆分",
      content: `
- **改名**：tsc 在对应 .doc.ts 立即报错 → 改 import 路径
- **删除**：tsc 报错 → 决定是删 meta 概念还是把概念重新绑到替代 module
- **拆分**：tsc 不会自动报错（原 module 仍存在），但 description 与现实脱钩；
  人工同步 description 并在 sources 中补齐拆出的子 module

不允许的做法：注释掉 import / 把 sources 改回字符串 / 跳过 schema 测试。
任何"先合并、后补 meta"都是文档同步规范明令禁止的失同步状态。
      `.trim(),
    },

    rewriteDescription: {
      title: "改写 description",
      content: `
description 是与源码绑定的人类文字。修改触发条件：

- 源码语义变化（不只是改名/搬位）
- 概念引入新子概念或合并入另一概念
- 旧描述被实操证伪（如 brainstorm / commit 写出了更准确版本）
- 发现违反时态中性的过程性表述

不要为了"刷一下"做无源码触发的 description 改动；这会让概念图与源码节奏脱节。
改写时必须复核树形分解：若新增的子点让并列子设计达到 ≥3 个，立即拆出具名
子字段，而不是继续把段落堆在一个 description 里。
      `.trim(),
    },

    migrateBlobModule: {
      title: "将旧 blob 模块迁移到概念图",
      content: `
参考样本：executable 模块（首次完整迁移已落地，迁移过程见 convention doc
§Field notes）。

步骤摘要（详见 \`docs/solutions/conventions/meta-concept-graph-2026-05-15.md\` §Examples）：

1. 读旧 \`<module>/index.doc.{js,ts}\` 的 markdown blob，拆出独立设计概念
2. 每个概念建 \`<module>/concepts/<name>.doc.ts\`，按 schema 写、按树形分解
   组织内部、按时态中性清除过程性表述
3. 重写聚合层 \`<module>/index.doc.ts\`：import 全部子概念 → 通过
   \`concepts: {...}\` 暴露
4. 下游若读 \`.index\` 字段，临时保留 index 作为 description 的 getter 别名；
   下次清理时去除
5. 跑 \`bun tsc --noEmit && bun test meta/__tests__\` 全绿后提交
6. 命中过的 field notes（见上面 convention doc）逐条核查：name 派生不要落入
   Index 陷阱、walker 必须在真实树上跑一次、leaf 概念若需校验必须被聚合器
   enumerate
      `.trim(),
    },
  },

  verificationGate: {
    title: "验证门禁",
    summary: "两道闸 + 人工复核项",

    twinGates: {
      kind: "invariant",
      title: "每次 meta 改动都必须跑 tsc + bun test 两道闸",
      summary: "tsc 守 import 路径；bun test 守 schema 完整",
      content: `
1. \`bun tsc --noEmit\`：守 sources import 路径
2. \`bun test meta/__tests__/concept-links.test.ts\`：守 schema 完整 +
   抽样概念存活

两道闸都绿才能 commit。不允许"应该能过"代替结果。
      `.trim(),
      rationale: `
没跑 = 失同步无门禁。两道闸覆盖 meta 维护的核心机器可检测约束（import
解析 + schema 完整），任一缺失都让概念图退化为靠纪律维持。
      `.trim(),
    },

    humanReviewItems: {
      title: "人工复核项",
      content: `
机器闸不覆盖的人工复核项（树形分解 / 时态中性 都属于此类，必须靠 review 把关）：

- description 是否按树形分解规则拆出具名子字段、而不是继续堆段落
- description 是否清除了任务过程性表述

走查命令的范围会随模块迁移逐步扩展：迁移新根时要在
\`concept-links.test.ts\` 中追加对新根的 walkConcepts 断言。
      `.trim(),
    },
  },

  refactoringInterface: {
    title: "与重构治理的接口",
    summary: "把文档同步从纪律变成机器闸的接口落点",
    content: `
本规范是 refactoring-governance 文档同步规范的具体落地：

- 文档同步规范说"凡是改了目录结构 / 长期工程准则 / 对外心智模型 / 测试运行
  方式，都应同步文档"
- 本规范把"同步"从靠纪律变成靠机器：源码 import 守在 tsc，schema 守在 bun test
- 任何源码重构在本规范的语义下都顺带跑过一遍 meta 一致性检查；这是把文档
  同步嵌进重构闸的方式

约束反过来也成立：若一段源码无概念绑定（grep 全部 doc.{js,ts} 都没引到它），
说明它要么是私有实现细节（不属于概念图），要么是失同步遗漏（应补一个概念
绑定）。重构时遇到后者，按迁移旧 blob 步骤补齐。
    `.trim(),
  },

  whenNotInGraph: {
    title: "何时不必走概念图",
    summary: "私有 / 临时 / fixture 等不纳入概念图的内容",
    content: `
- 临时脚本 / 一次性 migration code
- 私有 helper（只被同 module 单点使用，没有跨模块意义）
- 测试 fixtures / mocks
- \`docs/\` 下的 brainstorm / plan / solution 文档（那是另一套体系，见
  \`docs/solutions/conventions/\`）

判断标准：这块代码代表的是不是一个"对外可被引用的设计点"。若是，纳入概念图；
若否，留在 src 即可。
    `.trim(),
  },

  successCriteria: {
    title: "一次维护是否合格",
    summary: "完成后应能回答的 7 个自检问题",
    content: `
1. 源码改动是否伴随对应概念的 sources / description 更新？
2. \`bun tsc --noEmit\` 与 \`bun test meta/__tests__\` 在提交前都跑过且全绿？
3. 新增概念是否通过 \`<module>/index.doc.{js,ts}\` 的 \`concepts.*\` 暴露
   （而不是孤悬）？
4. concept 文件是否一次产生而不是"先写空壳、后补内容"的失同步状态？
5. 命名是否遵循 \`<snake>_v<date>_<n>\` 与 PascalCaseName？
6. **description 内部是否按树形分解拆成具名子字段？还是仍然堆在一段大
   markdown 里？**
7. **description 是否清除了任务过程性表述（Step / 旧 / 替代 / 重构前后 / 任务
   日期回指）？**

任一回答为否，说明这次维护未完成。
    `.trim(),
  },
};
