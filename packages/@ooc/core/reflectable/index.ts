/**
 * reflectable —— OOC reflectable 维度在 core 的 window 家族（交互面/前门）。
 *
 * 寄居于此的是 reflectable 的**交互面**（window class 注册），不是其存储层——
 * stone/pool 的 git versioning、PR-Issue 持久化、reviewer 冒泡纯函数仍在 `@ooc/core/persistable`，
 * reflectable 的 window 只渲染/驱动它们（face，非 god-object）。
 *
 * - `reflect-request/`：super flow 反思会话面 + 沉淀方法（new_feat_branch / create_pr_and_invite_reviewers）。
 * - `pr/`：reviewer 评审窗（approve / reject / request_changes）。
 *
 * 经 side-effect import 注册到 builtinRegistry；由 executable/windows/index.ts 引入本 barrel。
 */

import "./pr/index.js";
import "./reflect-request/index.js";
