/**
 * Story: executable —— LLM 经稳定 tool 原语在 ContextObject 上调 Method 改变世界。
 *
 * 控制面（无 LLM）只验**结构**：① Object 自定义 ui_methods 在 ContextObject 上执行（method 调用）；
 * ② Object 定义的 window.commands（LLM 路径命令）经 loader 可加载。深度（4 原语 exec/close/wait/compress
 * 驱动真实编辑）属 Tier B + e2e S1/S2。规格见 specs/capability_executable.md。
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
        `export const ui_methods = { add: { fn: (_c, a) => ({ sum: a.x + a.y }) } };\nexport const window = { commands: {} };`);
      await sleep(350);
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      rec.eq("TC-EXEC-01", "ui_methods 在 ContextObject 上执行并返回结果", r.json?.returnValue, { sum: 5 });
    }

    // TC-EXEC-02: window.commands（LLM 路径命令）经 loader 可加载（executable 的命令面）
    {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { commands: { run: { paths: ["run"], intent: () => [], exec: async () => ({ ok: true }) } } };\nexport const ui_methods = {};`);
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      const win = await loadObjectWindow({ baseDir, objectId: id });
      rec.ok("TC-EXEC-02", "window.commands（LLM 路径命令）经 loader 可加载",
        !!win?.methods?.run && JSON.stringify(win.methods.run.paths) === JSON.stringify(["run"]),
        `methods=${JSON.stringify(Object.keys(win?.methods ?? {}))}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "executable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}
