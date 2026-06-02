/**
 * root.glob command — 委托到 search_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.glob 的构造逻辑（Bun Glob scan + SearchWindow build）已迁到
 * packages/@ooc/builtins/search/executable/index.ts 的 kind="constructor" search method
 * （dispatch on form.command="glob"）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("search") 委托。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 search_window constructor 注册
import "@ooc/builtins/search";

const GLOB_BASIC_PATH = "internal/executable/glob/basic";
const GLOB_INPUT_PATH = "internal/executable/glob/input";

const KNOWLEDGE = `
glob 用于按文件名通配符（glob pattern）查找文件，并把结果作为 search_window 留在 context。

参数：
- pattern: 必填，glob 通配符。例：\`src/**/*.ts\`、\`*.md\`、\`tests/**/*\`
- cwd: 可选，搜索根目录（相对路径以 session baseDir 为根）；缺省 = session baseDir

行为：
- 用 Bun 内置 Glob 扫描文件系统；只返回文件（onlyFiles=true）
- 命中按 path 字典序排序；超过 200 条截断，search_window.truncated=true
- 命中之后用 \`open(parent_window_id="<search_window_id>", command="open_match", args={ index: <N> })\`
  在该 match 对应的文件上 spawn file_window

调用示例：

\`\`\`
open(command="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })
\`\`\`

注意：
- 这是文件名匹配；要按文件**内容**搜索请用 \`grep\`
- 结果集 ≥ 200 时建议把 pattern 改更精确（本期不提供 next_page）
`.trim();

export const globCommand: CommandTableEntry = {
  paths: ["glob"],
  match: () => ["glob"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [GLOB_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) {
      entries[GLOB_INPUT_PATH] =
        "glob 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<glob-string>\", cwd?: \"<dir>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeGlobCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 search_window constructor（dispatch on form.command="glob"）。
 */
export async function executeGlobCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("search");
  if (!ctor) return "[glob] search_window constructor 未注册（registry 期望 kind=\"constructor\" 的 search method）。";
  const ctxWithForm = ctx.form
    ? ctx
    : ({ ...ctx, form: { command: "glob" } } as CommandExecutionContext);
  return await ctor.exec(ctxWithForm);
}
