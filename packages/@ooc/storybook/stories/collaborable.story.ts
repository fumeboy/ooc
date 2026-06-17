/**
 * Story: collaborable —— Object 间以「消息 + 持续会话窗口」协作，跨 thread 影响必经显式 inbox/outbox。
 *
 * 控制面（无 LLM）只验**通道**：① seed 一个 talk（user→target）后，target 的 callee thread inbox
 * 真实收到该消息（talk-delivery 双写）；② user.root 上挂了指向 target 的会话窗
 *（stored class = `_builtin/agent/thread`，target 落在被引窗 state.json）。
 * 「对端真实回应」属 Tier B（需对端 thinkloop）。规格见 collaborable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkServer, postJson, readThreadContextJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";
import { normalizeClassId } from "@ooc/core/runtime/object-registry";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    const target = "peer_b";
    await postJson(app, "/api/stones", { objectId: target, self: "# Peer B" });
    const sid = "sb-collab";
    const msg = "你好 peer_b，请帮我看看。";
    const seed = await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: target, initialMessage: msg });
    const tid: string = seed.json?.targetThreadId;

    // TC-COLLAB-01: talk-delivery —— target 的 callee thread inbox 真实收到 user 的消息
    {
      const inboxDir = join(baseDir, "flows", sid, "objects", target, "threads", tid ?? "", "inbox");
      let delivered = false;
      if (tid && existsSync(inboxDir)) {
        for (const f of readdirSync(inboxDir)) {
          if (f.endsWith(".json") && readFileSync(join(inboxDir, f), "utf8").includes(msg)) { delivered = true; break; }
        }
      }
      rec.ok("TC-COLLAB-01", "talk-delivery：target callee thread inbox 真实收到 user 消息",
        seed.status === 200 && delivered, `status=${seed.status}, tid=${tid}, delivered=${delivered}`);
    }

    // TC-COLLAB-02: user.root 上挂了指向 target 的会话窗（显式协作通道）。
    // Wave4 对象模型：会话窗 stored class = thread 的 stone objectId "_builtin/agent/thread"
    //（唯一会话载体注册 class；"talk" 是 readable 按 POV 算的投影 class，不落盘）。
    // thread-context.json 里 user.root 的 entry 是一个 _ref 指针（id/class/refObjectId），
    // **不再 inline target**——target 落在被引对象窗自己的 state.json
    //（flows/<sid>/objects/<windowId>/state.json 的 data.target）。
    // 故按「entry stored class = _builtin/agent/thread + 被引窗 state.data.target === target」断言。
    {
      const userCtx = readThreadContextJson(baseDir, sid, "user", "root");
      const wins: any[] = userCtx?.contextWindows ?? [];
      const sessionWin = wins.find((w) => normalizeClassId(w?.class ?? "") === "agent/thread");
      let pointsAtTarget = false;
      if (sessionWin) {
        const winId: string = sessionWin.refObjectId ?? sessionWin.id;
        const statePath = join(baseDir, "flows", sid, "objects", winId, "state.json");
        if (existsSync(statePath)) {
          try {
            const state = JSON.parse(readFileSync(statePath, "utf8"));
            pointsAtTarget = state?.data?.target === target;
          } catch { /* malformed → stays false */ }
        }
      }
      rec.ok("TC-COLLAB-02", "user.root 挂了指向 target 的会话窗（cross-object talk 路由表）",
        !!sessionWin && pointsAtTarget,
        `windows=${JSON.stringify(wins.map((w) => ({ class: w?.class, ref: w?.refObjectId })))?.slice(0, 160)}, pointsAtTarget=${pointsAtTarget}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "collaborable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor, calleeReplied } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 建一个对象并经 talk 联系它，对端跑自己的 thinkloop 回应。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  const peer = `sb_peer_${tag}`;
  return demoViaSupervisor("collaborable", `sb-an-collab-${tag}`,
    `请创建一个名为 ${peer} 的对象，然后通过 talk 联系它，请它做一次自我介绍，并把它的回应转述给我。`,
    async ({ sid }) => {
      const replied = await calleeReplied(sid, peer);
      return { ok: replied, detail: replied ? `${peer} 在自己的 thinkloop 真实回应了（被 talk 激活）` : `${peer} 未回应（可能仍在进行）` };
    });
}
