/**
 * Story: executable —— LLM 经稳定 tool 原语在 ContextWindow 上调 Method 改变世界。
 *
 * 控制面（无 LLM）只验**结构**：① Object 自定义 for_ui_access object method 经 HTTP call_method 执行；
 * ② Object 定义的 executable.methods（LLM 命令面）经 loadStoneClass 可加载。深度（3 原语 exec/close/wait
 * 驱动真实编辑、compress 经 exec 调）属 Tier B + e2e S1/S2。规格见 executable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { mkServer, postJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    // TC-EXEC-01: for_ui_access object method 经 HTTP call_method 执行（结果走 data 通道）。
    // Wave4 对象模型：stone 一处 `export const Class: OocClass`（root index.ts），executable.methods
    // 是数组，exec 三参 (ctx, self, args)；call_method 经 resolveObjectMethods 取 for_ui_access 方法。
    {
      const id = "calc";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { executable: { methods: [
           { name: "add", description: "add", for_ui_access: true,
             exec: (_ctx, _self, args) => ({ data: { sum: args.x + args.y } }) },
         ] } };`);
      await sleep(350);
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      rec.eq("TC-EXEC-01", "for_ui_access 方法经 HTTP 执行并 data 通道返回结果", r.json?.data, { sum: 5 });
    }

    // TC-EXEC-02: object method（LLM 命令面）经 loadStoneClass 可加载（executable 维度）。
    // 退役 loadObjectWindow（barrel `export const window`）→ loadStoneClass 读 root index.ts 的 Class。
    {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { executable: { methods: [
           { name: "run", description: "run", exec: async () => ({ message: "ok" }) },
         ] } };`);
      const { loadStoneClass } = await import("@ooc/core/runtime/server-loader");
      const loaded = await loadStoneClass({ baseDir, objectId: id });
      const names = (loaded?.cls?.executable?.methods ?? []).map((m) => m.name);
      rec.ok("TC-EXEC-02", "object method（LLM 命令面）经 loadStoneClass 可加载",
        names.includes("run"),
        `methods=${JSON.stringify(names)}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "executable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 用工具原语（glob/run 等）真实行动。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  return demoViaSupervisor("executable", `sb-an-exec-${tag}`,
    "请用一个工具（glob 或 terminal.run 都行）看看当前仓库根目录下有哪些 .md 文件，然后告诉我结果。",
    async ({ execs }) => {
      const tools = execs.map((e) => e.cmd).filter((c) => ["glob", "grep", "run", "open_file", "talk"].includes(c));
      return { ok: tools.length > 0, detail: `用到的 tool 原语：${JSON.stringify([...new Set(tools)])}` };
    });
}
