import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { createFlowObject, createStoneObject, readServerSource, stoneDir } from "../../src/persistable";
import { clearObservableDebugState, disableDebug, enableDebug } from "../../src/observable";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import type { ThreadContext } from "../../src/thinkable/context";

describe.skipIf(!hasLlmEnv)("integration: meta-programming", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
    clearObservableDebugState();
    enableDebug();
  });

  afterEach(async () => {
    disableDebug();
    await cleanup();
  });

  test("agent registers a method then calls it", async () => {
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });

    const sDir = stoneDir(stoneRef);
    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [
        {
          category: "context_change",
          kind: "inject",
          text: [
            "请严格按 open/refine/submit 协议执行元编程任务，分三步：",
            "",
            "协议要求：",
            "1) open(type=\"command\", command=\"program\", description=\"...\") 只创建 form，不等于执行。",
            "2) 业务参数必须放在 open.args 或 refine.args，不要把 language/code/function 写进 description。",
            "3) 只有在参数齐全后，才 submit(form_id)。",
            "",
            "Step 1: 用 program command（language=shell）写文件，",
            `把以下内容写到 ${sDir}/server/index.ts：`,
            "",
            "    export const llm_methods = {",
            "      add: {",
            "        description: '两数相加',",
            "        params: [{name:'a',required:true},{name:'b',required:true}],",
            "        fn: async (_ctx, { a, b }) => a + b,",
            "      },",
            "    };",
            "",
            `具体 shell 代码可以用 cat > ${sDir}/server/index.ts <<'EOF' ... EOF 这种 heredoc 形式。`,
            "",
            "Step 2: 用 program command（function='add', args={a:7,b:8}）调用方法。",
            "你会在 form result 的 [returnValue] 段看到 15。",
            "",
            "Step 3: open(end, summary='结果是 15') 结束。",
            "",
            "重要：每个 form 提交后看 result，不需要 wait。",
            "请严格使用 refine(args={...}) 填参数。",
          ].join("\n"),
        },
      ],
      contextWindows: [],
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");

    const sourceText = await readServerSource(stoneRef);
    expect(sourceText).toBeDefined();
    expect(sourceText).toContain("add");

    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(3);

    expect(root.endSummary).toBeDefined();
    expect(root.endSummary).toContain("15");
  }, 240_000);
});
