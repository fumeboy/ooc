import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as globSource from "@src/executable/windows/root/glob";

export const glob_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Glob",
  sources: { globSource },
  description: `
glob 按文件名通配符（glob pattern）查找文件；结果作为 search_window kind=glob
留在 context。

按子字段展开：

- callShape — 调用形态
- params — pattern / cwd 两个参数语义
- behavior — 扫描 / 排序 / 截断 / 后续 open_match
- selectionGuidance — 与 grep 的选用边界
`,

  callShape_v20260517_1: {
    title: "call Shape",
    content: `

open(command="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })

    `,
  },

  params_v20260517_1: {
    title: "params",
    content: `
| 参数    | 必填 | 说明 |
|---------|------|------|
| pattern | 是   | glob 通配符（src/**/*.ts、*.md、tests/**/* 等）|
| cwd     | 否   | 搜索根目录；缺省为当前工作目录 |
    `,

    pattern_v20260517_1: {
      title: "pattern (必填)",
      content: `
glob 通配符；支持 ** 跨目录、* 单段、? 单字符、[abc] 字符集。
典型：src/**/*.ts / *.md / tests/**/*。
      `,
    },

    cwd_v20260517_1: {
      title: "cwd (可选)",
      content: `
搜索根目录；缺省为当前工作目录。pattern 中的相对路径以 cwd 为基。
      `,
    },
  },

  behavior_v20260517_1: {
    title: "behavior",
    content: `
glob 执行的 4 个阶段。
    `,

    scan_v20260517_1: {
      title: "扫描",
      content: `
用 Bun 内置 Glob 扫描；只返回文件（onlyFiles=true）。
      `,
    },

    sortAndTruncate_v20260517_1: {
      title: "排序与截断",
      content: `
按 path 字典序排序；超过 200 条截断（search_window.truncated=true）。
      `,
    },

    openMatch_v20260517_1: {
      title: "后续 open_match",
      content: `
命中后用：


open(parent_window_id="<search_window_id>", command="open_match",
     args={ index })


在该 match 对应的文件上 spawn file_window。
      `,
    },
  },

  selectionGuidance_v20260517_1: {
    title: "selection Guidance",
    content: `
要按**文件内容**搜索请用 grep；glob 只是文件名匹配。
    `,
  },
};
