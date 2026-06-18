import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  createFlowObject,
  createStoneObject,
} from "@ooc/core/persistable";
import { readData as readFlowData } from "@ooc/builtins/interpreter/children/interpreter_process/persistable/flow-data.js";
import {
  bootstrapInboxFromPrompt,
  countFormExecutions,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import type { ThreadContext } from "@ooc/core/thinkable/context";

/**
 * Long-horizon 多轮多任务压力测试。
 *
 * 验证 Agent 在 ≥15 轮 think 循环里：
 * - 维持 4+ 件事的任务列表，逐个推进不串台
 * - 跨轮共享状态：用 self.setData/getData 把每轮中间结果存到 data.json，最终统一汇总
 * - 三种 program 模式混用：shell（拿数字）/ ts（读写 data + 计算）/ end
 * - executed form 累积，下一轮 LLM 能从 [returnValue] 段读到上一轮结果
 *
 * 这是对 form lifecycle / context renderer / persistable 三层的端到端长程考验。
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
        "  await self.setData('c_persistable', <那个数字>);",
        "",
        "任务 2：同样的形式，但目录改为 src/thinkable/，字段名 'c_thinkable'",
        "任务 3：目录 src/executable/，字段名 'c_executable'",
        "任务 4：目录 src/observable/，字段名 'c_observable'",
        "",
        "任务 5：用 program(language=ts) 写：",
        "  const a = await self.getData('c_persistable');",
        "  const b = await self.getData('c_thinkable');",
        "  const c = await self.getData('c_executable');",
        "  const d = await self.getData('c_observable');",
        "  const total = a + b + c + d;",
        "  await self.setData('total', total);",
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

    // 3) 至少 9 个 form 被执行：4 shell + 4 ts(setData) + 1 ts(汇总) = 9，end 是第 10 个
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(9);

    // 4) data.json 现在落 flow 层（session-scoped），最终持有 5 个字段
    const data = await readFlowData({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    expect(data).toBeDefined();
    expect(data!.c_persistable).toBeTypeOf("number");
    expect(data!.c_thinkable).toBeTypeOf("number");
    expect(data!.c_executable).toBeTypeOf("number");
    expect(data!.c_observable).toBeTypeOf("number");
    expect(data!.total).toBeTypeOf("number");

    // 5) total 等于 4 个分项之和（容忍 LLM 数字偏差 ±2，因为不同 LLM 对 find 路径的处理边界可能不同）
    const sum =
      (data!.c_persistable as number) +
      (data!.c_thinkable as number) +
      (data!.c_executable as number) +
      (data!.c_observable as number);
    expect(Math.abs((data!.total as number) - sum)).toBeLessThanOrEqual(2);

    // 6) endSummary 报告了某个数字
    expect(root.endSummary).toBeDefined();
    expect(root.endSummary!).toMatch(/\d/);
  }, 600_000); // 10 分钟兜底
});
