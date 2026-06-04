/**
 * P6.§3 单元测试 — manager 层的 self-type 严格校验。
 *
 * 不变量：method 的 declaringType 必须等于 form.parent.type，否则 manager.submit
 * 不会调用 entry.exec，而是把 form 标记为 failed 并返回
 *   `[method-error] method "X" not declared on object class "Y"`
 *
 * 这是把以前散落在每个 method 体顶部的 `if (self.type !== "X") return "未挂载..."`
 * 收编到 manager 层的统一保证。method 体可以放心 cast `ctx.self as XWindow`。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";

import "../index.js"; // registerObjectType side-effects

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
  type RelationWindow,
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
  const relationWindow: RelationWindow = {
    id: `w_rel_${PEER}`,
    type: "relation",
    parentWindowId: ROOT_WINDOW_ID,
    title: `relation: ${PEER}`,
    status: "open",
    createdAt: Date.now(),
    peerId: PEER,
    peerReadmePath: `stones/main/objects/${PEER}/readme.md`,
    peerReadmeExists: false,
    selfLongTermPath: `pools/${SELF}/knowledge/relations/${PEER}.md`,
    selfLongTermExists: false,
    selfSessionPath: `flows/${SID}/${SELF}/knowledge/relations/${PEER}.md`,
    selfSessionExists: false,
  };
  const talkWindow: TalkWindow = {
    id: "w_talk_alice_to_critic",
    type: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title: `talk: ${PEER}`,
    status: "open",
    createdAt: Date.now(),
    target: PEER,
    conversationId: "w_talk_alice_to_critic",
  };
  const thread: ThreadContext = {
    id: "t_root",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { ...flow, threadId: "t_root" },
  };
  initContextWindows(thread, { initialTaskTitle: "test self" });
  thread.contextWindows = [...thread.contextWindows, relationWindow, talkWindow];
  await writeThread(thread);
  return { thread, relationWindow, talkWindow };
}

describe("WindowManager.submit — P6.§3 self-type guard", () => {
  it("rejects when form.parent.type does not declare the method", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-mgr-disp-"));
    try {
      const { thread, talkWindow } = await setupThread(tempRoot);
      const mgr = WindowManager.fromThread(thread, builtinRegistry);

      // 手工构造一个 form：parent = talk_window, command = "edit"（edit 只挂在 relation_window 上）。
      // 走低阶 path（绕过 openMethodExec 的 lookupCommandEntry 早期校验）来构造严格
      // 跨类型场景。这里直接 set 一个 command_exec form 进 manager 私有 windows 也可，
      // 但更朴素的做法是用 openMethodExec 在合法 parent 上开 form 再人为换 parent。
      //
      // 简化：走 openMethodExec 在 relation_window 上开 form, 然后改 parentWindowId。
      // 这样 form.command 能落到 registry 校验之外（用户构造的合法 form, 但被
      // re-targeted 到错类型 parent，模拟 §3 防御场景）。
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: `w_rel_${PEER}`,
        command: "edit",
        title: "edit relation",
        // 不带 args, 避免 auto-submit
      });
      expect(opened.autoSubmitted).toBe(false);
      const formId = opened.formId;

      // 把 form re-target 到 talk_window：talk_window 没有 "edit" 方法
      const form = mgr.get(formId);
      expect(form).toBeDefined();
      Object.assign(form!, { parentWindowId: talkWindow.id });

      // 现在 submit 应被 manager 的 §3 校验拦下：lookupMethodEntry 在 talk_window 上
      // 找不到 "edit" → throw（"not registered on parent window type"），这是更早的
      // 拒绝路径（拦在 declaringType 比对前）。
      let caught: Error | undefined;
      try {
        await mgr.submit(formId, thread);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("not registered on parent window type");
      expect(caught!.message).toContain("talk");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("happy path: matching parent.type lets submit dispatch into entry.exec", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-mgr-disp-ok-"));
    try {
      const { thread } = await setupThread(tempRoot);
      const mgr = WindowManager.fromThread(thread, builtinRegistry);

      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: `w_rel_${PEER}`,
        command: "edit",
        title: "edit relation ok",
        args: { content: "hello", scope: "session" },
        // args 给齐 + edit 不引入新 knowledge → auto-submit
      });
      // 不强求 autoSubmitted（command match 列表 / knowledge 行为依实现而定），
      // 关键是没有 [method-error]。
      if (opened.autoSubmitted) {
        // submitResult 应不带 [method-error] 前缀
        const r = opened.submitResult;
        expect(r === undefined || !r.startsWith("[method-error]")).toBe(true);
      } else {
        const r = await mgr.submit(opened.formId, thread);
        expect(r === undefined || !r.startsWith("[method-error]")).toBe(true);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
