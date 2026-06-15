/**
 * reflectable —— 按 reflectable 概念查代码的**源码索引**（非实现）。
 *
 * reflectable 维度的 builtin 窗类已物理迁出 core，成为正式 ooc class 包：
 *   - `@ooc/builtins/agent/pr`：reviewer 评审窗（approve / reject / request_changes）+ 投递 / 审批编排
 *     （deliverPrWindowToReviewers / applyPrApproval / routePrRepairMessage）。
 *
 * 注：`reflect_request` 已不再是注册 class——它是 thread 在 super flow 视角下的**投影 class**
 * （由 thread readable 的 computeProjectionClass 动态算，见 thinkable knowledge/thread.md），
 * 故无独立包、无注册副作用；原 `@ooc/builtins/reflect_request` 包已退役（退潮清理 dangling import）。
 *
 * 存储层（stone/pool 的 git versioning、PR-Issue 持久化、reviewer 冒泡纯函数）仍在
 * `@ooc/core/persistable`——reflectable 的 window 只渲染/驱动它们（face，非 god-object）。
 *
 * 此 barrel 仅作 side-effect 索引：import pr 包以触发其 registerWindowClass。
 * 由 runtime/register-builtins.ts 引入，保证 side-effect 注册在 load 期触发。
 */

// side-effect-only import：pr 包 export `Class` / `Data`，re-export 会撞名；
// 本 barrel 只为触发 registerWindowClass 的注册副作用，不转出任何符号。
import "@ooc/builtins/agent/pr/index.js"; // side-effect: registerWindowClass("pr")
