import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as grepSource from "@src/executable/windows/root/grep";
import * as grepImplSource from "@src/executable/windows/root/grep-impl";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.grep command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Grep 概念：按文件内容（正则）搜索。
 *
 * sources:
 *  - grepSource     — root.grep command 入口
 *  - grepImplSource — rg / JS 回退的实现细节
 */
export type GrepConcept = Concept & {
  sources: {
    grepSource: typeof grepSource;
    grepImplSource: typeof grepImplSource;
  };

  /** 调用形态 */
  callShape: DocNode;

  /** 4 个参数语义 */
  params: {
    title: string;
    summary?: string;
    content?: string;
    pattern: DocNode;
    path: DocNode;
    glob: DocNode;
    caseInsensitive: DocNode;
  };

  /** 执行行为：rg/JS 回退 / 排序截断 / snippet / open_match */
  behavior: {
    title: string;
    summary?: string;
    rgPreferredJsFallback: DocNode;
    sortAndTruncate: DocNode;
    snippetShape: DocNode;
    openMatch: DocNode;
  };

  /** 与 glob 的选用边界 */
  selectionGuidance: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const grep_v20260516_1: GrepConcept = {
  name: "Grep",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { grepSource, grepImplSource },
  description: `
grep 按文件内容（正则）搜索；结果作为 search_window kind=grep 留在 context，
每条命中含 path / line / snippet。
`.trim(),

  callShape: {
    title: "调用形态",
    content: `
\`\`\`
open(command="grep", title="找 deprecated 用法",
     args={ pattern: "deprecatedFoo", path: "src", glob: "*.ts" })
\`\`\`
    `.trim(),
  },

  params: {
    title: "参数",
    summary: "pattern 必填，path / glob / case_insensitive 可选",
    content: `
| 参数             | 必填 | 说明 |
|------------------|------|------|
| pattern          | 是   | 正则表达式 |
| path             | 否   | 搜索根目录或单个文件；缺省为当前工作目录 |
| glob             | 否   | 文件名过滤 glob（如 *.ts）|
| case_insensitive | 否   | bool；true 忽略大小写 |
    `.trim(),

    pattern: {
      title: "pattern (必填)",
      content: "正则表达式；语法跟随底层引擎（rg 时为 Rust regex，JS 回退时为 JS RegExp）。",
    },

    path: {
      title: "path (可选)",
      content: "搜索根目录或单个文件；缺省为当前工作目录。",
    },

    glob: {
      title: "glob (可选)",
      content: "文件名过滤 glob（如 *.ts）；与 pattern 正交——pattern 匹配内容，glob 限制文件集。",
    },

    caseInsensitive: {
      title: "case_insensitive (可选)",
      content: "bool；true 忽略大小写。",
    },
  },

  behavior: {
    title: "执行行为",
    summary: "rg 优先 / JS 回退 → 排序截断 → snippet → open_match",

    rgPreferredJsFallback: {
      title: "rg 优先、JS 回退",
      content: "优先调用 rg --json；rg 不可用时回退 JS 实现，输出结构一致。",
    },

    sortAndTruncate: {
      title: "排序与截断",
      content: "按 (path, line) 字典序排序；超过 200 条截断（search_window.truncated=true）。",
    },

    snippetShape: {
      title: "snippet",
      content: "snippet 是命中所在行的文本，单行 trim 到 200 字符。",
    },

    openMatch: {
      title: "后续 open_match",
      content: `
命中后用：

\`\`\`
open(parent_window_id="<search_window_id>", command="open_match",
     args={ index })
\`\`\`

spawn file_window；grep match 自动套上 [line ± 40] 切片便于看上下文。
      `.trim(),
    },
  },

  selectionGuidance: {
    title: "选用边界",
    summary: "按文件名搜索请用 glob；grep 只做内容搜索",
    content: "要按**文件名**搜索请用 glob；grep 只做内容搜索。",
  },
};
