/**
 * super-flow-channel — Phase 1 super flow 通道贯通验证。
 *
 * 验证 talk(target="super") 自指别名 + 跨 session 派送 + reflectable knowledge
 * 注入在真 LLM 下贯通：alice 在普通 session 里 talk-delivery 到 super，
 * super-alice 在 flows/super/objects/alice/ 下被创建并运行，
 * LLM 看到 reflectable knowledge 提示后正常 end。
 *
 * 评分（per meta/engineering/how_to_test/strategy.md §2）：
 *
 * | 档 | 条件 |
 * |---|---|
 * | Good | super-alice thread.json 落在 flows/super/objects/alice/threads/ 下，
 *         status=done；debug/llm.input.json 第 0 个 system message 含
 *         `<self object_id="alice">` 且含 reflectable knowledge 字串；
 *         endSummary 非空 |
 * | OK   | super-alice done 但 reflectable knowledge 段没出现（通道通了但
 *         语义提示缺位）—— 说明 U3 注入路径未生效但 U1+U2 工作 |
 * | Bad  | super-alice 没起身 / status=failed / 落错位置（如 flows/web-test/objects/super
 *         或 flows/super/objects/super） |
 *
 * 单跑：
 *   bun --env-file=.env test tests/integration/super-flow-channel.integration.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  createFlowObject,
  createFlowSession,
  createStoneObject,
  readThread,
  writeSelf,
  writeThread,
} from "@ooc/core/persistable";
import { deliverTalkMessage } from "@ooc/core/executable/windows/talk/delivery";
import {
  initContextWindows,
  ROOT_WINDOW_ID,
  generateWindowId,
  type TalkWindow,
} from "@ooc/core/executable/windows";
import {
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import type { ThreadContext } from "@ooc/core/thinkable/context";

const ALICE_SELF = `
你叫 Alice，一个务实的工程师助手。

身份硬约束：每次 end 时 summary 必须以 "ALICE:" 开头。
`.trim();

describe.skipIf(!hasLlmEnv)("integration: super-flow-channel", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("alice talks to super -> super-alice runs in flows/super/ with reflectable context", async () => {
    // 1) alice stone + self.md（identity 验证用）
    await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeSelf({ baseDir: tempRoot, objectId: "alice" }, ALICE_SELF);

    // 2) 普通 session 里的 alice flow + root thread
    await createFlowSession(tempRoot, "web-test", "Phase 1 super flow demo");
    const aliceFlow = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "web-test",
      objectId: "alice",
    });

    const aliceRoot: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { ...aliceFlow, threadId: "root" },
    };
    initContextWindows(aliceRoot, { initialTaskTitle: "alice main task" });

    // 3) alice 挂一个 target="super" 的 talk_window，模拟 LLM 已经 open 过
    const talkWindowId = generateWindowId("talk");
    const superTalkWindow: TalkWindow = {
      id: talkWindowId,
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "ask self for reflection",
      status: "open",
      createdAt: Date.now(),
      target: "super",
      conversationId: talkWindowId,
    };
    aliceRoot.contextWindows = [...aliceRoot.contextWindows, superTalkWindow];
    await writeThread(aliceRoot);

    // 4) 直接调 deliverTalkMessage 模拟 alice say()——避免依赖 LLM 真的 open
    //    talk method（那是 U1 的 happy path 验证；此处验证 delivery 落点正确）
    //
    //    注意：prompt 故意 *不* 提 "reflectable" / "super" 等可能让 marker 检查
    //    误判的字串——hasReflectable 必须只在 U3 的注入路径生效时才通过。
    const delivered = await deliverTalkMessage({
      caller: { thread: aliceRoot, talkWindow: superTalkWindow },
      content: "请简要确认你看到了 Phase 1 测试提示，然后 end。",
      source: "talk",
    });

    // 落点断言（Bad 兜底）
    expect(delivered.calleeObjectId).toBe("alice");
    const superAliceThreadDir = join(
      tempRoot, "flows", "super", "objects", "alice", "threads", delivered.calleeThreadId,
    );
    await expect(stat(superAliceThreadDir)).resolves.toBeDefined();

    // 5) 读出 super-alice thread 并跑 scheduler
    const superAliceRef = {
      baseDir: tempRoot,
      sessionId: "super",
      objectId: "alice",
    };
    const superAlice = await readThread(superAliceRef, delivered.calleeThreadId);
    expect(superAlice).toBeDefined();
    expect(superAlice!.persistence?.sessionId).toBe("super");
    expect(superAlice!.persistence?.objectId).toBe("alice");

    await runScheduler(superAlice!, llm(), { maxTicks: 8 });

    // 6) Bad 档兜底：super-alice 必须 done 且有 endSummary
    expect(superAlice!.status).toBe("done");
    expect(superAlice!.endSummary ?? "").not.toBe("");

    // 7) 机制断言：debug/llm.input.json 第 0 个 system message
    const marker = await readSystemMessage(superAliceThreadDir);

    const hasSelf = marker.includes('<self object_id="alice">');
    // U3 注入的 protocol knowledge_window 用 path="internal/executable/reflectable/basic"；
    // 仅在 thread.persistence.sessionId === "super" 时才出现。这条路径串不会
    // 出现在用户 prompt 或其它 knowledge entry 中——是精确锚点。
    const hasReflectable = marker.includes("internal/executable/reflectable/basic");

    if (hasSelf && hasReflectable) {
      console.log("[super-flow-channel] tier=Good (<self> + reflectable both present)");
    } else if (hasSelf) {
      console.log(
        "[super-flow-channel] tier=OK (<self> present, reflectable knowledge missing)",
      );
    } else {
      console.log(
        `[super-flow-channel] tier=Bad (self=${hasSelf}, reflectable=${hasReflectable})`,
      );
    }

    // <self> 永远要在（identity 切片已验证；这里是 super flow 下回归保护）
    expect(hasSelf).toBe(true);

    // reflectable 是 U3 的 happy path——本测试硬断言；缺则 Bad
    expect(hasReflectable).toBe(true);
  }, 180_000);
});

/** 读 debug/llm.input.json，返回第 0 个 system message 的 content。 */
async function readSystemMessage(threadDir: string): Promise<string> {
  const raw = await readFile(join(threadDir, "debug", "llm.input.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    inputItems: Array<{ type: string; role?: string; content?: string }>;
  };
  return parsed.inputItems[0]?.content ?? "";
}
