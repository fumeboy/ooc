/**
 * reflectable —— 按 reflectable 概念查代码的**源码索引**（非实现）。
 *
 * reflectable 维度的 builtin 窗类已物理迁出 core，成为正式 ooc class 包：
 *   - `@ooc/builtins/reflect_request`：super flow 反思会话面 + 沉淀方法
 *     （new_feat_branch / create_pr_and_invite_reviewers）。
 *   - `@ooc/builtins/pr`：reviewer 评审窗（approve / reject / request_changes）+ 投递 / 审批编排
 *     （deliverPrWindowToReviewers / applyPrApproval / routePrRepairMessage）。
 *
 * 存储层（stone/pool 的 git versioning、PR-Issue 持久化、reviewer 冒泡纯函数）仍在
 * `@ooc/core/persistable`——reflectable 的 window 只渲染/驱动它们（face，非 god-object）。
 *
 * 此 barrel 仅作 side-effect 索引：re-export 两个 builtin 包以触发 registerWindowClass。
 * 由 runtime/register-builtins.ts 引入，保证 side-effect 注册在 load 期触发。
 */

// side-effect-only import：两个包都各自 export `Class` / `Data`，re-export 会撞名；
// 本 barrel 只为触发 registerWindowClass 的注册副作用，不转出任何符号。
import "@ooc/builtins/pr/index.js"; // side-effect: registerWindowClass("pr")
import "@ooc/builtins/reflect_request/index.js"; // side-effect: registerWindowClass("reflect_request")
