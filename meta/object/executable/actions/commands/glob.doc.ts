import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as globSource from "@src/executable/windows/root/glob";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.glob command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Glob 概念：按文件名通配符查找文件。
 *
 * sources:
 *  - globSource — root.glob command 实现
 */
export type GlobConcept = Concept & {
  sources: { globSource: typeof globSource };

  /** 调用形态 */
  callShape: DocNode;

  /** pattern / cwd 参数语义 */
  params: {
    title: string;
    summary?: string;
    content?: string;
    pattern: DocNode;
    cwd: DocNode;
  };

  /** 执行行为：扫描 / 排序 / 截断 / 后续 open_match */
  behavior: {
    title: string;
    summary?: string;
    scan: DocNode;
    sortAndTruncate: DocNode;
    openMatch: DocNode;
  };

  /** 与 grep 的选用边界 */
  selectionGuidance: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const glob_v20260516_1: GlobConcept = {
  name: "Glob",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { globSource },
  description: `
glob 按文件名通配符（glob pattern）查找文件；结果作为 search_window kind=glob
留在 context。
`.trim(),

  callShape: {
    title: "调用形态",
    content: `
\`\`\`
open(command="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })
\`\`\`
    `.trim(),
  },

  params: {
    title: "参数",
    summary: "pattern 必填 / cwd 可选",
    content: `
| 参数    | 必填 | 说明 |
|---------|------|------|
| pattern | 是   | glob 通配符（src/**/*.ts、*.md、tests/**/* 等）|
| cwd     | 否   | 搜索根目录；缺省为当前工作目录 |
    `.trim(),

    pattern: {
      title: "pattern (必填)",
      content: `
glob 通配符；支持 ** 跨目录、* 单段、? 单字符、[abc] 字符集。
典型：src/**/*.ts / *.md / tests/**/*。
      `.trim(),
    },

    cwd: {
      title: "cwd (可选)",
      content: "搜索根目录；缺省为当前工作目录。pattern 中的相对路径以 cwd 为基。",
    },
  },

  behavior: {
    title: "执行行为",
    summary: "扫描 → 排序截断 → open_match",

    scan: {
      title: "扫描",
      content: "用 Bun 内置 Glob 扫描；只返回文件（onlyFiles=true）。",
    },

    sortAndTruncate: {
      title: "排序与截断",
      content: "按 path 字典序排序；超过 200 条截断（search_window.truncated=true）。",
    },

    openMatch: {
      title: "后续 open_match",
      content: `
命中后用：

\`\`\`
open(parent_window_id="<search_window_id>", command="open_match",
     args={ index })
\`\`\`

在该 match 对应的文件上 spawn file_window。
      `.trim(),
    },
  },

  selectionGuidance: {
    title: "选用边界",
    summary: "按文件内容搜索请用 grep；glob 只是文件名匹配",
    content: "要按**文件内容**搜索请用 grep；glob 只是文件名匹配。",
  },
};
