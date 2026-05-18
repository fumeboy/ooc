import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as persistableIndex from "@src/persistable/index";
import * as persistableCommon from "@src/persistable/common";
import * as stoneObject from "@src/persistable/stone-object";
import * as stoneData from "@src/persistable/stone-data";
import * as stoneSelf from "@src/persistable/stone-self";
import * as stoneReadme from "@src/persistable/stone-readme";
import * as stoneServer from "@src/persistable/stone-server";
import * as flowObject from "@src/persistable/flow-object";
import * as threadJson from "@src/persistable/thread-json";
import * as debugFile from "@src/persistable/debug-file";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Persistable 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * Persistable 概念：Object 在文件系统中的完整持久化表达。
 *
 * sources（覆盖 src/persistable/ 全部主干文件）:
 *  - persistableIndex   — re-export 入口
 *  - persistableCommon  — 共享 path helper / FlowObjectRef / StoneObjectRef
 *  - stoneObject        — stones/{id}/ 目录骨架与 .stone.json
 *  - stoneData          — data.json 读写 + merge
 *  - stoneSelf          — self.md 读写
 *  - stoneReadme        — readme.md 读写
 *  - stoneServer        — stones/{id}/server/ 源码读写
 *  - flowObject         — flows/{sid}/objects/{id}/ 目录骨架与 .flow.json
 *  - threadJson         — threads/{tid}/thread.json 读写 + 反序列化兜底
 *  - debugFile          — debug/llm.input/output.json + loop_NNNN.* 落盘
 */
