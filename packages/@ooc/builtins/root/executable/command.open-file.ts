/**
 * root.open_file command — 委托到 file_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.open_file 的构造逻辑（path 校验 + FileWindow build）已迁到
 * packages/@ooc/builtins/file/executable/index.ts 的 kind="constructor" file method（command 分发）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("file") 委托。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 file_window constructor 注册
import "@ooc/builtins/file";

const OPEN_FILE_BASIC_PATH = "internal/executable/open_file/basic";
const OPEN_FILE_INPUT_PATH = "internal/executable/open_file/input";

const KNOWLEDGE = `
open_file 用于把某个文件的内容作为 file_window 引入 context（持续可见，每轮重新读）。

参数：
- path: 必填，文件路径（绝对，或相对 session baseDir）
- lines: 可选 [start, end] 行范围
- columns: 可选 [start, end] 列范围

后续操作：
- 调整范围：open(parent_window_id="<file_window_id>", command="set_range", args={ lines: [...] })
- 关闭：close(window_id="<file_window_id>")

调用示例：
open(command="open_file", title="读 README", args={ path: "README.md", lines: [0, 200] })
`.trim();

export const openFileCommand: CommandTableEntry = {
  paths: ["open_file"],
  match: () => ["open_file"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [OPEN_FILE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[OPEN_FILE_INPUT_PATH] =
        "open_file 还缺以下参数: path。\n" +
        "请用 refine(form_id, args={ path: \"<file path>\", lines?: [start,end], columns?: [start,end] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeOpenFileCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 file_window constructor（dispatch on form.command="open_file"）。
 *
 * 注入一个最小 form shim（{ command: "open_file" }）到 ctx，让 constructor 的
 * dispatch 分支拿到正确的 command 名（生产链路里 manager.submit 会传完整 form）。
 */
export async function executeOpenFileCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("file");
  if (!ctor) return "[open_file] file_window constructor 未注册（registry 期望 kind=\"constructor\" 的 file method）。";
  const ctxWithForm = ctx.form
    ? ctx
    : ({ ...ctx, form: { command: "open_file" } } as CommandExecutionContext);
  return await ctor.exec(ctxWithForm);
}
