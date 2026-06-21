/**
 * exec tool — OOC 唯一的"调用命令"原语。
 *
 * 形态：
 *   exec(window_id?, method, args?, title, description?)
 *
 * - window_id 缺省 = agent 的 self 窗（agency 所在）；工具方法在成员对象窗（filesystem/terminal/world/knowledge_base）
 * - method 必须是 target window 注册的某个 object method / window method 名
 * - args 由本次 exec 调用**直传**给 method
 *
 * 派发（WindowManager 三/四参契约）：
 * - object method 声明了 route（填表式渐进执行）→ 工具边界先跑 route：未返回 quickSubmit 则建
 *   method_exec form 入 context（refine 累积参数 / submit 提交），不直执行；quickSubmit 直执行。
 * - object method（改 data / 副作用，含委托类经 ctx.runtime.instantiate 造子对象）→ execObjectMethod
 * - window method（只动展示投影态）→ execWindowMethod
 * - 两者皆无 → fail-loud（manager throw，本 tool 转成 ok:false）
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { ROOT_WINDOW_ID, objectDataOf, classOf } from "../../_shared/types/context-window.js";
import { getSessionObjectTable } from "../../runtime/session-object-table.js";
import { builtinRegistry, type ObjectRegistry } from "../../runtime/object-registry.js";
import { WindowManager } from "../../runtime/window-manager.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

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
          "其它 window 上注册的方法也通过本字段传入，运行时按 window_id 路由。",
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

  const mgr = WindowManager.fromThread(thread, registry);
  // 接线 persist leaf 刷盘回调：method 改 data / 改 context 后经 hooks eager 持久化。
  await mgr.attachPersistence(thread);
  const target = mgr.get(windowId);
  if (!target) {
    return errorOutput(`exec 失败：window ${windowId} 不存在。`);
  }

  // 派发：先 object method（改 data / 副作用），再 window method（展示投影态）。
  const targetClass = classOf(target);
  const isObjectMethod = !!registry.resolveObjectMethod(targetClass, method);
  const isWindowMethod = !isObjectMethod && !!registry.resolveWindowMethod(targetClass, method);
  if (!isObjectMethod && !isWindowMethod) {
    return errorOutput(
      `exec 失败：method "${method}" 未注册在 window ${windowId}（class=${targetClass}）上。`,
    );
  }

  try {
    if (isObjectMethod) {
      // 填表式渐进式执行：method 声明了 route 时，route 在工具边界先跑——未返回 quickSubmit
      // 则建 method_exec form 入 context（不直执行），把 tip 回给 LLM 渐进补参数。
      // route 只在此边界消费；form.submit 走 runtime.callMethod 回到 execObjectMethod（route-free，不递归）。
      const methodEntry = registry.resolveObjectMethod(targetClass, method)!;
      if (methodEntry.route) {
        const routeResult = await methodEntry.route(
          { thread, object: { id: target.id, class: targetClass }, runtime: mgr, args: nestedArgs },
          objectDataOf(target, getSessionObjectTable(thread)),
          nestedArgs,
        );
        if (!routeResult?.quickSubmit) {
          const formId = await mgr.instantiate("method_exec", {
            targetObjectId: windowId,
            method,
            description: methodEntry.description,
            accumulatedArgs: nestedArgs,
            tip: routeResult?.tip,
            intentPaths: routeResult?.intents,
            schema: methodEntry.schema,
            title,
          });
          thread.contextWindows = mgr.toData();
          const tipMsg =
            routeResult?.tip ??
            `已开启填表 form ${formId}：refine 补参数、submit 提交执行。`;
          return successOutput(tipMsg, { method, formId, form: true });
        }
        // quickSubmit → 落到下方直执行（与无 route 的 method 同路径）。
      }
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
