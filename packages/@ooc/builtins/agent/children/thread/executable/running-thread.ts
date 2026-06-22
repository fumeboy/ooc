/**
 * 取「正在跑的那条 thread T」—— thread builtin 的 method / constructor / lifecycle / readable 作为
 * 「执行载体」需要它（既非 self=本对象 data、也非 args）。
 *
 * 归宿（thinkable-module issue 裁决 #7）：运行 thread 经 `ctx.ownerThread` 传入——由
 * `WindowManager.fromThread` 在构造 ExecutableContext / ConstructorContext / LifecycleContext /
 * ReadableContext 时注入（在其 runtime 中运行的那条线程）。取代 point-1 退潮期的抛错占位
 * （清掉 point-1 遗留的 deferred-red）。
 *
 * 两个变体：
 * - `runningThread(ctx)`：**抛**——给 executable 载体方法（end/new_feat_branch/create_pr/fork construct/unactive）。
 *   缺 ownerThread 是配置错误（这些方法只在 thinkloop 内被调、runtime 必注入），须 fail-loud。
 * - `runningThreadForRender(ctx)`：**返 undefined**——给 readable 投影。readable 每轮渲染都跑，
 *   原契约容忍「无 viewing thread → 降级（class=thread、不渲 transcript）」，故降级而非抛、不崩 render。
 */
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

/** 载体方法（executable/constructor/lifecycle）取运行 thread；缺 ownerThread fail-loud。 */
export function runningThread(ctx: { ownerThread?: ThreadContext }): ThreadContext {
  if (!ctx.ownerThread) {
    throw new Error(
      "[thread] runningThread(ctx)：ctx.ownerThread 缺失——thread 载体方法须在 WindowManager.fromThread " +
        "绑定的 runtime 下调用（construct/end/unactive 等）。",
    );
  }
  return ctx.ownerThread;
}

/** readable 投影专用：缺 ownerThread 时返 undefined → 走 readable 既有降级（不抛、不崩 render）。 */
export function runningThreadForRender(ctx: { ownerThread?: ThreadContext }): ThreadContext | undefined {
  return ctx.ownerThread;
}
