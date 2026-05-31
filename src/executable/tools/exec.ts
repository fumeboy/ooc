/**
 * exec tool — OOC 唯一的"调用 method"原语（plan exec-refactor）。
 *
 * 形态：
 *   exec(window_id?, method, args?, title, description?)
 *
 * - window_id 缺省 = "root"；root 上注册了今天 commands/ 目录的全部 method
 * - method 必须是 target window 注册的某个 method 名
 * - args 齐全 + 不引入新 path/knowledge 时立即执行；否则创建 CommandExecWindow（form），
 *   LLM 后续通过 \`exec(<form_id>, "refine"|"submit", ...)\` 推进
 *
 * 取代原 open / refine / submit 三件套：
 * - 旧 open 等价于 exec(parent_window_id, method, args)
 * - 旧 refine 现在是 CommandExecWindow 注册的 \`refine\` method，通过 exec(form_id, "refine", args={...}) 调
 * - 旧 submit 同理：CommandExecWindow.submit
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext, ProcessEvent } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { getOpenableCommands, ROOT_WINDOW_ID, WindowManager } from "../windows/index.js";
import { enrichProgramFormCommand } from "../server/enrich.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const EXEC_TOOL: LlmTool = {
  name: "exec",
  description:
    "在某 window 上调用一条 method。window_id 缺省为 root（即 root 上的全局 method）。" +
    "若 args 齐全，立即执行并返回结果；若不齐全，会创建一个 command_exec form，" +
    "你可以通过后续 exec(form_id, \"refine\", args={...}) 累积参数、exec(form_id, \"submit\") 触发执行。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      window_id: {
        type: "string",
        description:
          "目标 window 的 id；缺省 = root（当前 thread 的根 window）。也可指向已有的 command_exec form id 来调它的 refine/submit method。",
      },
      method: {
        type: "string",
        // root 上可调的 method；非 root 的 window 上的 method（如 do_window.continue / 自定义 custom methods /
        // command_exec.refine|submit）通过 enum 之外的 string 传入即可——schema 不强约束。
        enum: getOpenableCommands(),
        description:
          "要在 target window 上调用的 method 名。" +
          "root 上典型有 do/talk/program/plan/end/todo/open_file/open_knowledge/write_file/glob/grep/metaprog 等；" +
          "其它 window 上注册的 method（如 do_window.continue / talk_window.say / form 自身的 refine/submit / custom method）" +
          "也通过本字段传入，运行时按 window_id 路由。",
      },
      description: {
        type: "string",
        description: "本次 exec 的意图说明；缺省时回退到 title。",
      },
      args: {
        type: "object",
        description:
          "method 的业务参数；如果不知道填什么可以留空，args 不齐时系统会创建 form 并注入相关参数提示。",
      },
      mark: MARK_PARAM,
    },
    required: ["title", "method"],
  },
};

function getArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nested = args.args;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

const successOutput = (message: string, extra?: Record<string, unknown>) =>
  JSON.stringify({ ok: true, tool: "exec", message, ...(extra ?? {}) });
const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "exec", error });

export async function handleExecTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string | void> {
  const method = args.method as string | undefined;
  if (!method) {
    return errorOutput("exec 缺少 method 参数。");
  }
  const title = (args.title as string | undefined)?.trim();
  if (!title) {
    return errorOutput("exec 缺少 title 参数（所有 window 强制必填）。");
  }
  const description = (args.description as string | undefined) ?? title;
  const windowId = (args.window_id as string | undefined) ?? ROOT_WINDOW_ID;
  const nestedArgs = getArgs(args);

  // 通用 expand method (design: docs/2026-05-25-context-compression-design.md §4.1 / §D 可逆性):
  // 任何 compressLevel ≥ 1 的 window 自动获得 expand,无需在 registry 里给每个 type 注册。
  // 在 exec 路径上拦截 method="expand" 并对 target window 做 level → 0 的切换;
  // 落一条 context_compressed 事件,与 compress tool 同协议。
  if (method === "expand") {
    return handleExpandCommand(thread, windowId);
  }

  const mgr = WindowManager.fromThread(thread);
  const beforeIds = new Set(
    (thread.contextWindows ?? []).map((w) => w?.id).filter(Boolean) as string[],
  );

  let opened: { formId: string; autoSubmitted: boolean; submitResult?: string };
  try {
    opened = await mgr.openCommandExec({
      thread,
      parentWindowId: windowId,
      // openCommandExec 参数名仍是 command（method 沿链解析的 dispatch key）；
      // 写入 form 后字段名是 form.method（L6c-5 改名完成，与输入 arg key method 对齐）。
      command: method,
      title,
      description,
      args: nestedArgs,
    });
  } catch (err) {
    return errorOutput(`exec 失败：${(err as Error).message}`);
  }

  // program method 额外补 method 签名 knowledge（沿用旧 enrichProgramForm 行为）
  const targetForm = mgr.get(opened.formId);
  if (targetForm && targetForm.type === "command_exec" && targetForm.method === "program") {
    await enrichProgramFormCommand(targetForm, thread);
  }

  thread.contextWindows = mgr.toData();

  if (opened.autoSubmitted) {
    const createdWindowId = (thread.contextWindows ?? [])
      .map((w) => w?.id)
      .filter(
        (id): id is string => Boolean(id) && id !== opened.formId && !beforeIds.has(id),
      )[0];
    return successOutput(`Form ${opened.formId} 已基于完整参数立即执行；执行结果见下一轮 context。`, {
      form_id: opened.formId,
      executed: true,
      result: opened.submitResult,
      ...(createdWindowId ? { window_id: createdWindowId } : {}),
    });
  }
  return successOutput(
    `Form ${opened.formId} 已创建（${method}）。后续用 exec(form_id, "refine", args={...}) 或 exec(form_id, "submit") 推进；不再需要时 close(form_id)。`,
    { form_id: opened.formId, executed: false },
  );
}

/**
 * expand method — 把 compressLevel ≥ 1 的 window 切回 0 (live)。
 *
 * 由 handleExecTool 在 method === "expand" 分支调用。生效条件:
 * - 目标 window 存在 (非 root)
 * - 目标 window 当前 compressLevel ≥ 1
 * 否则返回 ok=false 让 LLM 看见(silent-swallow ban)。
 *
 * 切档不可变写回 thread.contextWindows,并落一条 context_compressed 事件
 * (reason="user-expand", levelChange="<old>→0")。
 */
function handleExpandCommand(thread: ThreadContext, windowId: string): string {
  if (windowId === ROOT_WINDOW_ID) {
    return errorOutput("expand: 不能对 root window 调用 expand(root 永不压缩)。");
  }
  const target = (thread.contextWindows ?? []).find((w) => w.id === windowId);
  if (!target) {
    return errorOutput(`expand: window ${windowId} 不存在。`);
  }
  const current = (target.compressLevel ?? 0) as 0 | 1 | 2;
  if (current === 0) {
    return errorOutput(`expand: window ${windowId} 已经是 live (compressLevel=0),无需 expand。`);
  }

  const next: ContextWindow[] = (thread.contextWindows ?? []).map((w) =>
    w.id === windowId ? ({ ...w, compressLevel: 0 } as ContextWindow) : w,
  );
  thread.contextWindows = next;

  const event: ProcessEvent = {
    category: "context_change",
    kind: "context_compressed",
    windowIds: [windowId],
    levelChange: `${current}→0`,
    reason: "user-expand",
    scope: "windows",
  };
  thread.events.push(event);

  return successOutput(`window ${windowId} 已 expand 回 live (compressLevel ${current} → 0)。`, {
    window_id: windowId,
    previous_level: current,
    current_level: 0,
  });
}
