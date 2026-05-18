import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openFileSource from "@src/executable/windows/root/open-file";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.open_file command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * OpenFile 概念：把指定文件的内容引入 context。
 *
 * sources:
 *  - open_file — root.open_file command 实现
 */
export type OpenFileConcept = Concept & {
  sources: { open_file: typeof openFileSource };

  /** 调用形态与参数 */
  callShape: DocNode;

  /** submit 副作用：file_window 的产出 */
  submitEffects: DocNode;

  /** file_window 上注册的 set_range / reload / close */
  fileWindowCommands: {
    title: string;
    summary?: string;
    setRangeCmd: DocNode;
    reloadCmd: DocNode;
    closeCmd: DocNode;
  };

  /** 渲染层的读取 / 切片 / 截断 / 错误处理规则 */
  renderRules: {
    title: string;
    summary?: string;
    readUtf8: DocNode;
    sliceRange: DocNode;
    sizeTruncate: DocNode;
    errorHandling: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const open_file_v20260514_1: OpenFileConcept = {
  name: "OpenFile",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { open_file: openFileSource },
  description: "open_file 把指定文件的内容引入 context（持续可见，每轮重新读）。",

  callShape: {
    title: "调用形态",
    summary: "args 给齐时 open 立即提交 form",
    content: `
\`\`\`
open(command="open_file", title="读 README", args={
  path:    "README.md",       // 必填
  lines?:  [0, 200],           // 可选，行范围
  columns?:[0, 120]            // 可选，列范围
})
\`\`\`

args 给齐时 open 立即提交 form，无需 refine/submit。
    `.trim(),
  },

  submitEffects: {
    title: "submit 副作用",
    summary: "在 thread.contextWindows 下挂一个 type=file 的 window",
    content: `
submit 副作用：在 thread.contextWindows 下挂一个 type=file 的 window。
窗口持续可见，每轮渲染都会重新读文件正文。
    `.trim(),
  },

  fileWindowCommands: {
    title: "file_window 子命令",
    summary: "file_window 上注册的 3 个 sub-command",

    setRangeCmd: {
      title: "set_range",
      content: `
调整 lines / columns 切片：

\`\`\`
open(parent_window_id="<file_window_id>", command="set_range",
     args={ lines: [200, 400] })
\`\`\`
      `.trim(),
    },

    reloadCmd: {
      title: "reload",
      content: "强制下一轮重新读文件。render 每轮都会读，主要是语义提示。",
    },

    closeCmd: {
      title: "close",
      content: "释放 window。",
    },
  },

  renderRules: {
    title: "渲染规则",
    summary: "render 层在 renderFileWindowChildren 中按规则处理",

    readUtf8: {
      title: "读取",
      content: "调 readFile，utf8 解码。",
    },

    sliceRange: {
      title: "切片",
      content: "按 lines / columns 切片；缺省时取全文。",
    },

    sizeTruncate: {
      title: "体积截断",
      content: "32KB 截断；超出部分丢弃并标记 truncated。",
    },

    errorHandling: {
      title: "错误兜底",
      content: "读取失败时输出 <error> 子节点而不是抛错，保持 render 链路不被打断。",
    },
  },
};
