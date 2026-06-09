/**
 * Story: observable —— thinkloop 周围加观测点，每轮 LLM 输入输出/tool/context 可记录可查可暂停。
 *
 * 控制面（无 LLM）只验**可观测面板的结构**：① 系统活动快照 /api/runtime/activity；② debug 开关
 * enable→status。「每轮 loop-debug 落盘」需真 thinkloop（Tier B）。规格见 observable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { mkServer, postJson, getJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app } = srv;
  try {
    // TC-OBS-01: 系统活动快照 /api/runtime/activity 结构正确
    {
      const r = await getJson(app, "/api/runtime/activity");
      const j = r.json ?? {};
      rec.ok("TC-OBS-01", "系统活动快照 /api/runtime/activity 返回 {now,runningCount,logPatterns}",
        r.status === 200 && typeof j.now === "number" && typeof j.runningCount === "number" && Array.isArray(j.logPatterns ?? j.jobs ?? []),
        `status=${r.status}, keys=${JSON.stringify(Object.keys(j))}`);
    }

    // TC-OBS-02: debug 开关 enable → status 反映已启用
    {
      await postJson(app, "/api/runtime/debug/enable", {});
      const s = await getJson(app, "/api/runtime/debug/status");
      rec.ok("TC-OBS-02", "debug 开关 enable → status 反映已启用",
        s.status === 200 && (s.json?.enabled === true || s.json?.debug === true),
        `status=${s.status}, body=${JSON.stringify(s.json)}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "observable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor, req } from "../_harness/agent-native";

/** Tier B —— agent-native：派任务后，每轮 loop-debug 落盘可查（全程可观测）。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  await req("POST", "/api/runtime/debug/enable", {});
  return demoViaSupervisor("observable", `sb-an-obs-${tag}`,
    "请简单介绍一下你自己。",
    async ({ sid, threadId }) => {
      const r = await req("GET", `/api/runtime/flows/${sid}/supervisor/threads/${threadId}/debug/loops`);
      const loops = r.json?.loops ?? r.json?.items ?? r.json ?? [];
      const n = Array.isArray(loops) ? loops.length : 0;
      return { ok: n >= 1, detail: `loop-debug 落盘 ${n} 轮（可查可回放）` };
    });
}
