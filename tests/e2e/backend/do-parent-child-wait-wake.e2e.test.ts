/**
 * S(L6b) — do parent↔child reload-crossing 安全网（child→parent 显式回报跨持久化往返）
 *
 * 这是 L6b do 塌缩的**关键路径测试网**：验证一个 parent thread fork child（do, wait=true）
 * 后，parent + child 各自 writeThread 落盘，再把 parent **全新 readThread 加载**（模拟 worker
 * 把 parent re-enqueue 时从磁盘重建线程树），此时：
 *   1. 重建出的树里 child 的 _parentThreadRef 必须重新指向 restored parent（D5：readThread
 *      在 persistable 层 supplement 该运行时反向引用——兑现 helpers.ts:52-53「recovery 由
 *      persistable 层负责」的契约）。
 *   2. child 经 deliverDoMessage(target=parentId) 向上回报时，findThreadInScope 沿
 *      _parentThreadRef 上行能命中 restored parent → parent.inbox 增长（显式 reply 跨 reload 可用）。
 *
 * 为什么必须有：_parentThreadRef 是 root.do fork 时建立的**运行时**反向引用，不持久化
 * （thread.json strip）。reload 后的树若不重建它，child→parent 显式 do_continue 会静默断
 * （findThreadInScope 上行无路）。本测试是该 gap 的唯一网兜（feasibility review Critical 4）。
 *
 * 不依赖真 LLM：全程直调 executeDoCommand / writeThread / readThread / deliverDoMessage，
 * 仅受 RUN_BACKEND_E2E gate 约束（与其它 backend e2e 同 gate，不需 OOC_API_KEY）。
 *
 * 评分（per meta/engineering/how_to_test/strategy.md §2）：
 * - Bad：reload 后 child._parentThreadRef 缺失 / child→parent 回报后 parent.inbox 未增长。
 * - Good：_parentThreadRef 重建指向 restored parent + 回报写进 parent.inbox + 消息内容一致。
 *
 * 单跑：
 *   RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 \
 *     bun test tests/e2e/backend/do-parent-child-wait-wake.e2e.test.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
// side-effect: 触发 windows 注册（do method 等）
import "@src/executable/windows";
import { execRootMethod } from "@src/executable/windows";
import { deliverDoMessage } from "@src/executable/windows/do/deliver";
import {
  createFlowObject,
  writeThread,
  readThread,
  type ThreadPersistenceRef,
} from "@src/persistable";
import { makeThread } from "@src/__tests__/make-thread";
import { scoreScenario, logScore, shouldRunBackendE2E } from "./_fixture";
import type { ThreadContext } from "@src/thinkable/context";

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] do parent↔child reload-crossing wait/wake", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it(
    "parent fork child(wait) → writeThread 双落盘 → readThread(parent) 重建 _parentThreadRef → child 回报命中 parent.inbox",
    async () => {
      tempRoot = await mkdtemp(join(tmpdir(), "ooc-e2e-do-reload-"));
      const baseDir = tempRoot;
      await createFlowObject({ baseDir, sessionId: "s", objectId: "agent" });

      const parentRef: ThreadPersistenceRef = { baseDir, sessionId: "s", objectId: "agent", threadId: "root" };
      const parent = makeThread({ id: "root", persistence: parentRef });

      // parent fork child（wait=true）—— executeDoCommand 建 child + 父侧 do_window +
      // child._parentThreadRef（运行时反向引用）。
      await execRootMethod("do", {
        thread: parent,
        args: { msg: "请处理告警", wait: true },
      });
      const childId = parent.childThreadIds![0]!;
      const child = parent.childThreads![childId]!;
      // child 的 persistence 由 deriveChildPersistence 派生（objectId 同 parent，threadId=childId）。
      expect(child.persistence?.threadId).toBe(childId);

      // 双落盘：parent.thread.json 会序列化 childThreads 子树（_parentThreadRef 因 non-enumerable 被 strip）。
      await writeThread(parent);
      await writeThread(child);

      // 模拟 worker re-enqueue parent：全新从磁盘加载（内存中那条 _parentThreadRef 链不复存在）。
      const restored = (await readThread(parentRef, "root")) as ThreadContext;
      const restoredChild = restored.childThreads?.[childId];

      // D5：readThread 在 persistable 层重建树内 child 的 _parentThreadRef → 指向 restored parent。
      const refRebuilt = restoredChild?._parentThreadRef === restored;

      // child 经 deliverDoMessage 向 parent 回报（target=parentId）：findThreadInScope 沿
      // 重建后的 _parentThreadRef 上行命中 restored parent，写 parent.inbox。
      const parentInboxBefore = restored.inbox?.length ?? 0;
      let deliverError: string | undefined;
      if (restoredChild) {
        deliverError = deliverDoMessage(restoredChild, restored.id, "已处理完毕：见 memo/x.md", false);
      }
      const parentInboxAfter = restored.inbox?.length ?? 0;
      const inboxGrew = parentInboxAfter > parentInboxBefore;
      const replyLanded = (restored.inbox ?? []).some((m) => m.content.includes("已处理完毕"));

      const result = scoreScenario({
        scenario: "do parent↔child reload-crossing reply",
        bad: [
          { name: "reload 后 child 缺失（树未重建）", check: () => !restoredChild },
          { name: "reload 后 child._parentThreadRef 未指向 restored parent", check: () => !refRebuilt },
          { name: "child→parent 回报后 parent.inbox 未增长（findThreadInScope 上行断裂）", check: () => !inboxGrew },
        ],
        good: [
          { name: "_parentThreadRef 重建指向 restored parent", check: () => refRebuilt },
          { name: "回报命中 parent.inbox", check: () => inboxGrew },
          { name: "回报内容一致", check: () => replyLanded },
          { name: "deliverDoMessage 无 explicit 错误串", check: () => deliverError === undefined },
        ],
      });

      logScore(result, {
        childId,
        refRebuilt,
        parentInboxBefore,
        parentInboxAfter,
        replyLanded,
        deliverError,
      });

      // 硬断言：关键路径不能 Bad（reload 后回报断裂就是 L6b 持久化 gap 的信号）。
      expect(result.tier).not.toBe("Bad");
      // 核心断言：_parentThreadRef 重建 + 回报跨 reload 落地。
      expect(refRebuilt).toBe(true);
      expect(replyLanded).toBe(true);
    },
    60_000,
  );
});
