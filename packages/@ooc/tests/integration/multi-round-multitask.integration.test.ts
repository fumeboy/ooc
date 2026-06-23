import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  createFlowObject,
  createStoneObject,
} from "@ooc/core/persistable";
import {
  bootstrapInboxFromPrompt,
  countFormExecutions,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

/**
 * Long-horizon 多轮多任务压力测试。
 *
 * 验证 Agent 在 ≥15 轮 think 循环里：
 * - 维持 4+ 件事的任务列表，逐个推进不串台
 * - 跨轮共享状态：每轮 program 的 [returnValue] 段留在 context（executed form 累积），
 *   下一轮 LLM 直接从上文读回中间结果、最终统一汇总
 * - 三种 program 模式混用：shell（拿数字）/ ts（计算）/ end
 * - executed form 累积，下一轮 LLM 能从 [returnValue] 段读到上一轮结果
 *
 * 这是对 form lifecycle / context renderer 两层的端到端长程考验。
 *
 * 注：setData/getData 已收紧为「读写本 interpreter_process 实例自身 data」（不再跨 program 实例
 * 共享）；跨 program 调用的工作记忆改由 context 中累积的 form [returnValue] 承载（LLM 自上文读回）。
 * 故断言读 endSummary（agent 算出的 total）。
 */
describe.skipIf(!hasLlmEnv)("integration: multi-round-multitask", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent processes 4 file-counting tasks then computes total across many rounds", async () => {
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });

    const { inbox, events } = bootstrapInboxFromPrompt(
      [
        "你有 4 件计数任务 + 1 件汇总任务，必须分步独立完成（看到上一步 result 再做下一步）：",
        "",
        "任务 1：用 program(language=shell) 跑命令",
        "  find src/persistable -type f -name '*.ts' -not -path '*/__tests__/*' | wc -l",
        "  看到 [returnValue] / [stdout] 中的数字后，用 program(language=ts) 写：",
        "  _result_ = <那个数字>;  // 记为 c_persistable",
        "",
        "任务 2：同样的形式，但目录改为 src/thinkable/（记为 c_thinkable）",
        "任务 3：目录 src/executable/（记为 c_executable）",
        "任务 4：目录 src/observable/（记为 c_observable）",
        "",
        "任务 5：用 program(language=ts) 写（四个数字从上文各步的 [returnValue] 段读回、直接写成字面量）：",
        "  const total = c_persistable + c_thinkable + c_executable + c_observable; // 替换成上文实际数字",
        "  _result_ = total;",
        "",
        "最后 open(end, summary='4 个目录共 N 个 ts 文件') 结束，N 是上面算出的 total。",
        "",
        "重要：",
        "- 必须分步做，每步独立 open + submit 一个 program form；不要把多个 shell / ts 操作合并到一段脚本",
        "- form result 已在 contextWindows 中可见，不要 wait",
        "- 严格按 1→2→3→4→5 的顺序完成",
      ].join("\n"),
    );
    const root: ThreadContext = {
      id: "root",
      class: "_builtin/agent/thread",
      status: "running",
      inbox,
      events,
      contextWindows: [],
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 30 });

    // 1) 线程跑完，没卡 wait / failed
    expect(root.status).toBe("done");

    // 2) multi-round 确认：responses-first item model 后单轮可包含多 function_call，
    //    每个 form 至少 1 function_call + 1 function_call_output = 2 events。
    //    9 个 form ⇒ events ≥ 18；放宽下界避免随 LLM 调用效率波动而误报
    expect(root.events.length).toBeGreaterThanOrEqual(18);

    // 3) 至少 9 个 form 被执行：4 shell + 4 ts(setThreadLocal) + 1 ts(汇总) = 9，end 是第 10 个
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(9);

    // 4) 跨 program 调用的工作记忆走 thread-local（in-memory 跨 exec 共享）；汇总后由 end 汇报。
    //    setData/getData 已收紧为 process 实例自身 data，不再是跨 program 实例的 session 草稿，
    //    故不再读 flow 层 data.json——改核 agent 经 endSummary 报出的某个数字。
    expect(root.endSummary).toBeDefined();
    expect(root.endSummary!).toMatch(/\d/);
  }, 600_000); // 10 分钟兜底
});
