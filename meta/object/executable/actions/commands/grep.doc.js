import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as grepSource from "@src/executable/windows/root/grep";
import * as grepImplSource from "@src/executable/windows/root/grep-impl";

const GREP_DESCRIPTION = `
\`grep\` 按文件内容（正则）搜索；结果作为 search_window kind=grep 留在 context，每条
命中含 path / line / snippet。

## 调用形式

\`\`\`
open(command="grep", title="找 deprecated 用法",
     args={ pattern: "deprecatedFoo", path: "src", glob: "*.ts" })
\`\`\`

## 参数

| 参数             | 必填 | 说明 |
|------------------|------|------|
| pattern          | 是   | 正则表达式 |
| path             | 否   | 搜索根目录或单个文件；缺省为当前工作目录 |
| glob             | 否   | 文件名过滤 glob（如 \`*.ts\`）|
| case_insensitive | 否   | bool；true 忽略大小写 |

## 行为

- 优先调用 \`rg --json\`；rg 不可用时回退 JS 实现，输出结构一致
- 按 (path, line) 字典序排序；超过 200 条截断（search_window.truncated=true）
- snippet 是命中所在行的文本，单行 trim 到 200 字符
- 命中后用 \`open(parent_window_id="<search_window_id>", command="open_match", args={ index })\`
  spawn file_window；grep match 自动套上 [line ± 40] 切片便于看上下文

## 选用建议

要按**文件名**搜索请用 \`glob\`；grep 只做内容搜索。
`.trim();

export const grep_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Grep",
  description: GREP_DESCRIPTION,
  /** legacy alias */
  index: GREP_DESCRIPTION,
  sources: { grepSource, grepImplSource },
};
