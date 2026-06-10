/**
 * Story: executable —— LLM 经稳定 tool 原语在 ContextObject 上调 Method 改变世界。
 *
 * 控制面（无 LLM）只验**结构**：① Object 自定义 ui_methods 在 ContextObject 上执行（method 调用）；
 * ② Object 定义的 window.commands（LLM 路径命令）经 loader 可加载。深度（4 原语 exec/close/wait/compress
 * 驱动真实编辑）属 Tier B + e2e S1/S2。规格见 executable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { mkServer, postJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    // TC-EXEC-01: ui_methods 在 ContextObject 上执行（method 调用改变/返回世界状态）
    {
      const id = "calc";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const ui_methods = { add: { fn: (_c, a) => ({ sum: a.x + a.y }) } };\nexport const window = { methods: {} };`);
      await sleep(350);
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      rec.eq("TC-EXEC-01", "ui_methods 在 ContextObject 上执行并返回结果", r.json?.returnValue, { sum: 5 });
    }

    // TC-EXEC-02: window.commands（LLM 路径命令）经 loader 可加载（executable 的命令面）
    {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { run: { description: "run", intents: ["run"], exec: async () => ({ ok: true }) } } };\nexport const ui_methods = {};`);
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      const win = await loadObjectWindow({ baseDir, objectId: id });
      rec.ok("TC-EXEC-02", "window.commands（LLM 路径命令）经 loader 可加载",
        !!win?.methods?.run && JSON.stringify(win.methods.run.intents) === JSON.stringify(["run"]),
        `methods=${JSON.stringify(Object.keys(win?.methods ?? {}))}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "executable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 用工具原语（glob/program 等）真实行动。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  return demoViaSupervisor("executable", `sb-an-exec-${tag}`,
    "请用一个工具（glob 或 program 都行）看看当前仓库根目录下有哪些 .md 文件，然后告诉我结果。",
    async ({ execs }) => {
      const tools = execs.map((e) => e.cmd).filter((c) => ["glob", "grep", "program", "open_file", "do"].includes(c));
      return { ok: tools.length > 0, detail: `用到的 tool 原语：${JSON.stringify([...new Set(tools)])}` };
    });
}
