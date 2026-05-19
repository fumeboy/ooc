import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as stoneObject from "@src/persistable/stone-object";
import * as talkDelivery from "@src/executable/windows/talk-delivery";
import * as executableIndex from "@src/executable/index";
import * as reflectableKnowledge from "@src/thinkable/reflectable/reflectable-knowledge";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Reflectable 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * Reflectable 概念：Object 的自我迭代 / 元编程 / 反思能力。
 *
 * 工程上 super flow 就是 sessionId="super" 下的普通 flow object——复用
 * createFlowObject / threads / worker / talk-delivery 全部既有机制，不引入
 * 新调度器、新落盘形态、新原语。所有"反思特殊性"通过 (a) target="super"
 * 自指别名 + (b) reflectable knowledge 引导两种零侵入形式表达。
 *
 * sources:
 *  - stoneObject          — stones/{id}/ 目录骨架（reflectable 写权目标，Phase 2 上线）
 *  - talkDelivery         — talk(target="super") 自指别名解析；跨 session 派送到 sessionId="super"
 *  - executableIndex      — collectExecutableKnowledgeEntries 在 sessionId="super" 时注入 reflectable knowledge
 *  - reflectableKnowledge — REFLECTABLE_BASIC_PATH + REFLECTABLE_KNOWLEDGE 协议常量
 */
