import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { createStoneObject, ensureStoneRepo, writeSelf } from "../../persistable";
import { ROOT_WINDOW_ID, threadWindowIdOf } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { createLlmClient } from "../llm/client";
import { buildInputItems, type ThreadContext } from "../context";
import { think } from "../thinkloop";

/**
 * events compress 真实 LLM 验证 —— 驱动真实 think() 走完整生产链：
 * 真 LLM 决策 → exec(window_id=thread 窗) 派发 → thread class compress window method（scope=events，
 * 能力归属内容所在的窗）→ 写 thread 窗 win.summarizedRanges → 读出侧 buildInputItems 折叠投影变短。
 *
 * gate：`RUN_REAL_COMPRESS_TEST=1`（非 CI；需 .env 真 LLM 配置）。
 * 跑：`RUN_REAL_COMPRESS_TEST=1 bun test packages/@ooc/core/thinkable/__tests__/real-compress.test.ts`
 */
function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      process.env[trimmed.slice(0, sep)] = trimmed.slice(sep + 1);
    }
    return;
  }
}

const shouldRun = process.env.RUN_REAL_COMPRESS_TEST === "1";
const TESTER = "compress_tester";

describe.skipIf(!shouldRun)("events compress —— 真实 LLM 端到端", () => {
  let world: string;

  beforeAll(async () => {
    loadRealEnv();
    world = await mkdtemp(join(tmpdir(), "ooc-real-compress-"));
    await ensureStoneRepo({ baseDir: world });
    await createStoneObject({ baseDir: world, objectId: TESTER });
    await writeSelf({ baseDir: world, objectId: TESTER }, "# compress_tester\n压缩能力验证对象。");
    // self 窗 class = objectId，注册进 builtinRegistry（exec 派发 / resolveWindowMethod 回退默认表需 class 存在）。
    if (!builtinRegistry.has(TESTER)) {
      builtinRegistry.register(TESTER, { executable: { methods: [] } } as never, { parentClass: null });
    }
  });

  afterEach(() => mock.restore());
  afterAll(async () => {
    if (world) await rm(world, { recursive: true, force: true });
  });

  it("真 LLM 主动 compress(scope=events) 折叠自身历史 → win.summarizedRanges 写入 + transcript 变短", async () => {
    // 模拟一段已累积的对话历史（5 轮 + 一条折叠指令 inject）。
    const history: ThreadContext["events"] = [
      { category: "llm_interaction", kind: "text", text: "第1轮：用户要求实现一个解析器。" },
      { category: "llm_interaction", kind: "text", text: "第2轮：我读了相关文件，定位入口。" },
      { category: "llm_interaction", kind: "text", text: "第3轮：实现 tokenizer，跑通基础用例。" },
      { category: "llm_interaction", kind: "text", text: "第4轮：实现 parser，处理嵌套结构。" },
      { category: "llm_interaction", kind: "text", text: "第5轮：补单测，全部通过。" },
      {
        category: "context_change",
        kind: "inject",
        text:
          "你的对话历史已较长，需要折叠早期过程以节省上下文。events 折叠归你的 thread 窗——请只调用一次 exec 工具，参数等价于：" +
          `method="compress", window_id="${threadWindowIdOf("t_real_compress")}", title="折叠早期历史", args={ scope: "events", keepTail: 2, ` +
          'summary: "<把第1-3轮的要点浓缩成一句中文摘要>" }。只调用这一次，不要输出多余解释。',
      },
    ];
    const thread: ThreadContext = {
      id: "t_real_compress",
      status: "running",
      events: history,
      contextWindows: [
        {
          // self 门面窗（identity + agency）——不再承载 events 折叠。
          id: TESTER,
          class: TESTER,
          parentObjectId: ROOT_WINDOW_ID,
          title: TESTER,
          status: "open",
          createdAt: 1,
          data: {},
          win: { transient: true, isSelfWindow: true },
        },
        {
          // 自己视角 thread 窗（events 折叠载体）：events-compress 归此窗（compress.md 核7）。
          // 无 creator 通道（compress_tester 无上游）= self-driven 形态，events 折叠照常。
          id: threadWindowIdOf("t_real_compress"),
          class: THREAD_CLASS_ID,
          parentObjectId: ROOT_WINDOW_ID,
          title: "thread",
          status: "open",
          createdAt: 1,
          data: {},
          win: { transient: true },
        },
      ],
      persistence: { baseDir: world, sessionId: "s_real", objectId: TESTER, threadId: "t_real_compress" },
    };

    // 折叠前：transcript 含 5 条 assistant 文本。
    const before = await buildInputItems(thread);
    const beforeTexts = before.input.filter((i) => i.type === "message" && i.role === "assistant");
    expect(beforeTexts.length).toBe(5);

    // 真实 LLM 跑一轮 think —— 它应经 exec 派发调用 compress window method。
    const client = createLlmClient();
    await think(thread, client);

    // 写入侧证据：**thread 窗** win.summarizedRanges 被真实 compress 调用写入（走完整 exec→window-manager 链）。
    const threadWin = thread.contextWindows.find(
      (w) => w.id === threadWindowIdOf("t_real_compress"),
    )?.win as { summarizedRanges?: Array<{ fromIdx: number; toIdx: number; summary: string }> } | undefined;
    expect(threadWin?.summarizedRanges?.length ?? 0).toBeGreaterThanOrEqual(1);
    const range = threadWin!.summarizedRanges![0]!;
    expect(range.summary.trim().length).toBeGreaterThan(0);

    // 读出侧证据：再建一次 context，折叠区段已被 summary 占位替换 → assistant 文本变少 + summary 出现。
    const after = await buildInputItems(thread);
    const afterTexts = after.input.filter((i) => i.type === "message" && i.role === "assistant");
    expect(afterTexts.length).toBeLessThan(beforeTexts.length);
    const summaryItem = after.input.find(
      (i) =>
        i.type === "message" &&
        i.role === "system" &&
        (i as { content: string }).content.includes("events_summary"),
    );
    expect(summaryItem).toBeDefined();

    // eslint-disable-next-line no-console
    console.log(
      `[real-compress] LLM summary="${range.summary}" range=${range.fromIdx}-${range.toIdx} ` +
        `assistant文本 ${beforeTexts.length}→${afterTexts.length}`,
    );
  }, 180000);
});
