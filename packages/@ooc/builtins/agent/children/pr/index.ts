/**
 * pr —— reviewer 评审窗 ooc class（reflectable 沉淀的 feat-branch PR）。
 *
 * 一处 `export const Class` 装配两维度（executable / readable）。pr **无 construct** —— 它不由 LLM
 * 显式构造，而是由 `deliverPrWindowToReviewers`（见 ./delivery.ts）在 create_pr_and_invite_reviewers
 * 开 PR 后投递创建（deferred_hooks：等 core 反推阶段给「runtime 投递创建实例」补正式入口）。
 * persistable 走系统默认（pr 对象 inline 进所属 thread 的 thread-context，不写独立 dir）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  executable,
  readable,
};

export type { Data } from "./types.js";

// 沉淀编排 + 投递：被 reflect_request finalizer / HTTP approve 端点 / reflectable barrel 复用。
export * from "./approval-flow.js";
export * from "./delivery.js";
