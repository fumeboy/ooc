import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
// compress 没有独立的 src 实现文件，它是 thinkloop 内部触发的复合行为；
// sources 指向 thinkloop 与 events 这两个最相关的源码 module，让 tsc 守住链路。
import * as thinkloop from "@src/thinkable/thinkloop";
import * as events from "@src/thinkable/context/index";

export const compress_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Compress",
  sources: { thinkloop, events },
  description: `
compress 清理上下文 / 压缩本线程的 process events，缓解 Context 容量压力。

按子字段展开：

- triggerModes — 被动 / 主动两种触发模式
- subThreadForkBehavior — fork 出 sub thread 执行压缩，原线程切到 waiting
- knowledgeFolding — sub thread 自动折叠 knowledge 后再加载 compress 专属 knowledge
- diffApplication — compress 完成后把 context diff 应用到 parent thread
- irreversibility — 压缩是删除式不可逆的约束
`.trim(),

  triggerModes: {
    title: "trigger Modes",
    content: `compress 的两种触发模式；详见各子节点。`,

    passiveThresholdNudge: {
      title: "被动（阈值触发 + Context 末尾 nudge）",
      content: `
引擎检测到 events 估算 token 超过阈值时，在 Context 末尾注入压力提示，
让 LLM 主动 open(command=compress)。LLM 仍是主动调用方，引擎不强制截断。
      `.trim(),
    },

    activeSelfTrigger: {
      title: "主动（LLM 自发）",
      content: `
LLM 在合适时机（如完成一个阶段、即将开新任务）自发调 open(command=compress)，
不需要等到阈值警告。
      `.trim(),
    },
  },

  subThreadForkBehavior: {
    title: "sub Thread Fork Behavior",
    content: `
compress tool 调用会 fork 一个 sub thread 负责进行上下文清理 / process events 压缩。
原 thread 自动注入一条消息提示已异步开始 compress，然后切换为 waiting 状态，
直到 sub thread 把压缩结果回写到本线程才被唤醒。
    `.trim(),
  },

  knowledgeFolding: {
    title: "knowledge Folding",
    content: `
sub thread 启动时为压低自身 context 体积，自动折叠所有 knowledge：仅展示 description
或前 200 行文本，然后再加载 compress 相关的专属 knowledge。
随后基于 compress knowledge 的指导通过 command program 调用相关 function 来编辑 context。
    `.trim(),
  },

  diffApplication: {
    title: "diff Application",
    content: `
compress 完成后，sub thread 把 context diff 应用到 parent thread；
parent thread 唤醒时已经看到精简后的事件流，不再需要二次操作。
    `.trim(),
  },

  irreversibility: {
    title: "irreversibility",
    content: `
压缩是删除式的——被截断的 events 内容不可恢复。原始 thread.json 文件不保留压缩前快照。
所以 compress 只该用于"已经没价值的中间细节"——尚有引用价值的事件应通过其它方式（如总结写回 thread.plan）保留。
    `.trim(),
  },
};
