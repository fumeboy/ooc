import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as writeFileSource from "@src/executable/windows/root/write-file";

export const write_file_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "WriteFile",
  sources: { writeFileSource },
  description: `
write_file 创建或完整覆盖一个文件，并自动 spawn 一个 file_window 指向它，
便于后续用 file_window.edit 做精确修改。

按子字段展开：

- callShape — 调用形态
- params — path / content 两个参数语义
- submitEffects — 写盘 + 自动 spawn file_window
- contrastWithProgramShell — 与 program(shell) 写文件方式的对比
`,

  callShape_v20260517_1: {
    index: `

open(command="write_file", title="新建测试文件",
     args={ path: "tests/foo.test.ts", content: "import { it } from 'bun:test'; ..." })

`,
  },

  params_v20260517_1: {
    index: `
| 参数    | 必填 | 说明 |
|---------|------|------|
| path    | 是   | 目标文件路径（绝对或工作目录相对）；父目录不存在会自动 mkdir -p |
| content | 是   | 完整文件内容（字符串；空字符串表示 0 字节文件）|
`,

    path_v20260517_1: {
      index: `
### path (必填)

目标文件路径（绝对或工作目录相对）。父目录不存在时自动 mkdir -p。
`,
    },

    content_v20260517_1: {
      index: `
### content (必填)

完整文件内容（字符串；空字符串表示 0 字节文件）。
不支持追加 / patch 形式——要做精确修改请用 file_window.edit。
`,
    },
  },

  submitEffects_v20260517_1: {
    index: `
写盘成功后在 thread.contextWindows 下挂一个 type=file 的 window 指向 path，
LLM 可以直接 open(parent_window_id="<file_window_id>", command="edit", ...) 修改它。
`,
  },

  contrastWithProgramShell_v20260517_1: {
    index: `
不要用 program(language="shell", code="echo ... > ...") 创建文件——
会失去 file_window 的版本可见性，且转义容易出错。

write_file 是创建/覆盖完整文件内容的首选；要改已有文件的部分内容则用
file_window.edit。
`,
  },
};
