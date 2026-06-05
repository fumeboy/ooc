/**
 * root.write_file command — 委托到 file_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.write_file 的构造逻辑（path/content 校验 + versioned/non-versioned
 * 写盘 + spawn FileWindow + preExisted hint）已迁到 packages/@ooc/builtins/file/executable/index.ts
 * 的 kind="constructor" file method（dispatch on form.command="write_file"）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("file") 委托。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 file_window constructor 注册（lookupConstructor("file") 命中）
import "@ooc/builtins/file";

const WRITE_FILE_BASIC_PATH = "internal/executable/write_file/basic";
const WRITE_FILE_INPUT_PATH = "internal/executable/write_file/input";

const KNOWLEDGE = `
write_file = **整文件覆盖**。只在下列两种场景使用：

1. **新建一个还不存在的文件**（path 在磁盘上不存在）
2. **完整重写一个已存在文件**（你确实要丢弃旧内容、用新内容全部替代）

**修改已有文件的局部内容 → 必须用 file_window.edit，不要用 write_file**
- 原因 1（正确性）：write_file 要你重发整个文件，任何漏掉的字符或顺序错位都会
  造成静默丢失；edit 用"精确唯一字符串替换"保证只动你指定的位置
- 原因 2（成本）：edit 只送 old/new 两段；write_file 要送整文件，长文件可能上千行
- 原因 3（可见性）：失败的 edit 给出准确错误（哪条 edit、为什么、几次匹配），write_file
  失败你只会看到一个 path 错

典型反模式（**不要这样做**）：
- 用户说"把 src/foo.ts 里第一处 X 改成 Y" → 你 open_file 后直接 write_file 整篇
  → 应该 \`open_file\` → \`open(parent_window_id=<file_window>, command="edit",
  args={old: "X 的局部唯一上下文", new: "Y 的对应上下文"})\`

## 参数

- path: 必填，目标文件路径（绝对，或相对 session baseDir）。父目录不存在会自动 mkdir -p
- content: 必填，要写入的完整文件内容（字符串；空字符串表示写一个 0 字节文件）

## 副作用

- 写盘成功 → 在 thread.contextWindows 下挂一个 type=file 的 window 指向 path
- 失败（权限不足 / 路径不合法）→ 返回错误字符串，不留 file_window，不写盘

## 调用示例（合法场景：新建）

\`\`\`
open(command="write_file", title="新建测试文件",
     args={ path: "tests/foo.test.ts", content: "import { it } from 'bun:test'; ..." })
\`\`\`

## 大文件分段产出（避免单轮超时）

产出较大文件（完整 UI 页面 / 长文档 / 多 section 模块）时，**不要一次 write_file 灌入整页**——
单轮生成超长 content 会触发 LLM 输出超时，最坏 0 产物失败。改为两步：

1. write_file 先写**骨架**：结构框架 + 各 section 的标题/空壳/占位（短而完整）
2. 再对生成的 file_window 逐段 \`edit\`：把每个 section 的空壳替换成真实内容（见 file_window.edit）

骨架 + 分段填充让每一轮输出都短、可恢复、可见。

## 不要用 shell 替代

不要用 \`program(language="shell", code="echo ... > ...")\` 做这件事——会失去
file_window 的版本可见性，且转义容易出错。
`.trim();


export const writeFileCommand: ObjectMethod = {
  paths: ["write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "目标文件路径（绝对，或相对 session baseDir）" },
      content: { type: "string", required: true, description: "要写入的完整文件内容" },
    },
  } as MethodCallSchema,
  intent: emptyIntent,
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [WRITE_FILE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const path = typeof args.path === "string" ? args.path : "";
    const hasContent = typeof args.content === "string";
    if (!path || !hasContent) {
      const missing: string[] = [];
      if (!path) missing.push("path");
      if (!hasContent) missing.push("content");
      entries[WRITE_FILE_INPUT_PATH] =
        `write_file 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ path: \"<path>\", content: \"<完整文件内容, 可空串>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeWriteFileCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 file_window constructor（dispatch on form.command="write_file"）。
 *
 * 注入一个最小 form shim（{ command: "write_file" }）到 ctx，让 constructor 的
 * dispatch 分支拿到正确的 command 名（生产链路里 manager.submit 会传完整 form）。
 */
export const executeWriteFileCommand = makeRootDelegator({
  command: "write_file",
  constructorKind: "file",
  objectLabel: "file_window",
  formCommand: "write_file",
});
