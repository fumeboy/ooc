import { object_v20260504_1 } from "@meta/object/index.doc";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { identity_v20260505_1 } from "@meta/object/thinkable/identity.doc";
import { llm_v20260508_1 } from "@meta/object/thinkable/llm/index.doc";
import { knowledge_v20260505_1 } from "@meta/object/thinkable/knowledge/index.doc";
import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import { thinkloop_v20260505_1 } from "@meta/object/thinkable/thinkloop/index.doc";
import { context_v20260505_1 } from "@meta/object/thinkable/context/index.doc";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Thinkable 子领域聚合器
 *
 *  Thinkable 描述 Object 的思考能力。本文件不是 Concept（无 sources 三件套）——
 *  它是把 6 个子概念串成一棵树的 section aggregator，由 concept-links 测试遍历进
 *  各子概念。
 * ──────────────────────────────────────────────────────────────── */

/**
 * Thinkable section aggregator。
 *
 * 子领域:
 *  - identity   — Object 对自己的双面认知（self / readme）
 *  - llm        — 与 LLM 的交互（provider 协议、流式输出）
 *  - knowledge  — 拥有什么知识及按 command 路径的渐进式激活
 *  - context    — 单轮 LLM 输入的组成与构建（Context Engineering）
 *  - thread     — 思考的运行时结构（线程树、状态、子线程、调度）
 *  - thinkloop  — 单轮循环引擎（context-build → llm → tool_use → 循环）
 *
 * 此对象不带 `name + description + sources` 三件套——它不是 Concept，
 * 只是把子概念串成一棵树的 section aggregator。
 */
export const thinkable_v20260504_1 = {
  get parent() {
    return object_v20260504_1;
  },
  title: "section",
  content: `
Thinkable 描述 Object 的思考能力。思考的核心是与 LLM 交互，关键是构造 LLM 输入
（Context）。思考的过程 (process) 通过 Thread 表示，Thread 可以派生子 Thread，
形成一个 Thread Tree。
  `.trim(),
  identity: identity_v20260505_1,
  llm: llm_v20260508_1,
  knowledge: knowledge_v20260505_1,
  context: context_v20260505_1,
  thread: thread_v20260505_1,
  thinkloop: thinkloop_v20260505_1,
  executable: executable_v20260504_1,
};
