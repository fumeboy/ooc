/**
 * TODO(thread-core-boundary)：thread 自己的 method / constructor / lifecycle / readable 作为
 * 「执行载体」需要**正在跑的那条 thread T**——既非 self（self=本对象 data）也非 args。
 *
 * 点 1 退潮已把 `thread: ThreadContext` 从泛型 object↔core 契约（Executable/Readable/Constructor/
 * Lifecycle Context）删除。T 的新获取路径（say 单写读侧 / peer-ref substrate / enqueueThread /
 * onChildTerminal 重投影）属本 issue 后续点，尚未接入。
 *
 * 两个变体：
 * - `runningThread(ctx)`：**抛**——给 executable 载体方法（say/end/new_feat_branch/create_pr/fork
 *   construct/unactive）。这些只在被调用时跑，缺 T 不能产错值，须 fail-loud。
 * - `runningThreadForRender(ctx)`：**返 undefined**——给 readable 投影。readable 每轮渲染都跑，
 *   原契约本就容忍「无 viewing thread → 降级（class=thread、不渲 transcript）」，故降级而非抛，
 *   保持 main 可渲染、可启动（不因缺 T 让整条 render 崩）。
 *
 * 落地验收须清零本 helper 的所有调用点。
 */
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import { TODO } from "@ooc/core/_shared/utils/todo.js";

export function runningThread(_ctx: unknown): ThreadContext {
  return TODO("thread builtin 载体方法获取运行 thread T");
}

/** readable 投影专用：缺 T 时返 undefined → 走 readable 既有降级（不抛、不崩 render）。 */
export function runningThreadForRender(_ctx: unknown): ThreadContext | undefined {
  return undefined;
}