export type PersistableConcept = Concept & {
  sources: {
    persistableIndex: typeof persistableIndex;
    persistableCommon: typeof persistableCommon;
    stoneObject: typeof stoneObject;
    stoneData: typeof stoneData;
    stoneSelf: typeof stoneSelf;
    stoneReadme: typeof stoneReadme;
    stoneServer: typeof stoneServer;
    flowObject: typeof flowObject;
    threadJson: typeof threadJson;
    debugFile: typeof debugFile;
  };

  /** 目录 ≡ 对象的四条等价规则 */
  coreAssertion: {
    title: string;
    summary?: string;
    existsImpliesExists: DocNode;
    deletedImpliesDead: DocNode;
    copyImpliesMigrate: DocNode;
    fileEditImpliesAttrChange: DocNode;
  };

  /** 为何选文件系统而不是数据库 */
  whyFilesystem: {
    title: string;
    summary?: string;
    readableByHuman: DocNode;
    writableByObject: DocNode;
    referenceable: DocNode;
    archivable: DocNode;
  };

  /** Stone（静态） / Flow（动态）二元划分 */
  forms: {
    title: string;
    summary?: string;
    stoneForm: DocNode;
    flowForm: DocNode;
    composition: DocNode;
  };

  /** stones/{objectId}/ 目录骨架 */
  stoneLayout: ExampleNode;

  /** flows/{sid}/objects/{id}/ 目录骨架 */
  flowLayout: ExampleNode;

  /** debug 目录形态 + record schema 指针 + 控制平面指针 */
  debugLayout: {
    title: string;
    summary?: string;
    content?: string;
    recordSchemaPointer: DocNode;
    controlPlanePointer: DocNode;
  };

  /** Session 工作空间目录骨架 */
  session: ExampleNode;

  /** Session / Flow / Thread 三层概念粒度 */
  hierarchy: ExampleNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const persistable_v20260504_1: PersistableConcept = {
  name: "Persistable",
  get parent() {
    return object_v20260504_1;
  },
  sources: {
    persistableIndex,
    persistableCommon,
    stoneObject,
    stoneData,
    stoneSelf,
    stoneReadme,
    stoneServer,
    flowObject,
    threadJson,
    debugFile,
  },
  description: `
Persistable 描述 Object 如何在文件系统中存在。

OOC 的核心断言：**对象的持久化目录就是它的物理存在**。
  `.trim(),

  coreAssertion: {
    title: "目录 ≡ 对象的四条等价规则",
    summary: "每条规则对应一种 lifecycle 关系（exists / delete / copy / edit）",

    existsImpliesExists: {
      title: "目录存在 → 对象存在",
      content: `
判断"某对象在不在"等价于"对应目录在不在"。不需要查数据库 / 内存表。
      `.trim(),
    },

    deletedImpliesDead: {
      title: "目录被删除 → 对象消亡",
      content: `
\`rm -rf\` 对象目录就等于销毁对象。不需要额外的 destroy hook 或事务回滚。
      `.trim(),
    },

    copyImpliesMigrate: {
      title: "目录被复制 / 迁移 → 对象搬家",
      content: `
\`cp -r\` 或 \`mv\` 即完成对象级搬迁，不留 ID 链断裂。复制后两个目录就是两个对象。
      `.trim(),
    },

    fileEditImpliesAttrChange: {
      title: "修改目录里的文件 → 对象自身的属性 / 能力立即改变",
      content: `
不需要触发 reload——下次对象读 \`data.json\` / knowledge / server 时自然看到
新内容（mtime 缓存层例外，详见 \`extendable.kernel_extensions.activationModel\`）。
      `.trim(),
    },
  },

  whyFilesystem: {
    title: "为何文件系统而不是数据库",
    summary: "可读 / 可写 / 可引用 / 可归档 四条动机",

    readableByHuman: {
      title: "可读",
      content: `
人类能直接打开、查看、备份——不需要专门的 viewer 工具就可以审计对象的状态。
      `.trim(),
    },

    writableByObject: {
      title: "可写",
      content: `
对象可以通过 reflectable 通道修改自己的身份、数据、能力——文件系统天然支持
对象自我修改，而数据库需要额外的 mutation 抽象层。
      `.trim(),
    },

    referenceable: {
      title: "可引用",
      content: `
路径即地址，可被其他对象（或 LLM）引用——LLM 输出文件路径就是直接 actionable
的，不需要解析中间 ID。
      `.trim(),
    },

    archivable: {
      title: "可归档",
      content: `
目录能复制、删除、迁移——对象生命周期对应目录生命周期，没有"既有数据库行
又没有目录"或反过来的中间态。
      `.trim(),
    },
  },

  forms: {
    title: "Object 的两种形态",
    summary: "Stone（静态长期） / Flow（动态运行态）二元划分",

    stoneForm: {
      title: "Stone",
      content: `
路径 \`stones/{objectId}/\`。长期身份、数据、knowledge、memory——跨 Session 不变。
对象的"出生证 + 长期档案"。
      `.trim(),
    },

    flowForm: {
      title: "Flow",
      content: `
路径 \`flows/{sid}/objects/{objectId}/\`。在某个 session 的运行过程——session 结束
后仍保留在磁盘但不再活跃。Session 间互相独立。
      `.trim(),
    },

    composition: {
      title: "组合视图",
      content: `
同一对象的 Stone + 当前 session 的 Flow 共同组合为该 session 下的对象视图。
执行时合并优先级：**Flow 覆盖 Stone**（运行态优先于持久态）。
      `.trim(),
    },
  },

  stoneLayout: {
    kind: "example",
    title: "stones/{objectId}/ 目录骨架",
    summary: "Stone 全套目录与各文件语义",
    content: `
\`\`\`
stones/{objectId}/
├── .stone.json              配置 & 标识这是一个 stone 目录
├── self.md                  对象身份与自我说明（→ identity.innerSelf）
├── readme.md                对外介绍（→ identity.outerReadme）
├── data.json                Object 的属性与数据（顶层 merge 语义）
├── knowledge/               知识库根
│   ├── .knowledge.json      knowledge 配置（含外部引用映射）
│   ├── {dirName}/           多级子目录组织（无特别含义）
│   ├── **/*.md              知识文档（yaml frontmatter）
│   ├── memory/              跨任务保留的记忆
│   │   └── index.md         记忆索引页 + 最近记忆
│   └── relations/
│       └── {objectId}.md    和其他 Object 的关系文档
├── server/                  Object 的方法程序
│   └── index.ts             路由注册层（声明哪些函数 LLM 可见 / 前端可访问）
├── client/                  React UI 页面
│   └── index.tsx
├── files/                   其他文件
└── super/                   super 分身的 flow 通道（详见 reflectable）
\`\`\`

源码绑定见 sources 各 \`stone-*\` module。
    `.trim(),
  },

  flowLayout: {
    kind: "example",
    title: "flows/{sessionId}/objects/{objectId}/ 目录骨架",
    summary: "Flow 复用 Stone 结构，多一个 threads/ 层",
    content: `
\`\`\`
flows/{sessionId}/objects/{objectId}/
├── .flow.json               配置 & 标识这是一个 flow object 目录
├── ... 除了无 self.md，复用与 stone 一致的目录结构
└── threads/
    └── {threadId}/
        ├── thread.json      线程数据（详见 threadJson source）
        └── debug/           debug 输出（详见 debugLayout 子节点）
\`\`\`

flow object 自身没有 \`self.md\`（identity 来自 Stone 层）。其它子目录
（\`data.json\` / knowledge / server / client / files）与 Stone 同构，承载 session
内可变化的运行态数据。

源码：\`flowObject\` source（目录骨架）+ \`threadJson\` source（thread.json 读写）。
    `.trim(),
  },

  debugLayout: {
    title: "debug/ 目录形态",
    summary: "llm.input/output.json + loop_NNNN.{input,output,meta}.json",
    content: `
\`\`\`
threads/{threadId}/debug/
├── llm.input.json           最近一次请求 LLM 前的完整 inputItems + contextSnapshot
├── llm.output.json          最近一次 LLM 输出
└── loop_NNNN.{input,output,meta}.json
                             开启 debug 模式后按 4 位 zero-pad 文件名记录每一轮的
                             input / output / meta
\`\`\`
    `.trim(),

    recordSchemaPointer: {
      title: "record schema 指针",
      content: `
\`llm.input.json\` schema 由 \`sources.debugFile\` 中的 \`LlmInputDebugRecord\` type
定义；\`contextSnapshot\` 与 inputItems 中 system message 的 XML 同源——同一条
thread state 被两次序列化（一次为 snapshot 字段、一次为 inputItem 中嵌入的
XML 文本）。

完整 record 字段清单详见 \`observable.debug.recordSchema\`。
      `.trim(),
    },

    controlPlanePointer: {
      title: "控制平面指针",
      content: `
debug 开关 / HTTP API / viewer 渲染详见 \`observable.debug\`。
持久层只负责"按约定写文件"，开关与读取属于控制面。
      `.trim(),
    },
  },

  session: {
    kind: "example",
    title: "Session",
    summary: "一次端到端任务 = 一个 flows/{sessionId}/ 目录",
    content: `
一次端到端的任务处理 = 一个 Session。从用户发起请求开始，到请求被完成或放弃结束。

\`\`\`
flows/{sessionId}/
├── .session.json              Session 元数据（id / title / startedAt / status / rootObject）
├── readme.md                  Session 工作状态摘要（由 supervisor 维护）
│
├── objects/                   参与对象的 Flow 目录（按 stone 名）
│   ├── user/                      系统用户对应的 Flow 对象目录
│   │   └── ...                    user.root thread 持有 talk_window 派送消息
│   ├── {nameA}/               Stone A 在本 session 的 Flow
│   ├── {nameB}/
│   └── ...
│
├── issues/                    Session 级 Issue 跟踪（看板，跨对象共享）
│   ├── index.json
│   └── issue-{id}.json
│
└── tasks/                     Session 级 Task 跟踪
    ├── index.json
    └── task-{id}.json
\`\`\`

issues / tasks 形态详见 \`collaborable.kanban\`。
    `.trim(),
  },

  hierarchy: {
    kind: "example",
    title: "Session / Flow / Thread 层次关系",
    summary: "三层概念粒度与归属对照",
    content: `
\`\`\`
Session (flows/{sid}/)
  ├── Flow (objects/A/)
  │   ├── Thread 1 (根线程)
  │   │   └── Thread 2 (子线程)
  │   └── Thread 3 (另一根)
  └── Flow (objects/B/)
      └── Thread 4
\`\`\`

| 概念 | 粒度 | 归属 |
|---|---|---|
| Session | 一次任务（一个目录） | 多对象共享 |
| Flow    | 单对象在单个 Session 中的状态 | 单对象 |
| Thread  | 单 Flow 中的单个执行线程 | 单 Flow |

Thread 自己的运行时结构详见 \`thinkable.thread\`。
    `.trim(),
  },
};
