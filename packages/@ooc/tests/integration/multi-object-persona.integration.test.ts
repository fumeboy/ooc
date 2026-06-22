/**
 * multi-object-persona — Phase 1 多 Object 身份验证。
 *
 * 验证 self.md → instructions / <self object_id> 双通道在真 LLM 下生效：
 * 同一 baseDir 下创建两个 stone（alice / bob），各自 self.md 要求 LLM 在结束
 * 摘要中复述一个独特 token；分别跑各自 root thread，看落盘的 endSummary 与
 * debug/llm.input.json 是否携带了对应身份信号。
 *
 * 评分：
 *
 * | 档 | 条件 |
 * |---|---|
 * | Good | 两个 thread 都 status=done；各自 endSummary 包含自己 self.md 指定的 token；
 *         各自 debug/llm.input.json 第 0 个 system message 内含 <self object_id="..."> |
 * | OK   | 两个 thread 都 status=done 且各自 endSummary 包含自己的 token，
 *         但 <self object_id> 标记缺失或顺序异常（机制残缺但产品体验仍正确） |
 * | Bad  | 任一 thread 未到 done / 任一 endSummary 不含自己的 token / 出现身份串台
 *         （alice 的输出含 bob 的 token 或反之） |
 *
 * 重试政策：单次 Bad 即记失败；OK 多发是黄信号。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  createFlowObject,
  createStoneObject,
} from "@ooc/core/persistable";
import { writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import {
  bootstrapInboxFromPrompt,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import { initContextWindows } from "@ooc/builtins/agent/thread/thinkable/context/init.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

const ALICE_SELF = `
你叫 Alice。每次 end 时，summary 必须以 "ALICE-TOKEN-7421:" 开头。
这是你身份的硬约束，不可省略。
`.trim();

const BOB_SELF = `
你叫 Bob。每次 end 时，summary 必须以 "BOB-TOKEN-9583:" 开头。
这是你身份的硬约束，不可省略。
`.trim();

const PROMPT = [
  "请直接 end，summary 简述你是谁。",
  "回顾系统提示开头的身份约束并严格遵守。",
].join("\n");

describe.skipIf(!hasLlmEnv)("integration: multi-object-persona", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("two stones with distinct self.md yield distinct end summaries", async () => {
    // 1) 两个 stone，各自写 self.md
    await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeSelf({ baseDir: tempRoot, objectId: "alice" }, ALICE_SELF);
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    await writeSelf({ baseDir: tempRoot, objectId: "bob" }, BOB_SELF);

    // 2) 各自的 flow + root thread
    const aliceFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "alice" });
    const bobFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "bob" });

    const aliceThread = await makeThread(aliceFlow);
    const bobThread = await makeThread(bobFlow);

    // 3) 跑各自 scheduler——独立 LLM 调用，独立 self.md 注入
    await Promise.all([
      runScheduler(aliceThread, llm(), { maxTicks: 8 }),
      runScheduler(bobThread, llm(), { maxTicks: 8 }),
    ]);

    // 4) Bad-档兜底：必须 done 且 endSummary 含本身 token，不能串台
    expect(aliceThread.status).toBe("done");
    expect(bobThread.status).toBe("done");

    expect(aliceThread.endSummary ?? "").toContain("ALICE-TOKEN-7421");
    expect(aliceThread.endSummary ?? "").not.toContain("BOB-TOKEN-9583");
    expect(bobThread.endSummary ?? "").toContain("BOB-TOKEN-9583");
    expect(bobThread.endSummary ?? "").not.toContain("ALICE-TOKEN-7421");

    // 5) 机制断言：debug/llm.input.json 第 0 个 system message 含 <self object_id>
    //    缺失则降为 OK 档：测试 stdout 打 hint，不 fail
    //    "OK 不等于放行，OK 是需要趋势观察的状态"
    const aliceMarker = await readSelfMarker(tempRoot, "alice");
    const bobMarker = await readSelfMarker(tempRoot, "bob");

    const aliceHasSelf = aliceMarker.includes('<self object_id="alice">');
    const bobHasSelf = bobMarker.includes('<self object_id="bob">');

    if (aliceHasSelf && bobHasSelf) {
      console.log("[multi-object-persona] tier=Good (tokens correct, <self> markers present)");
    } else {
      console.log(
        "[multi-object-persona] tier=OK (tokens correct but <self> markers missing: " +
        `alice=${aliceHasSelf}, bob=${bobHasSelf})`,
      );
    }

    // <self> 没出现说明 render 通道断了——这是 Bad，应失败
    // （tokens 对说明 instructions 通道生效，但若 <self> 也丢，渲染层退化太大）
    expect(aliceHasSelf).toBe(true);
    expect(bobHasSelf).toBe(true);
  }, 180_000);
});

/** 构造一个携带初始 prompt 的 root thread（含 inbox + creator-window 注入）。 */
async function makeThread(flow: {
  baseDir: string;
  sessionId: string;
  objectId: string;
}): Promise<ThreadContext> {
  const { inbox, events } = bootstrapInboxFromPrompt(PROMPT);
  const thread: ThreadContext = {
    id: "root",
    status: "running",
    inbox,
    events,
    contextWindows: [],
    creatorObjectId: "user",
    creatorThreadId: "root",
    persistence: { ...flow, threadId: "root" },
  };
  initContextWindows(thread, { initialTaskTitle: "persona check" });
  return thread;
}

/** 读 llm.input.json，返回第 0 个 system message 的 content（含 <self> 标记的位置）。 */
async function readSelfMarker(baseDir: string, objectId: string): Promise<string> {
  const dir = join(baseDir, "flows", "s", "objects", objectId, "threads", "root");
  const raw = await readFile(join(dir, "debug", "llm.input.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    inputItems: Array<{ type: string; role?: string; content?: string }>;
  };
  const first = parsed.inputItems[0];
  return first?.content ?? "";
}
