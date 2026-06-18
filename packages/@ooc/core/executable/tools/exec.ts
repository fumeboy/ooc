/**
 * exec tool — OOC 唯一的"调用命令"原语。
 *
 * 形态：
 *   exec(window_id?, method, args?, title, description?)
 *
 * - window_id 缺省 = agent 的 self 窗（agency 所在）；工具方法在成员对象窗（filesystem/terminal/world/knowledge_base）
 * - method 必须是 target window 注册的某个 object method / window method 名
 * - args 由本次 exec 调用**直传**（Wave 4 裁决：form 收集机制废弃，不再经 method_exec 窗累积参数）
 *
 * 派发（WindowManager 三/四参契约）：
 * - object method（改 data / 副作用，含委托类经 ctx.runtime.instantiate 造子对象）→ execObjectMethod
 * - window method（只动展示投影态）→ execWindowMethod
 * - 两者皆无 → fail-loud（manager throw，本 tool 转成 ok:false）
 *
 * 通用展示方法（任意窗）：compress / expand —— 由本 tool 拦截，不下发 manager。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext, ProcessEvent } from "../../thinkable/context.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import { ROOT_WINDOW_ID } from "../../_shared/types/context-window.js";
import { builtinRegistry, type ObjectRegistry } from "../../runtime/object-registry.js";
import { WindowManager } from "../../runtime/window-manager.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";
import { handleCompressTool } from "./compress.js";

export const EXEC_TOOL: LlmTool = {
  name: "exec",
  description:
    "在某 window 上调用一条 method。window_id 缺省为你自己（agent 的 self 窗，agency 所在）；工具方法在成员对象窗上。" +
    "method 的业务参数经 args 直传；method 在目标窗上立即执行并返回结果。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      window_id: {
        type: "string",
        description:
          "目标 window 的 id；缺省 = 你自己（agent 的 self 窗，agency 命令所在）。" +
          "工具方法在成员对象窗上：filesystem / terminal / interpreter / knowledge_base / runtime —— 调它们的方法时 window_id 指向对应成员窗。",
      },
      method: {
        type: "string",
        description:
          "要在 target window 上调用的 method 名。" +
          "你自己的 self 窗上有 agency：talk/plan/todo/end（+ example）。" +
          "talk 统一两形态：target=别的对象 ⇒ peer 会话；target=自己 ⇒ fork 一条子线程。" +
          "工具方法在成员对象窗上：filesystem 有 grep/glob/open_file/write_file；terminal / interpreter 有 run；" +
          "runtime 有 create_object；knowledge_base 有 open_knowledge —— 调用时 window_id 指向对应成员窗。" +
          "其它 window 上注册的方法也通过本字段传入，运行时按 window_id 路由。" +
          "调整信息展示的通用方法（任意窗可用）：compress（折叠，args={scope:\"windows\"|\"events\",...}）/ expand（展开压缩窗）。",
      },
      description: {
        type: "string",
        description: "本次 exec 的意图说明；缺省时回退到 title。",
      },
      args: {
        type: "object",
        description: "method 的业务参数（直传给 method 的 exec）。",
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
): Promise<string> {
  const method = args.method as string | undefined;
  if (!method) {
    return errorOutput("exec 缺少 method 参数。");
  }
  const title = (args.title as string | undefined)?.trim();
  if (!title) {
    return errorOutput("exec 缺少 title 参数（所有 window 强制必填）。");
  }
  // exec 默认目标 = **agent 的 self 窗**（agency 已从 root 迁到 _builtin/agent；agent 的命令面是它自己，
  // 不是泛 root）。self 窗（id=objectId）存在时默认它；否则回退 ROOT_WINDOW_ID（user / 无 self 窗的线程）。
  // 显式 window_id 始终优先。
  const selfId = thread.persistence?.objectId;
  const hasSelfWindow =
    !!selfId && (thread.contextWindows ?? []).some((w) => w?.id === selfId);
  const windowId =
    (args.window_id as string | undefined) ?? (hasSelfWindow ? selfId! : ROOT_WINDOW_ID);
  const nestedArgs = getArgs(args);

  // 通用 expand method：
  // 任何 compressLevel ≥ 1 的 window 自动获得 expand；在 exec 路径上拦截 method="expand"
  // 并对 target window 做 level → 0 的切换，落一条 context_compressed 事件。
  if (method === "expand") {
    return handleExpandMethod(thread, windowId);
  }

  // 通用 compress method：compress 是"调整信息展示"的方法（非原语），经 exec 调用。与 expand 对称。
  if (method === "compress") {
    return handleCompressTool(thread, nestedArgs);
  }

  const mgr = WindowManager.fromThread(thread, registry);
  // 接线 persist leaf 刷盘回调：method 改 data / 改 context 后经 hooks eager 持久化。
  await mgr.attachPersistence(thread);
  const target = mgr.get(windowId);
  if (!target) {
    return errorOutput(`exec 失败：window ${windowId} 不存在。`);
  }

  // 派发：先 object method（改 data / 副作用），再 window method（展示投影态）。
  const isObjectMethod = !!registry.resolveObjectMethod(target.class, method);
  const isWindowMethod = !isObjectMethod && !!registry.resolveWindowMethod(target.class, method);
  if (!isObjectMethod && !isWindowMethod) {
    return errorOutput(
      `exec 失败：method "${method}" 未注册在 window ${windowId}（class=${target.class}）上。`,
    );
  }

  try {
    if (isObjectMethod) {
      const result = await mgr.execObjectMethod(windowId, method, nestedArgs, thread);
      thread.contextWindows = mgr.toData();
      return successOutput(result ?? `Method ${method} 已执行。`, {
        method,
        executed: true,
        result,
      });
    }
    // window method：执行并写回 win。
    await mgr.execWindowMethod(windowId, method, nestedArgs, thread);
    thread.contextWindows = mgr.toData();
    return successOutput(`Method ${method} 已执行（展示态已更新）。`, {
      method,
      executed: true,
    });
  } catch (err) {
    return errorOutput(`exec 失败：${(err as Error).message}`);
  }
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
 *
 * 注：compressLevel 是窗信封的展示态字段（Wave 4 后落在实例信封上）；旧 union 平铺字段已迁移，
 * 此处经 unknown 读取实例上的 compressLevel，等 readable/展示态 leaf 收口后归位。
 */
function handleExpandMethod(thread: ThreadContext, windowId: string): string {
  if (windowId === ROOT_WINDOW_ID) {
    return errorOutput("expand: 不能对 root window 调用 expand(root 永不压缩)。");
  }
  const insts = (thread.contextWindows ?? []) as OocObjectInstance[];
  const target = insts.find((w) => w.id === windowId);
  if (!target) {
    return errorOutput(`expand: window ${windowId} 不存在。`);
  }
  const current = ((target as { compressLevel?: 0 | 1 | 2 }).compressLevel ?? 0) as 0 | 1 | 2;
  if (current === 0) {
    return errorOutput(`expand: window ${windowId} 已经是 live (compressLevel=0),无需 expand。`);
  }

  const next: OocObjectInstance[] = insts.map((w) =>
    w.id === windowId ? ({ ...w, compressLevel: 0 } as OocObjectInstance) : w,
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
