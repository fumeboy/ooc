import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const compress_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`compress\` 用于压缩本线程的 process events，缓解 Context 容量压力。

## 何时触发

- **被动**：引擎检测到 events 估算 token 超过阈值，会在 Context 末尾注入压力提示，让 LLM 主动 open(command=compress)
- **主动**：LLM 在合适时机（如完成一个阶段、即将开新任务）自发触发

## 调用形式

\`\`\`
open(type=command, command=compress, description="…")
refine(form_id, {
  marks: [
    {
      from_event_id: "ev_010",
      to_event_id:   "ev_120",
      summary:       "这一段在调试 X 问题，最终结论：Y"
    },
    ...
  ]
})
submit(form_id)
\`\`\`

每个 mark 描述"哪一段 events 该被压缩 + 压缩后的摘要"。LLM 自行决定切分。

## 行为

submit 时引擎按 marks 逐项处理：

1. 找到 \`from_event_id\` 到 \`to_event_id\` 之间的所有 events
2. 删除区段内的原 events
3. 在原位置插入一条 \`compress_summary\` event，content = 该 mark 的 summary
4. 在 process events 末尾追加一条 inject 提示：本轮被压缩了几条 events，节省了多少 tokens

下一轮 Context 中，该区段被一条占位 event 替代，原细节不再可见。

## Path 列表

\`\`\`
compress
\`\`\`

## 触发的 knowledge

激活 \`kernel:compress\`（show_content_when 含 \`compress\`）。
描述如何识别冗余区段、如何写好 summary、不该压缩什么（如关键决策、错误诊断的核心证据）。

## 不可逆

压缩是删除式的——被截断的 events 内容不可恢复。原始 thread.json 文件不保留压缩前快照。
所以 compress 只该用于"已经没价值的中间细节"，关键证据应保留或写入 long-term memory。

## 与三层记忆的关系

compress 是 recent 层的容量管理工具——只影响本线程当前 events。
如果想把某段经验跨任务保留，应**在 compress 前**通过 super 分身写入 long-term memory
（详见 reflectable/super-flow）。
`,
};
