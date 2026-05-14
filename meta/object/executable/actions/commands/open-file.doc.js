import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openFileSource from "@src/executable/windows/root/open-file";

export const open_file_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`open_file\` 用于把指定文件的内容引入 context（持续可见，每轮重新读）。

## 调用形式

\`\`\`
open(command="open_file", title="读 README", args={
  path:    "README.md",     // 必填
  lines?:  [0, 200],         // 可选，行范围
  columns?:[0, 120]          // 可选，列范围
})
\`\`\`

> args 给齐时 C 规则触发自动 submit，无需 refine/submit。

submit 副作用：在 thread.contextWindows 下挂一个 type=file 的 window。

## file_window 的注册命令

| command   | 行为 |
|---|---|
| set_range | 调整 lines / columns 切片 |
| reload    | 强制下一轮重新读文件（render 每轮都会读，主要是语义提示） |
| close     | 释放 window |

调整范围示例：

\`\`\`
open(parent_window_id="<file_window_id>", command="set_range", args={ lines: [200, 400] })
\`\`\`

## 渲染

render 层在 renderFileWindowChildren 中：
- 调 \`readFile\`（utf8）
- 按 lines/columns 切片
- 32KB 截断
- 失败时输出 \`<error>\` 子节点而不是抛错
`,
  sources: {
    open_file: openFileSource,
  },
};
