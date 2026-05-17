import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openFileSource from "@src/executable/windows/root/open-file";

export const open_file_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "OpenFile",
  sources: { open_file: openFileSource },
  description: `
open_file 把指定文件的内容引入 context（持续可见，每轮重新读）。

按子字段展开：

- callShape — 调用形态与参数
- submitEffects — file_window 的产出
- fileWindowCommands — file_window 上注册的 set_range / reload / close
- renderRules — 渲染层的读取 / 切片 / 截断 / 错误处理规则
`,

  callShape_v20260517_1: {
    title: "call Shape",
    content: `

open(command="open_file", title="读 README", args={
  path:    "README.md",       // 必填
  lines?:  [0, 200],           // 可选，行范围
  columns?:[0, 120]            // 可选，列范围
})


args 给齐时 open 立即提交 form，无需 refine/submit。
    `,
  },

  submitEffects_v20260517_1: {
    title: "submit Effects",
    content: `
submit 副作用：在 thread.contextWindows 下挂一个 type=file 的 window。
窗口持续可见，每轮渲染都会重新读文件正文。
    `,
  },

  fileWindowCommands_v20260517_1: {
    title: "file Window Commands",
    content: `
file_window 上注册的 3 个 sub-command。
    `,

    setRangeCmd_v20260517_1: {
      title: "set_range",
      content: `
调整 lines / columns 切片：


open(parent_window_id="<file_window_id>", command="set_range",
     args={ lines: [200, 400] })

      `,
    },

    reloadCmd_v20260517_1: {
      title: "reload",
      content: `
强制下一轮重新读文件。render 每轮都会读，主要是语义提示。
      `,
    },

    closeCmd_v20260517_1: {
      title: "close",
      content: `
释放 window。
      `,
    },
  },

  renderRules_v20260517_1: {
    title: "render Rules",
    content: `
render 层在 renderFileWindowChildren 中按规则处理文件内容。
    `,

    readUtf8_v20260517_1: {
      title: "读取",
      content: `
调 readFile，utf8 解码。
      `,
    },

    sliceRange_v20260517_1: {
      title: "切片",
      content: `
按 lines / columns 切片；缺省时取全文。
      `,
    },

    sizeTruncate_v20260517_1: {
      title: "体积截断",
      content: `
32KB 截断；超出部分丢弃并标记 truncated。
      `,
    },

    errorHandling_v20260517_1: {
      title: "错误兜底",
      content: `
读取失败时输出 <error> 子节点而不是抛错，保持 render 链路不被打断。
      `,
    },
  },
};
