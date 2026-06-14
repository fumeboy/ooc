/**
 * exec tool — OOC 唯一的"调用命令"原语。
 *
 * 形态：
 *   exec(window_id?, method, args?, title, description?)
 *
 * - window_id 缺省 = agent 的 self 窗（agency 所在）；工具方法在成员对象窗（filesystem/terminal/world/knowledge_base）
 * - method 必须是 target window 注册的某个 method 名
 * - args 齐全 + 不引入新 path/knowledge 时立即执行；否则创建 MethodExecWindow（form），
 *   LLM 后续通过 \`exec(<form_id>, "refine"|"submit", ...)\` 推进
 *
 * 取代原 open / refine / submit 三件套：
 * - 旧 open 等价于 exec(parent_window_id, method, args)
 * - 旧 refine 现在是 MethodExecWindow 注册的 \`refine\` 方法，通过 exec(form_id, "refine", args={...}) 调
 * - 旧 submit 同理：MethodExecWindow.submit
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext, ProcessEvent } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { builtinRegistry, getOpenableMethods, ROOT_WINDOW_ID, WindowManager } from "../windows/index.js";
import type { ObjectRegistry } from "../windows/_shared/registry.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";
import { handleCompressTool } from "./compress.js";

export const EXEC_TOOL: LlmTool = {
  name: "exec",
  description:
    "在某 window 上调用一条 method。window_id 缺省为你自己（agent 的 self 窗，agency 所在）；工具方法在成员对象窗上。" +
    "若 args 齐全，立即执行并返回结果；若不齐全，会创建一个 method_exec form，" +
    "你可以通过后续 exec(form_id, \"refine\", args={...}) 累积参数、exec(form_id, \"submit\") 触发执行。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      window_id: {
        type: "string",
        description:
          "目标 window 的 id；缺省 = 你自己（agent 的 self 窗，agency 命令所在）。" +
          "工具方法在成员对象窗上：filesystem / terminal / world / knowledge_base —— 调它们的方法时 window_id 指向对应成员窗。" +
          "也可指向已有的 method_exec form id 来调它的 refine/submit 命令。",
      },
      method: {
        type: "string",
        // self 窗（agency + root misc）上可调的方法；成员窗 / 其它 window 上的方法
        // （filesystem.grep / terminal.program / talk_window.say / method_exec.refine|submit / custom）
        // 通过 enum 之外的 string 传入即可——schema 不强约束，运行时按 window_id 路由。
        // 惰性 getter：避免 module-eval 期就访问 ROOT_METHODS（循环 import 下会 TDZ；
        // EXEC_TOOL 是模块级 const，在 import 图某些加载顺序下 root/executable 尚未初始化完）。
        // 延迟到 schema 实际被序列化/读取时（彼时所有模块已加载）再计算。
        get enum() {
          return getOpenableMethods();
        },
        description:
          "要在 target window 上调用的 method 名。" +
          "你自己的 self 窗上有 agency：talk/plan/todo/end（+ example）。" +
          "talk 统一两形态：target=别的对象 ⇒ peer 会话；target=自己 ⇒ fork 一条子线程。" +
          "工具方法在成员对象窗上：filesystem 有 grep/glob/open_file/write_file；terminal 有 program；" +
          "world 有 create_object；knowledge_base 有 open_knowledge —— 调用时 window_id 指向对应成员窗。" +
          "（super flow 反思会话窗 reflect_request 另挂 new_feat_branch / create_pr_and_invite_reviewers 沉淀方法）" +
          "其它 window 上注册的方法（如 talk_window.say / talk_window.share / method_exec.refine|submit / custom 方法）" +
          "也通过本字段传入，运行时按 window_id 路由。" +
          "调整信息展示的通用方法（任意窗可用）：compress（折叠，args={scope:\"windows\"|\"events\",...}）/ expand（展开压缩窗）。",
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
  registry: ObjectRegistry = builtinRegistry,
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
  // exec 默认目标 = **agent 的 self 窗**（agency 已从 root 迁到 _builtin/agent；agent 的命令面是它自己，
  // 不是泛 root）。self 窗（id=objectId，class 经 ooc.class 链解析 agency + root misc）存在时默认它；
  // 否则回退 ROOT_WINDOW_ID（user / 无 self 窗的线程）。显式 window_id 始终优先。
  const selfId = thread.persistence?.objectId;
  const hasSelfWindow =
    !!selfId && (thread.contextWindows ?? []).some((w) => w?.id === selfId);
  const windowId =
    (args.window_id as string | undefined) ?? (hasSelfWindow ? selfId! : ROOT_WINDOW_ID);
  const nestedArgs = getArgs(args);

  // 通用 expand method：
  // 任何 compressLevel ≥ 1 的 window 自动获得 expand,无需在 registry 里给每个 type 注册。
  // 在 exec 路径上拦截 method="expand" 并对 target window 做 level → 0 的切换;
  // 落一条 context_compressed 事件,与 compress method 同协议。
  if (method === "expand") {
    return handleExpandMethod(thread, windowId);
  }

  // 通用 compress method：compress 从顶层 tool 降为 exec 调用的方法（稳定原语回到 3 个 = exec/close/wait）。
  // 与 expand 对称——调整信息展示是窗的方法，不是原语。复用 handleCompressTool 的全部逻辑：
  //   exec(method="compress", args={scope:"windows", target_ids:[...], level?})  折叠指定窗
  //   exec(method="compress", args={scope:"events", summary:"...", ...})         折叠事件流中段
  if (method === "compress") {
    return handleCompressTool(thread, nestedArgs);
  }

  const mgr = WindowManager.fromThread(thread, registry);
  const beforeIds = new Set(
    (thread.contextWindows ?? []).map((w) => w?.id).filter(Boolean) as string[],
  );

  let opened: { formId?: string; autoSubmitted: boolean; submitResult?: string; directResult?: string };
  try {
    opened = await mgr.openMethodExec({
      thread,
      parentWindowId: windowId,
      method: method,
      title,
      description,
      args: nestedArgs,
    });
  } catch (err) {
    return errorOutput(`exec 失败：${(err as Error).message}`);
  }

  thread.contextWindows = mgr.toData();

  if (opened.autoSubmitted) {
    const result = opened.directResult ?? opened.submitResult;
    if (!opened.formId) {
      // Direct exec (no form): return the result plainly.
      return successOutput(result ?? `Method ${method} 已执行。`, {
        method,
        executed: true,
        result,
      });
    }
    const createdWindowId = (thread.contextWindows ?? [])
      .map((w) => w?.id)
      .filter(
        (id): id is string => Boolean(id) && id !== opened.formId && !beforeIds.has(id),
      )[0];
    return successOutput(`Form ${opened.formId} 已基于完整参数立即执行；执行结果见下一轮 context。`, {
      form_id: opened.formId,
      executed: true,
      result,
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
function handleExpandMethod(thread: ThreadContext, windowId: string): string {
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

  // 窄化：contextWindows 契约层是 base[]；narrow 回 union[] 以匹配 next 的 union 元素类型。
  const next: ContextWindow[] = ((thread.contextWindows ?? []) as ContextWindow[]).map((w) =>
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
