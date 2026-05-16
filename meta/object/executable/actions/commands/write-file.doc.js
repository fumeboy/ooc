import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as writeFileSource from "@src/executable/windows/root/write-file";

const WRITE_FILE_DESCRIPTION = `
\`write_file\` 创建或完整覆盖一个文件，并自动 spawn 一个 file_window 指向它，
便于后续用 file_window.edit 做精确修改。

## 调用形式

\`\`\`
open(command="write_file", title="新建测试文件",
     args={ path: "tests/foo.test.ts", content: "import { it } from 'bun:test'; ..." })
\`\`\`

## 参数

| 参数    | 必填 | 说明 |
|---------|------|------|
| path    | 是   | 目标文件路径（绝对或工作目录相对）；父目录不存在会自动 mkdir -p |
| content | 是   | 完整文件内容（字符串；空字符串表示 0 字节文件）|

## 副作用

写盘成功后在 thread.contextWindows 下挂一个 type=file 的 window 指向 path，
LLM 可以直接 \`open(parent_window_id="<file_window_id>", command="edit", ...)\` 修改它。

## 与 program(shell) 的区别

不要用 \`program(language="shell", code="echo ... > ...")\` 创建文件——会失去 file_window 的
版本可见性，且转义容易出错。\`write_file\` 是创建/覆盖完整文件内容的首选；要改已有文件的部分
内容则用 \`file_window.edit\`。
`.trim();

export const write_file_v20260516_1 = {
  get parent() { return commands_v20260506_1; },
  name: "WriteFile",
  description: WRITE_FILE_DESCRIPTION,
  /** legacy alias */
  index: WRITE_FILE_DESCRIPTION,
  sources: { writeFileSource },
};
