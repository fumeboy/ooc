import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as grepSource from "@src/executable/windows/root/grep";
import * as grepImplSource from "@src/executable/windows/root/grep-impl";

export const grep_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Grep",
  sources: { grepSource, grepImplSource },
  description: `
\`grep\` 按文件内容（正则）搜索；结果作为 search_window kind=grep 留在 context，
每条命中含 path / line / snippet。

按子字段展开：

- callShape — 调用形态
- params — 4 个参数语义
- behavior — rg / JS 回退、排序、截断、snippet 处理、后续 open_match
- selectionGuidance — 与 glob 的选用边界
`.trim(),

  callShape_v20260517_1: {
    index: `
\`\`\`
open(command="grep", title="找 deprecated 用法",
     args={ pattern: "deprecatedFoo", path: "src", glob: "*.ts" })
\`\`\`
`.trim(),
  },

  params_v20260517_1: {
    index: `
| 参数             | 必填 | 说明 |
|------------------|------|------|
| pattern          | 是   | 正则表达式 |
| path             | 否   | 搜索根目录或单个文件；缺省为当前工作目录 |
| glob             | 否   | 文件名过滤 glob（如 \`*.ts\`）|
| case_insensitive | 否   | bool；true 忽略大小写 |
`.trim(),

    pattern_v20260517_1: {
      index: `
### pattern (必填)

正则表达式；语法跟随底层引擎（rg 时为 Rust regex，JS 回退时为 JS RegExp）。
`.trim(),
    },

    path_v20260517_1: {
      index: `
### path (可选)

搜索根目录或单个文件；缺省为当前工作目录。
`.trim(),
    },

    glob_v20260517_1: {
      index: `
### glob (可选)

文件名过滤 glob（如 \`*.ts\`）；与 pattern 正交——pattern 匹配内容，glob 限制文件集。
`.trim(),
    },

    caseInsensitive_v20260517_1: {
      index: `
### case_insensitive (可选)

bool；true 忽略大小写。
`.trim(),
    },
  },

  behavior_v20260517_1: {
    index: `
grep 执行的 5 个阶段。
`.trim(),

    rgPreferredJsFallback_v20260517_1: {
      index: `
### rg 优先、JS 回退

优先调用 \`rg --json\`；rg 不可用时回退 JS 实现，输出结构一致。
`.trim(),
    },

    sortAndTruncate_v20260517_1: {
      index: `
### 排序与截断

按 \`(path, line)\` 字典序排序；超过 200 条截断（\`search_window.truncated=true\`）。
`.trim(),
    },

    snippetShape_v20260517_1: {
      index: `
### snippet

snippet 是命中所在行的文本，单行 trim 到 200 字符。
`.trim(),
    },

    openMatch_v20260517_1: {
      index: `
### 后续 open_match

命中后用：

\`\`\`
open(parent_window_id="<search_window_id>", command="open_match",
     args={ index })
\`\`\`

spawn file_window；grep match 自动套上 \`[line ± 40]\` 切片便于看上下文。
`.trim(),
    },
  },

  selectionGuidance_v20260517_1: {
    index: `
要按**文件名**搜索请用 \`glob\`；grep 只做内容搜索。
`.trim(),
  },
};
