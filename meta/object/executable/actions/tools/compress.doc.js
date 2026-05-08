import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const compress_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`compress\` 用于清理上下文 & 压缩本线程的 process events，缓解 Context 容量压力。

## 何时触发

- **被动**：引擎检测到 events 估算 token 超过阈值，会在 Context 末尾注入压力提示，让 LLM 主动 open(command=compress)
- **主动**：LLM 在合适时机（如完成一个阶段、即将开新任务）自发触发

## 行为

调用 compress tool 会 fork 一个 sub thread 负责进行上下文清理 & process events 压缩
原 thread 会自动注入一条消息提示已异步开始 compress, 然后切换为 waiting 状态

这个 sub thread 会自动折叠所有 knowledge 为只展示 description 或者前 200 行文本，然后再自动加载 compress 相关的 knowledge

基于 compress knowledge 的指导通过 command program 调用相关 function 来编辑 context

compress 完成后，会将 context diff 应用到 parent thread 中

## 不可逆

压缩是删除式的——被截断的 events 内容不可恢复。原始 thread.json 文件不保留压缩前快照。
所以 compress 只该用于"已经没价值的中间细节"。
`,
};
