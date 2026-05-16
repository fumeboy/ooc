import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as globSource from "@src/executable/windows/root/glob";

const GLOB_DESCRIPTION = `
\`glob\` 按文件名通配符（glob pattern）查找文件；结果作为 search_window kind=glob 留在 context。

## 调用形式

\`\`\`
open(command="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })
\`\`\`

## 参数

| 参数    | 必填 | 说明 |
|---------|------|------|
| pattern | 是   | glob 通配符（\`src/**/*.ts\`、\`*.md\`、\`tests/**/*\` 等）|
| cwd     | 否   | 搜索根目录；缺省为当前工作目录 |

## 行为

- 用 Bun 内置 Glob 扫描；只返回文件（onlyFiles=true）
- 按 path 字典序排序；超过 200 条截断（search_window.truncated=true）
- 命中后用 \`open(parent_window_id="<search_window_id>", command="open_match", args={ index })\`
  在该 match 对应的文件上 spawn file_window

## 选用建议

要按**文件内容**搜索请用 \`grep\`；glob 只是文件名匹配。
`.trim();

export const glob_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Glob",
  description: GLOB_DESCRIPTION,
  /** legacy alias */
  index: GLOB_DESCRIPTION,
  sources: { globSource },
};
