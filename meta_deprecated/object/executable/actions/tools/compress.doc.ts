import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
// compress 没有独立的 src 实现文件，它是 thinkloop 内部触发的复合行为；
// sources 指向 thinkloop 与 events 这两个最相关的源码 module，让 tsc 守住链路。
import * as thinkloop from "@src/thinkable/thinkloop";
import * as events from "@src/thinkable/context/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：compress 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * compress 概念：清理上下文 / 压缩本线程的 process events，缓解 Context 容量压力。
 *
 * sources:
 *  - thinkloop — 阈值检测 + nudge 注入逻辑
 *  - events    — process events 数据结构与压缩对象
 */
export type CompressConcept = Concept & {
  sources: {
    thinkloop: typeof thinkloop;
    events: typeof events;
  };

  /** 被动 / 主动两种触发模式 */
  triggerModes: {
    title: string;
    summary?: string;
    /** 阈值触发 + Context 末尾 nudge 提示 */
    passiveThresholdNudge: DocNode;
    /** LLM 在合适时机自发触发 */
    activeSelfTrigger: DocNode;
  };

  /** fork 出 sub thread 执行压缩，原线程切到 waiting */
  subThreadForkBehavior: DocNode;

  /** sub thread 自动折叠 knowledge 后再加载 compress 专属 knowledge */
  knowledgeFolding: DocNode;

  /** compress 完成后把 context diff 应用到 parent thread */
  diffApplication: DocNode;

  /** 压缩是删除式不可逆的硬约束 */
  irreversibility: InvariantNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const compress_v20260506_1: CompressConcept = {
  name: "Compress",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { thinkloop, events },
  description: `
compress 清理上下文 / 压缩本线程的 process events，缓解 Context 容量压力。
`.trim(),

  triggerModes: {
    title: "触发模式",
    summary: "被动（阈值 nudge）与主动（LLM 自发）两条触发路径",

    passiveThresholdNudge: {
      title: "被动触发",
      summary: "阈值触发 + Context 末尾 nudge 提示",
      content: `
引擎检测到 events 估算 token 超过阈值时，在 Context 末尾注入压力提示，
让 LLM 主动 open(command=compress)。LLM 仍是主动调用方，引擎不强制截断。
      `.trim(),
    },

    activeSelfTrigger: {
      title: "主动触发",
      summary: "LLM 在合适时机自发调用，不必等阈值警告",
      content: `
LLM 在合适时机（如完成一个阶段、即将开新任务）自发调 open(command=compress)，
不需要等到阈值警告。
      `.trim(),
    },
  },

  subThreadForkBehavior: {
    title: "子线程 fork 行为",
    summary: "compress 调用 fork 出 sub thread，原线程切到 waiting",
    content: `
compress tool 调用会 fork 一个 sub thread 负责进行上下文清理 / process events 压缩。
原 thread 自动注入一条消息提示已异步开始 compress，然后切换为 waiting 状态，
直到 sub thread 把压缩结果回写到本线程才被唤醒。
    `.trim(),
  },

  knowledgeFolding: {
    title: "knowledge 折叠",
    summary: "sub thread 启动时先折叠所有 knowledge 再加载 compress 专属 knowledge",
    content: `
sub thread 启动时为压低自身 context 体积，自动折叠所有 knowledge：仅展示 description
或前 200 行文本，然后再加载 compress 相关的专属 knowledge。
随后基于 compress knowledge 的指导通过 command program 调用相关 function 来编辑 context。
    `.trim(),
  },

  diffApplication: {
    title: "diff 回写",
    summary: "sub thread 把 context diff 应用到 parent thread",
    content: `
compress 完成后，sub thread 把 context diff 应用到 parent thread；
parent thread 唤醒时已经看到精简后的事件流，不再需要二次操作。
    `.trim(),
  },

  irreversibility: {
    kind: "invariant",
    title: "压缩不可逆",
    summary: "被截断的 events 内容不可恢复",
    content: `
压缩是删除式的——被截断的 events 内容不可恢复。原始 thread.json 文件不保留压缩前快照。
所以 compress 只该用于"已经没价值的中间细节"——尚有引用价值的事件应通过其它方式
（如总结写回 thread.plan）保留。
    `.trim(),
    rationale: `
若保留压缩前完整快照，"压缩"等于二次复制，反而放大存储与体积压力；放弃可逆性
换取真正的体积下降，并把"什么值得保留"的判断显式交给 LLM。
    `.trim(),
  },
};
