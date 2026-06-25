/**
 * reflectable / pr-deliver —— feat-branch 提交后向 reviewer 投递 pr 评审窗。
 *
 * 流程：
 *   1. commitFeatAndDiff → 拿到 diff
 *   2. 遍历 reviewerObjectIds：在每个 reviewer 的 session 内
 *      - 找该 reviewer 拥有的所有 thread
 *      - 经 thread 的 ObjectInsRegistry instantiate 一个 pr object
 *      - 把 pr 加进 thread.contextWindows
 *
 * 这是「reflectable 写盘 → reviewer agent 自动看到 PR」的最后一公里。
 */
import {
  getSessionRegistry,
  iterateSessionObjectTable,
} from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID, PR_CLASS_ID } from "@ooc/core/types/constants.js";
import type { OocObjectInstance, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { saveObjectData } from "./runtime-object-io.js";

export interface PrDeliveryInput {
  baseDir: string;
  /** PR id —— 通常 = feat-branch 名（slug）。 */
  prId: string;
  /** feat-branch git 分支名（`feat/<slug>`）。 */
  branch: string;
  /** PR intent / description 文本（人读 + LLM 读）。 */
  intent: string;
  /** git diff 文本（patch）。 */
  diff: string;
  /** 投递目标：每个 reviewer 在哪个 sessionId 里活动 + reviewer object id。 */
  reviewers: Array<{ sessionId: string; objectId: string }>;
}

export interface PrDeliveryResult {
  /** 实际投递到的 (reviewer-objectId, thread-id, pr-windowId) 列表。 */
  delivered: Array<{ reviewer: string; threadId: string; prWindowId: string }>;
}

/** 向 reviewer 投递 pr 评审窗 —— 每个 reviewer 的所有活动 thread 都加一个 pr window。 */
export async function deliverPrToReviewers(
  input: PrDeliveryInput,
): Promise<PrDeliveryResult> {
  const delivered: PrDeliveryResult["delivered"] = [];

  for (const reviewer of input.reviewers) {
    const reg = getSessionRegistry(reviewer.sessionId);
    const ctor = reg.resolveConstructor(PR_CLASS_ID);
    if (!ctor) continue;

    // 找该 reviewer 拥有的所有非终态 thread
    const reviewerThreads: ThreadContext[] = [];
    iterateSessionObjectTable(reviewer.sessionId, (inst) => {
      if (inst.class !== THREAD_CLASS_ID) return;
      const t = inst.data as ThreadContext;
      if (t.calleeObjectId !== reviewer.objectId) return;
      if (t.status === "done" || t.status === "failed") return;
      reviewerThreads.push(t);
    });

    // 在每个 thread 内 instantiate pr object + 挂窗
    for (const thread of reviewerThreads) {
      const prId = `${input.prId}@${reviewer.objectId}#${thread.id}`;
      const prData = await ctor.exec(
        {
          sessionId: reviewer.sessionId,
          worldDir: input.baseDir,
          dir: "",
          args: { prId: input.prId, branch: input.branch, intent: input.intent, diff: input.diff },
        },
        { prId: input.prId, branch: input.branch, intent: input.intent, diff: input.diff },
      );
      const inst: OocObjectInstance = { id: prId, class: PR_CLASS_ID, data: prData };
      reg.setObject(inst);
      const ref: OocObjectRef = {
        id: prId,
        class: PR_CLASS_ID,
        createdAt: Date.now(),
        title: `PR ${input.prId}`,
      };
      thread.contextWindows.push(ref);
      // 把 thread 唤醒以便 LLM 看到
      if (thread.status === "waiting") thread.status = "running";
      // 持久化 thread + pr
      await saveObjectData(input.baseDir, reviewer.sessionId, inst, reg);
      const threadInst = reg.getObject(thread.id);
      if (threadInst) await saveObjectData(input.baseDir, reviewer.sessionId, threadInst, reg);
      delivered.push({ reviewer: reviewer.objectId, threadId: thread.id, prWindowId: prId });
    }
  }

  return { delivered };
}