export type ReflectableConcept = Concept & {
  sources: {
    stoneObject: typeof stoneObject;
    talkDelivery: typeof talkDelivery;
    executableIndex: typeof executableIndex;
    reflectableKnowledge: typeof reflectableKnowledge;
  };

  /** super flow 落盘位置：与普通 flow 同构 */
  placement: {
    title: string;
    summary?: string;
    sessionConvention: DocNode;
    objectScope: DocNode;
    coreAssertionMatch: DocNode;
  };

  /** 起身路径：talk(target="super") 自指别名 */
  invocation: {
    title: string;
    summary?: string;
    selfAlias: DocNode;
    crossSessionDispatch: DocNode;
    workerReuse: DocNode;
  };

  /** 上下文引导：reflectable knowledge 通过 protocol 通道注入 */
  guidance: {
    title: string;
    summary?: string;
    sessionGate: DocNode;
    knowledgeContent: DocNode;
    softBoundary: DocNode;
  };

  /** 受保护的 sessionId */
  reservedSession: DocNode;

  /** Phase 1 不包含的能力（forward-looking） */
  futurePhases: ExampleNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const reflectable_v20260504_1: ReflectableConcept = {
  name: "Reflectable",
  get parent() {
    return object_v20260504_1;
  },
  sources: {
    stoneObject,
    talkDelivery,
    executableIndex,
    reflectableKnowledge,
  },
  description: `
Reflectable 是 Object 的自我迭代 / 元编程 / 反思能力。OOC 把它实现为约定
sessionId="super" 下的普通 flow object——不引入特殊调度器、特殊落盘位置、
路径级 ACL；"反思特殊性"由 (a) target="super" 自指别名 + (b) reflectable
knowledge 引导两种约定承载。

匹配 persistable.coreAssertion "目录 ≡ 对象" 四条等价规则：super 是对象，
对象就是目录，没有理由用不同形态。
  `.trim(),

  placement: {
    title: "落盘位置",
    summary: "super flow 与普通 flow 同构在 flows/super/objects/{name}/",

    sessionConvention: {
      title: "受保护 sessionId 约定",
      content: `
\`"super"\` 是受保护 sessionId（详见 \`reservedSession\` 字段）。用户通过 HTTP
API 不能创建 / seed 这个 session；只能由 talk-delivery 内部派送时按需自动
创建。
      `.trim(),
    },

    objectScope: {
      title: "每对象一个 super 分身",
      content: `
\`flows/super/objects/alice/\` 是 alice 的 super 分身，\`flows/super/objects/critic/\`
是 critic 的。super flow 完全按 objectId 隔离，互不交集。
      `.trim(),
    },

    coreAssertionMatch: {
      title: "与 coreAssertion 一致",
      content: `
super flow 没有任何"目录之外"的状态——thread.json / debug / context windows
全部按普通 flow 形态落盘。可被 \`cp -r\` / \`rm -rf\` / \`mv\` 当作普通目录处理。
\`stones/{id}/super/\` 这条历史方案被丢弃，因为它会违反 coreAssertion 第三条
（目录复制即对象迁移）。
      `.trim(),
    },
  },

  invocation: {
    title: "起身路径",
    summary: "talk(target='super') 自指别名 + 跨 session 派送",

    selfAlias: {
      title: "target='super' 自指别名",
      content: `
任何 thread 内 LLM 调 \`open(talk, target="super")\` 时，talk-delivery 解析为
"caller 自己的 super 分身"：
- \`calleeObjectId = caller.objectId\`
- \`calleeSessionId = "super"\`

alice 调 super 总是到 \`flows/super/objects/alice/\`；critic 调 super 总是到
\`flows/super/objects/critic/\`。Phase 1 不暴露 \`alice/super\` 跨对象路径
（critic 不能直接调 alice 的 super）——延后到 Phase 3。
      `.trim(),
    },

    crossSessionDispatch: {
      title: "跨 session 派送",
      content: `
super 别名是 OOC 第一处跨 session 派送场景。talk-delivery 之前隐含的
"caller / callee 同 session" 约束已松绑：callee 的 persistence ref 用
\`calleeSessionId\` 独立解析，与 caller 当前 session 解耦。
      `.trim(),
    },

    workerReuse: {
      title: "调度沿用现有 worker",
      content: `
super flow 的 thread 被 talk-delivery 创建后，由 app server 既有 worker
按 (sessionId, objectId, threadId) 队列调度——与普通 flow thread 完全同路径。
不存在独立 SuperScheduler 模块。
      `.trim(),
    },
  },

  guidance: {
    title: "上下文引导",
    summary: "reflectable knowledge 通过 protocol 通道按 sessionId 注入",

    sessionGate: {
      title: "按 sessionId 注入",
      content: `
\`collectExecutableKnowledgeEntries\` 在拼 protocol entries 时检查
\`thread.persistence?.sessionId === "super"\`，命中则注入路径为
\`internal/executable/reflectable/basic\` 的 knowledge entry。普通 session 与
内存模式 thread 都不注入。
      `.trim(),
    },

    knowledgeContent: {
      title: "knowledge 内容",
      content: `
首版常量在 \`sources.reflectableKnowledge.REFLECTABLE_KNOWLEDGE\` 中维护：
告诉 LLM 当前在 super flow 里、本轮是反思场景而非执行新任务、给一个保底
end 动作。后续要 per-object 自定义可升级到 activator 路径
（\`stones/{id}/knowledge/reflectable/index.md\` + activator frontmatter）。
      `.trim(),
    },

    softBoundary: {
      title: "软约束 vs 硬隔离",
      content: `
Phase 1 不做"super 才能改 stone" 路径级 ACL——靠 reflectable knowledge 文本
引导 LLM 自律。Phase 5 才上 path guard 让普通 flow 写 \`stones/\` 路径被
持久层 reject。
      `.trim(),
    },
  },

  reservedSession: {
    title: "受保护 sessionId",
    summary: "'super' 不允许用户从 API / UI 创建；service 层校验",
    content: `
\`src/app/server/modules/flows/service.ts\` 在 \`createSession\` / \`seedSession\`
入口拒收 \`sessionId === "super"\`（case-insensitive，防 HFS+ 等大小写不敏感
文件系统绕过）。talk-delivery 直接 import 持久层 \`createFlowSession\`，不经过
service 入口——系统能按需创建、用户不能直接创建。
    `.trim(),
  },

  futurePhases: {
    kind: "example",
    title: "Forward-looking phases",
    summary: "Phase 1 仅交付通道；后续 phase 增量上线",
    content: `
| Phase | 上线能力 |
|---|---|
| 1 | 通道贯通：talk(target='super') 起 super flow + reflectable knowledge 引导 |
| 2 | mutation 验证：super flow 真的 \`file_window.edit\` 改 \`stones/{self}/self.md\` |
| 3 | 跨对象 super 调用：critic 起 alice 的 super flow 帮 alice 反思 |
| 4 | 自动触发：worker idle / thread end 时自动 nudge super flow |
| 5 | Stone 写权 ACL：path-level guard 强制 stones/ 写入仅限 super session |
    `.trim(),
  },
};
