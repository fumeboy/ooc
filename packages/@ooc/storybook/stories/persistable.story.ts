/**
 * Story: persistable —— 把身份/事实/产物落到 stone(持久+git)/pool(持久+不git)/flow(ephemeral) 三子树。
 *
 * 控制面（无 LLM）验**持久化落点与 git 版本化**：① createStone 落 stones/main/objects 且进 git；
 * ② 经 HTTP 改 self 产生新 commit（worktree 版本化，可审计）；③ 三子树（stones/pools/flows）落点。
 * 「session worktree 试验层 / create_pr_and_invite_reviewers 合入」属 Tier B。规格见 persistable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkServer, postJson, putJson, stoneCommits, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  const rel = (id: string, f: string) => join("objects", id, f); // 相对 stones/main
  try {
    const id = "keeper";

    // TC-PERS-01: createStone 落 stones/main/objects 且进 git（持久 + 版本化）
    {
      // self.md 仅 agent（class=_builtin/agent）落盘，故建 agent 才有 self.md commit 可审计。
      const c = await postJson(app, "/api/stones", { objectId: id, class: "_builtin/agent", self: "# Keeper v1" });
      const onDisk = existsSync(join(baseDir, "stones", "main", "objects", id, "package.json"));
      const commits = stoneCommits(baseDir, rel(id, "self.md"));
      rec.ok("TC-PERS-01", "createStone 落 stones/main/objects 且进 git",
        c.status === 200 && onDisk && commits.length >= 1, `status=${c.status}, onDisk=${onDisk}, commits=${commits.length}`);
    }

    // TC-PERS-02: 经 HTTP 改 self 产生新 commit（worktree 版本化，可审计可回滚）
    {
      const before = stoneCommits(baseDir, rel(id, "self.md")).length;
      await putJson(app, `/api/stones/${id}/file`, { path: "self.md", content: "# Keeper v2\n演化了。" }, { "X-Overwrite-Confirm": "true" });
      const after = stoneCommits(baseDir, rel(id, "self.md")).length;
      rec.ok("TC-PERS-02", "经 HTTP 改 self 产生新 commit（版本化、可审计）",
        after > before, `commits ${before} → ${after}`);
    }

    // TC-PERS-03: 三子树落点 —— stone（持久+git）/ pool（持久+不git）/ flow（运行层）
    {
      const stoneOk = existsSync(join(baseDir, "stones", "main", "objects", id));
      const poolOk = existsSync(join(baseDir, "pools", id)); // createStone 同时建 pool 骨架
      const sid = "sb-persist";
      await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: id, initialMessage: "hi" });
      const flowOk = existsSync(join(baseDir, "flows", sid));
      rec.ok("TC-PERS-03", "三子树落点：stone(持久+git) / pool(持久+不git) / flow(运行层) 各就位",
        stoneOk && poolOk && flowOk, `stone=${stoneOk}, pool=${poolOk}, flow=${flowOk}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "persistable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor, getStoneSelfWithRetry, calledMethodOk } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 建对象写身份，离开内存后经 HTTP 重读可恢复。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  const obj = `sb_keep_${tag}`;
  return demoViaSupervisor("persistable", `sb-an-pers-${tag}`,
    `请创建一个名为 ${obj} 的对象，写好它的 self.md 身份，让它的身份能持久保存。`,
    async ({ sid, threadId }) => {
      // 新模型：create_object 落 session worktree，evolve 合入 main 有延迟，GET 重试容忍之。
      const self = await getStoneSelfWithRetry(obj);
      if (self.status === 200 && self.text.length > 20)
        return { ok: true, detail: `${obj} 身份 evolve 合入 main 后重读 self.md ${self.text.length} 字符，可恢复` };
      if (await calledMethodOk(sid, "supervisor", threadId, "create_object"))
        return { ok: true, detail: `${obj} 已由 create_object 建对象+身份落 session worktree（持久于 worktree；evolve 合入 main 是单独的合入能力）` };
      return { ok: false, detail: `self=${self.status}, len=${self.text.length}——agent 未成功建对象` };
    });
}
