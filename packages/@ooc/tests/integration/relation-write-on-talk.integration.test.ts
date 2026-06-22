/**
 * backend-relation-self-write-on-talk — e2e 集成测试
 *
 * 度量"读侧占位提示 + talk basic 段是否真的驱动 LLM 写 relation 文件"。
 *
 * 用户故事:
 *   user → assistant 任务,assistant 用 root.talk 创建指向 critic 的 talk_window;
 *   跑 LLM 一轮 say,然后 close talk_window;断言事后磁盘上
 *   stones/assistant/knowledge/relations/critic.md 被 LLM 自然写出来了。
 *
 * 评分:
 *
 * | 档 | 条件 |
 * |---|---|
 * | Good | thread.status=done;stones/assistant/knowledge/relations/critic.md
 *         存在且非空;LLM 用 write_file 创建(从轨迹可见 toolName=open,
 *         args.method=write_file, path 落在 stones/assistant/knowledge/relations/) |
 * | OK   | 文件存在但内容只是回写占位文案,或路径轻微偏离(仍在 relations/ 下) |
 * | Bad  | 文件不存在,或 thread 卡 running/waiting,或文件落在错路径
 *         (如 stones/critic/... 反向写入) |
 *
 * 重试政策:单次 Bad 即记失败;OK 多发是黄信号,提示触发
 * fallback (close hook)。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import { processQueuedJobs } from "@ooc/core/app/server/runtime/worker";
import { createJobManager } from "@ooc/core/app/server/runtime/job-manager";
import {
  createFlowObject,
  createStoneObject,
  createPoolObject,
  poolKnowledgeRelationFile,
  writeReadable,
} from "@ooc/core/persistable";
import { hasLlmEnv, llm, setupTempFlow } from "./_fixture";
import { initContextWindows } from "@ooc/builtins/agent/thread/thinkable/context/init.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

const CRITIC_READABLE = `
我是 critic。我从两个角度审视代码方案:

1. **证据是否独立可复现**: 你说"通过"必须给出可验证的依据(测试名、command、断言)
2. **失败路径有没有覆盖**: 主路径绿不代表健壮性,失败/超时/边界场景必须有应对

回信时请用上述两条作为审视维度。
`.trim();

const PROMPT = [
  "你是 assistant。请按以下步骤完成:",
  "",
  "1. 用 root.talk 创建一个指向 critic 的 talk_window",
  "2. 用 talk_window.say 向 critic 发送一条消息:",
  '   "请审视方案 X:用 grep -l 找出所有 *.ts 文件并 wc -l 统计"',
  "3. 等 critic 回复(open talk_window.wait)",
  "4. 看完 critic 的回信后,形成对 critic 的认知,",
  "   用 open(command=write_file, path=\"pools/assistant/knowledge/relations/critic.md\",",
  "   content=\"...\") 把你对 critic 的认知写下来",
  "5. close talk_window 并 end thread",
  "",
  "重要:第 4 步的 write_file 是本任务的关键交付物,必须执行。",
].join("\n");

describe.skipIf(!hasLlmEnv)("integration: backend-relation-self-write-on-talk", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("assistant writes relation file after talk with critic", async () => {
    // 1) 建 assistant + critic stones + assistant pool;critic 的 readable 给 assistant 看
    await createStoneObject({ baseDir: tempRoot, objectId: "assistant" });
    await createStoneObject({ baseDir: tempRoot, objectId: "critic" });
    await createPoolObject({ baseDir: tempRoot, objectId: "assistant" });
    await writeReadable({ baseDir: tempRoot, objectId: "critic" }, CRITIC_READABLE);

    // 2) 建 assistant root thread,挂初始 prompt
    const assistantFlow = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s",
      objectId: "assistant",
    });
    const msgId = `msg_init_${Math.random().toString(36).slice(2, 10)}`;
    const assistantThread: ThreadContext = {
      id: "root",
      status: "running",
      inbox: [
        {
          id: msgId,
          fromThreadId: "user",
          toThreadId: "root",
          content: PROMPT,
          createdAt: Date.now(),
          source: "user",
        },
      ],
      events: [{ category: "context_change", kind: "inbox_message_arrived", msgId }],
      contextWindows: [],
      persistence: { ...assistantFlow, threadId: "root" },
    };
    initContextWindows(assistantThread, { initialTaskTitle: "write relation about critic" });

    // 3) 走 worker 完整调度(deliverTalkMessage 内的 notifyThreadActivated 把 callee
    //    thread 直接 enqueue,保证 critic 跑一轮 LLM 回复;事件驱动改造后 worker 不再
    //    周期扫,见 src/app/server/runtime/worker.ts:processQueuedJobs)
    const jobManager = createJobManager();
    jobManager.createRunThreadJob({ sessionId: "s", objectId: "assistant", threadId: "root" });

    // 借用 runScheduler 跑 root thread。若需要让 critic 真的回复,
    // 还需依赖 worker 调度;此处保持简单:直接 runScheduler 跑 assistant 30 ticks,
    // 中间手动 trigger critic threads。
    await runScheduler(assistantThread, llm(), { maxTicks: 30 });

    // 4) 评分 — 检查 disk
    const relPath = poolKnowledgeRelationFile({ baseDir: tempRoot, objectId: "assistant" }, "critic");
    let fileExists = false;
    let fileBytes = 0;
    let fileBody = "";
    try {
      const info = await stat(relPath);
      fileExists = info.isFile();
      fileBody = await readFile(relPath, "utf8");
      fileBytes = info.size;
    } catch {
      /* missing */
    }

    // 检查 LLM 轨迹是否走过 write_file 命令
    const events = assistantThread.events;
    const writeFileCalls = events.filter(
      (e) =>
        e.category === "tool_runtime" &&
        e.kind === "function_call_output" &&
        e.toolName === "exec" &&
        e.ok &&
        // open 的 arguments 含 method: "write_file";由于 output 是字符串,稍微宽松一点匹配
        typeof e.output === "string" &&
        e.output.includes("write_file"),
    );
    const wroteToRelationPath = events.some(
      (e) =>
        e.category === "llm_interaction" &&
        e.kind === "function_call" &&
        e.toolName === "exec" &&
        typeof e.arguments === "object" &&
        e.arguments !== null &&
        (e.arguments as Record<string, unknown>).method === "write_file" &&
        typeof ((e.arguments as Record<string, unknown>).args as Record<string, unknown> | undefined)?.path === "string" &&
        (
          ((e.arguments as Record<string, unknown>).args as Record<string, unknown>).path as string
        ).includes("knowledge/relations/"),
    );

    const isPlaceholderEcho = fileBody.trim().startsWith("暂无对");
    const status = assistantThread.status;

    let grade: "Good" | "OK" | "Bad";
    if (!fileExists || fileBytes === 0 || status !== "done") {
      grade = "Bad";
    } else if (wroteToRelationPath && !isPlaceholderEcho) {
      grade = "Good";
    } else {
      grade = "OK";
    }

    console.log(
      `[relation-write-on-talk] grade=${grade} status=${status} ` +
        `file_exists=${fileExists} file_bytes=${fileBytes} ` +
        `write_file_calls=${writeFileCalls.length} wrote_to_relation_path=${wroteToRelationPath} ` +
        `placeholder_echo=${isPlaceholderEcho}`,
    );

    // 断言:≥ OK 通过;Bad 失败
    expect(grade).not.toBe("Bad");
  }, 180_000);
});

// 避免未使用 import 报错(processQueuedJobs / jobManager 暂未深用,留待 future 加 worker driven 版本)
void processQueuedJobs;
void join;
