/**
 * root.program command — 委托到 program_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.program 的构造逻辑（runOneExec + ProgramWindow build）已迁到
 * packages/@ooc/builtins/program/executable/index.ts 的 kind="constructor" program method。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("program") 委托。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 program_window constructor 注册
import "@ooc/builtins/program";

const PROGRAM_BASIC_PATH = "internal/executable/program/basic";
const PROGRAM_INPUT_PATH = "internal/executable/program/input";
const PROGRAM_FORM_STATUS_PATH = "internal/executable/program/form-status";

const KNOWLEDGE = `
program 用于执行一段 shell / ts / js 代码；submit 后产出一个 program_window，
首次 exec 立即跑完，结果进 program_window.history。后续 exec 通过该 window 的
\`exec\` command 触发。

参数（首次 exec）：
- language: shell / ts / js（与 code 配合，必填）
- code: 待执行代码字符串（必填）

shell 环境变量：
- shell 命令的 cwd 是 OOC 进程的工作目录
- 想读写自己的 stone 目录（self.dir），用 env $OOC_SELF_DIR

ts/js 上下文：
- self.dir / self.callMethod(windowId, command, args?) / self.getData / self.setData 可用
- 跨 exec 共享：self.getThreadLocal(key) / self.setThreadLocal(key, value)
- shell 之间不共享 threadLocal（OS 进程隔离），需要时自行写入 stone data

后续多次执行：
- exec(window_id="<program_window_id>", method="exec", args={ language, code })

调用示例：
exec(method="program", title="统计 ts 文件数量", args={ language: "shell", code: "find src -name '*.ts' | wc -l" })

要调任意 window 上的命令请直接用顶层 \`exec\` tool（不再走 program）；
ts/js sandbox 内仍可 \`await self.callMethod("custom:<self>", "<name>", {...})\` 编排多步调用。

## 建议

- 修改已有文件优先使用 \`file_window.edit\`（在已 open 的 file_window 上做 oldString→newString 精确替换；支持 atomic 多点修改）
- 新建文件优先使用 \`root.write_file\`（一步写盘 + 自动 spawn file_window）
- 搜索文件名优先使用 \`root.glob\`；搜索文件内容优先使用 \`root.grep\`（结果是结构化 search_window，可被 open_match 直接打开）
- \`program(language="shell")\` 适合临时计算 / 不修改 worktree 的探查（统计、查询版本、跑测试）；**不要用 shell sed / awk / cat-redirect 改文件**——会失去 file_window 的版本可见性，且转义容易出错
`.trim();

export enum ProgramMethodPath {
  Program = "program",
  Shell = "program.shell",
  TypeScript = "program.typescript",
  JavaScript = "program.javascript",
}


export const programMethod: ObjectMethod = {
  paths: [
    ProgramMethodPath.Program,
    ProgramMethodPath.Shell,
    ProgramMethodPath.TypeScript,
    ProgramMethodPath.JavaScript,
  ],
  schema: {
    args: {
      language: { type: "string", required: true, description: "shell / ts / js", enum: ["shell", "ts", "typescript", "js", "javascript"] },
      lang: { type: "string", required: false, description: "language 的别名" },
      code: { type: "string", required: true, description: "待执行代码字符串" },
    },
  } as MethodCallSchema,
  intent: (args): Intent[] => {
    const r: Intent[] = [];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") r.push({ name: ProgramMethodPath.Shell });
    if (lang === "ts" || lang === "typescript") r.push({ name: ProgramMethodPath.TypeScript });
    if (lang === "js" || lang === "javascript") r.push({ name: ProgramMethodPath.JavaScript });
    return r;
  },
  onFormChange(change, { form, intents }) {
    // program 是 status_changed 特例：不同于其它 method（form 完成即移除、non-open 无需 guidance），
    // program 在 executing/success/failed 各有专属引导（见下 formStatus 分支），故**不**早返回 non-open。
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [PROGRAM_BASIC_PATH]: KNOWLEDGE };
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";

    if (formStatus === "executing") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 executing 状态的 form，应等待 result 写入后再继续，不要再次 refine 或 submit。";
      return buildGuidanceWindows(form, entries);
    }
    if (formStatus === "success") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 success 状态的 form，结果已成功生成；form 将自动从 context 移除。";
      return buildGuidanceWindows(form, entries);
    }
    if (formStatus === "failed") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 failed 状态的 form，先阅读 result 排查错误：可 refine(form_id, args={ language, code }) 修正参数后重 submit（form 会自动切回 open），或 close(form_id, reason=...) 彻底放弃。";
      return buildGuidanceWindows(form, entries);
    }

    if (lang && code) {
      entries[PROGRAM_INPUT_PATH] = "program 参数已具备；submit 即创建 program_window 并执行。";
      return buildGuidanceWindows(form, entries);
    }

    const missing: string[] = [];
    if (!lang) missing.push("language");
    if (!code) missing.push("code");
    entries[PROGRAM_INPUT_PATH] =
      `program 还缺以下参数: ${missing.join(", ")}。\n` +
      "请用 refine(form_id, args={ language: \"shell\" | \"ts\" | \"js\", code: \"<待执行代码>\" }) 补齐后 submit(form_id)。\n" +
      "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeProgramMethod(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 program_window constructor。
 */
export const executeProgramMethod = makeRootDelegator({
  method: "program",
  constructorKind: "program",
  objectLabel: "program_window",
});
