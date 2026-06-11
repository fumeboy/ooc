/**
 * 单元测试 — manager 层的 self-type 严格校验。
 *
 * 不变量：method 必须挂在它所声明的 parent type 上；form 被 re-target 到不声明该 method
 * 的 parent type 后 submit，manager 在 lookupMethodEntry 处拒绝（"not registered on
 * parent window type"），不会盲目调 entry.exec。
 *
 * fixture：talk_window 上的 `say`（say 只挂 talk）re-target 到 do_window（do 没有 say）。
 * （原 relation_window fixture 随 relation type 退役改用 talk/do。）
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";

import "../index.js"; // registerExecutable side-effects

import { WindowManager } from "../_shared/manager";
import { builtinRegistry } from "../_shared/registry";
import {
  createFlowObject,
  createFlowSession,
  createStoneObject,
  writeThread,
} from "../../../persistable";
import { initContextWindows } from "../_shared/init";
import {
  ROOT_WINDOW_ID,
  type DoWindow,
  type TalkWindow,
} from "../_shared/types";
import type { ThreadContext } from "../../../thinkable/context";

const SELF = "alice";
const PEER = "critic";
const SID = "manager-dispatch-test";

async function setupThread(baseDir: string) {
  await createFlowSession(baseDir, SID);
  await createStoneObject({ baseDir, objectId: SELF });
  await createStoneObject({ baseDir, objectId: PEER });
  const flow = await createFlowObject({ baseDir, sessionId: SID, objectId: SELF });
  const talkWindow: TalkWindow = {
    id: "w_talk_alice_to_critic",
    class: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title: `talk: ${PEER}`,
    status: "open",
    createdAt: Date.now(),
    target: PEER,
    conversationId: "w_talk_alice_to_critic",
  };
  const doWindow: DoWindow = {
    id: "w_do_test",
    class: "do",
    parentWindowId: ROOT_WINDOW_ID,
    title: "do test",
    status: "running",
    createdAt: Date.now(),
    targetThreadId: "t_child",
  };
  const thread: ThreadContext = {
    id: "t_root",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { ...flow, threadId: "t_root" },
  };
  initContextWindows(thread, { initialTaskTitle: "test self" });
  thread.contextWindows = [...thread.contextWindows, talkWindow, doWindow];
  await writeThread(thread);
  return { thread, talkWindow, doWindow };
}

describe("WindowManager.submit — self-type guard", () => {
  it("rejects when form re-targeted to a parent type that doesn't declare the method", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-mgr-disp-"));
    try {
      const { thread, talkWindow, doWindow } = await setupThread(tempRoot);
      const mgr = WindowManager.fromThread(thread, builtinRegistry);

      // 在 talk_window 上开一个 "say" form（say 只挂 talk），不带 args 避免 auto-submit。
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: talkWindow.id,
        method: "say",
        title: "say",
      });
      expect(opened.autoSubmitted).toBe(false);
      const formId = opened.formId!;
      expect(formId).toBeDefined();

      // 把 form re-target 到 do_window：do 没有 "say" 方法。
      const form = mgr.get(formId)!;
      Object.assign(form, { parentWindowId: doWindow.id });

      // submit 应被 manager 拦下：lookupMethodEntry 在 do_window 上找不到 "say" → throw。
      let caught: Error | undefined;
      try {
        await mgr.submit(formId, thread);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("not registered on parent window type");
      expect(caught!.message).toContain("do");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("happy path: method on its correct parent type opens a form (no not-registered error)", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-mgr-disp-ok-"));
    try {
      const { thread, talkWindow } = await setupThread(tempRoot);
      const mgr = WindowManager.fromThread(thread, builtinRegistry);

      // say 挂在 talk 上 → 正常开 form（不报 not-registered）。
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: talkWindow.id,
        method: "say",
        title: "say ok",
      });
      expect(opened.formId).toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
